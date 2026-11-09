<?php

declare(strict_types=1);

namespace ParkPulse;

/**
 * Standard Web Push (no third-party service): VAPID (RFC 8292) authentication and
 * aes128gcm payload encryption (RFC 8291 / RFC 8188), using PHP's openssl.
 * Works with the browsers' own push services (Chrome/FCM, Firefox, Safari/Apple).
 *
 * The VAPID key pair is generated on first use and kept in the database.
 */
final class WebPush
{
    private const P256_SPKI_PREFIX = '3059301306072a8648ce3d020106082a8648ce3d030107034200';

    private ?array $keys = null;

    /** Reason text from the last send (push service reply or local error). */
    public string $lastReason = '';

    public function __construct(private \PDO $db, private string $subject, private string $userAgent)
    {
    }

    public static function available(): bool
    {
        return function_exists('openssl_pkey_new') && function_exists('openssl_pkey_derive')
            && in_array('aes-128-gcm', openssl_get_cipher_methods(), true);
    }

    /** VAPID public key (base64url, uncompressed point) for PushManager.subscribe(). */
    public function publicKey(): string
    {
        return $this->keys()['public'];
    }

    /**
     * Send one notification. Returns the push service's HTTP status (201 = queued;
     * 404/410 = subscription gone and should be deleted; 0 = network error).
     *
     * @param array{endpoint:string, p256dh:string, auth:string} $sub
     */
    public function send(array $sub, array $payload, int $ttl = 3600, string $urgency = 'normal'): int
    {
        $body = $this->encrypt(json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), $sub['p256dh'], $sub['auth']);
        $parts = parse_url($sub['endpoint']);
        if (!isset($parts['scheme'], $parts['host']) || $parts['scheme'] !== 'https') {
            return 0;
        }
        $aud = $parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
        $headers = [
            'Content-Type: application/octet-stream',
            'Content-Encoding: aes128gcm',
            'TTL: ' . $ttl,
            'Urgency: ' . $urgency,
            'Authorization: vapid t=' . $this->vapidJwt($aud) . ', k=' . $this->publicKey(),
        ];

        if (function_exists('curl_init')) {
            $ch = curl_init($sub['endpoint']);
            curl_setopt_array($ch, [
                CURLOPT_POST           => true,
                CURLOPT_POSTFIELDS     => $body,
                CURLOPT_HTTPHEADER     => $headers,
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_CONNECTTIMEOUT => 5,
                CURLOPT_TIMEOUT        => 10,
                CURLOPT_USERAGENT      => $this->userAgent,
            ]);
            $resp = curl_exec($ch);
            $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            $this->lastReason = $code === 0 ? ('network error: ' . curl_error($ch)) : trim(substr(is_string($resp) ? strip_tags($resp) : '', 0, 200));
            $this->log($code, $sub['endpoint'], $payload['tag'] ?? '');
            return $code;
        }

        $ctx = stream_context_create(['http' => [
            'method' => 'POST', 'header' => implode("\r\n", $headers) . "\r\n", 'content' => $body,
            'timeout' => 10, 'ignore_errors' => true,
        ]]);
        $resp = @file_get_contents($sub['endpoint'], false, $ctx);
        $this->lastReason = trim(substr(is_string($resp) ? strip_tags($resp) : 'request failed', 0, 200));
        $resp = function_exists('http_get_last_response_headers') ? (http_get_last_response_headers() ?? []) : ($http_response_header ?? []);
        foreach ($resp as $line) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m)) {
                $code = (int) $m[1];
            }
        }
        $this->log($code ?? 0, $sub['endpoint'], $payload['tag'] ?? '');
        return $code ?? 0;
    }

    /** Keep the last 25 delivery attempts (shown in /api/health and the in-app check). */
    private function log(int $code, string $endpoint, string $tag): void
    {
        try {
            $get = $this->db->prepare("SELECT value FROM meta WHERE key = 'push_log'");
            $get->execute();
            $log = json_decode((string) ($get->fetchColumn() ?: '[]'), true) ?: [];
            array_unshift($log, [
                't'      => time(),
                'code'   => $code,
                'host'   => (string) parse_url($endpoint, PHP_URL_HOST),
                'tag'    => substr($tag, 0, 40),
                'reason' => ($code >= 200 && $code < 300) ? '' : $this->lastReason,
            ]);
            $this->db->prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('push_log', ?)")
                ->execute([json_encode(array_slice($log, 0, 25))]);
        } catch (\Throwable) {
        }
    }

    public static function readLog(\PDO $db): array
    {
        $v = $db->query("SELECT value FROM meta WHERE key = 'push_log'")->fetchColumn();
        return json_decode((string) ($v ?: '[]'), true) ?: [];
    }

    // ------------------------------------------------------------ crypto

    /** RFC 8291 aes128gcm: salt(16) | rs(4) | idlen(1) | as_public(65) | ciphertext+tag. */
    private function encrypt(string $plaintext, string $p256dh, string $authB64): string
    {
        $uaPublic = Jwt::b64d($p256dh);
        $authSecret = Jwt::b64d($authB64);
        if (strlen($uaPublic) !== 65 || $uaPublic[0] !== "\x04" || strlen($authSecret) < 16) {
            throw new \InvalidArgumentException('Bad push subscription keys');
        }

        $local = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
        if ($local === false) {
            throw new \RuntimeException('Could not create an EC key (openssl)');
        }
        $asPublic = self::rawPublic($local);
        $shared = openssl_pkey_derive(self::spkiPem($uaPublic), $local, 32);
        if ($shared === false) {
            throw new \RuntimeException('ECDH failed');
        }

        $prkKey = hash_hmac('sha256', $shared, $authSecret, true);
        $ikm = hash_hmac('sha256', "WebPush: info\0" . $uaPublic . $asPublic . "\x01", $prkKey, true);
        $salt = random_bytes(16);
        $prk = hash_hmac('sha256', $ikm, $salt, true);
        $cek = substr(hash_hmac('sha256', "Content-Encoding: aes128gcm\0\x01", $prk, true), 0, 16);
        $nonce = substr(hash_hmac('sha256', "Content-Encoding: nonce\0\x01", $prk, true), 0, 12);

        $tag = '';
        $cipher = openssl_encrypt($plaintext . "\x02", 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag, '', 16);
        if ($cipher === false) {
            throw new \RuntimeException('AES-GCM encryption failed');
        }
        return $salt . pack('N', 4096) . chr(65) . $asPublic . $cipher . $tag;
    }

    /** VAPID JWT (ES256), valid 12 h. */
    private function vapidJwt(string $aud): string
    {
        $input = Jwt::b64e(json_encode(['typ' => 'JWT', 'alg' => 'ES256']))
            . '.' . Jwt::b64e(json_encode(['aud' => $aud, 'exp' => time() + 43200, 'sub' => $this->subject], JSON_UNESCAPED_SLASHES));
        $key = openssl_pkey_get_private($this->keys()['pem']);
        if ($key === false || !openssl_sign($input, $der, $key, OPENSSL_ALGO_SHA256)) {
            throw new \RuntimeException('VAPID signing failed');
        }
        return $input . '.' . Jwt::b64e(self::derToRaw($der));
    }

    private function keys(): array
    {
        if ($this->keys !== null) {
            return $this->keys;
        }
        $get = $this->db->prepare('SELECT value FROM meta WHERE key = ?');
        $get->execute(['vapid_pem']);
        $pem = $get->fetchColumn();
        $get->execute(['vapid_public']);
        $pub = $get->fetchColumn();
        if (!is_string($pem) || !is_string($pub) || $pem === '' || $pub === '') {
            $k = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
            if ($k === false || !openssl_pkey_export($k, $pem)) {
                throw new \RuntimeException('Could not create the VAPID key pair (openssl)');
            }
            $pub = Jwt::b64e(self::rawPublic($k));
            $set = $this->db->prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
            $set->execute(['vapid_pem', $pem]);
            $set->execute(['vapid_public', $pub]);
        }
        return $this->keys = ['pem' => $pem, 'public' => $pub];
    }

    /** Uncompressed P-256 point (0x04 | X | Y) of a key. */
    private static function rawPublic(\OpenSSLAsymmetricKey $key): string
    {
        $d = openssl_pkey_get_details($key);
        $pad = static fn (string $v): string => str_pad($v, 32, "\0", STR_PAD_LEFT);
        return "\x04" . $pad($d['ec']['x']) . $pad($d['ec']['y']);
    }

    private static function spkiPem(string $rawPoint): string
    {
        $der = hex2bin(self::P256_SPKI_PREFIX) . $rawPoint;
        return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n";
    }

    /** ECDSA DER signature → raw r|s (64 bytes) as JWS ES256 expects. */
    private static function derToRaw(string $der): string
    {
        $pos = 2;
        if (ord($der[1]) & 0x80) {
            $pos += ord($der[1]) & 0x7f;
        }
        $out = '';
        for ($i = 0; $i < 2; $i++) {
            if (ord($der[$pos]) !== 0x02) {
                throw new \RuntimeException('Unexpected signature encoding');
            }
            $len = ord($der[$pos + 1]);
            $int = substr($der, $pos + 2, $len);
            $out .= str_pad(ltrim($int, "\0"), 32, "\0", STR_PAD_LEFT);
            $pos += 2 + $len;
        }
        return $out;
    }
}
