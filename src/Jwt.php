<?php

declare(strict_types=1);

namespace ParkPulse;

/**
 * Just enough JWT to verify OIDC ID tokens: RS256/384/512, ES256 (via openssl, keys
 * from a JWKS) and HS256 (client secret). Anything else is rejected.
 */
final class Jwt
{
    private const RSA_ALGS = ['RS256' => 'sha256', 'RS384' => 'sha384', 'RS512' => 'sha512'];

    /** @return array{header: array, claims: array, input: string, sig: string} */
    public static function parse(string $jwt): array
    {
        $parts = explode('.', $jwt);
        if (count($parts) !== 3) {
            throw new \UnexpectedValueException('ID token is not a JWT');
        }
        $header = json_decode(self::b64d($parts[0]), true);
        $claims = json_decode(self::b64d($parts[1]), true);
        if (!is_array($header) || !is_array($claims)) {
            throw new \UnexpectedValueException('ID token is malformed');
        }
        return ['header' => $header, 'claims' => $claims, 'input' => $parts[0] . '.' . $parts[1], 'sig' => self::b64d($parts[2])];
    }

    /** @param array $jwks the provider's JWKS document ({"keys": [...]}) */
    public static function verify(array $token, array $jwks, string $clientSecret): bool
    {
        $alg = (string) ($token['header']['alg'] ?? '');
        $kid = $token['header']['kid'] ?? null;

        if ($alg === 'HS256') {
            if ($clientSecret === '') {
                return false;
            }
            return hash_equals(hash_hmac('sha256', $token['input'], $clientSecret, true), $token['sig']);
        }

        if (!isset(self::RSA_ALGS[$alg]) && $alg !== 'ES256') {
            throw new \UnexpectedValueException("Unsupported ID token algorithm: $alg");
        }
        if (!function_exists('openssl_verify')) {
            throw new \RuntimeException('The PHP openssl extension is required to verify ID tokens');
        }

        $kty = $alg === 'ES256' ? 'EC' : 'RSA';
        foreach ($jwks['keys'] ?? [] as $jwk) {
            if (($jwk['kty'] ?? '') !== $kty || ($kid !== null && ($jwk['kid'] ?? null) !== $kid)) {
                continue;
            }
            if (isset($jwk['use']) && $jwk['use'] !== 'sig') {
                continue;
            }
            if ($kty === 'RSA') {
                $pem = self::rsaPem((string) $jwk['n'], (string) $jwk['e']);
                $ok = openssl_verify($token['input'], $token['sig'], $pem, self::RSA_ALGS[$alg]);
            } else {
                if (($jwk['crv'] ?? '') !== 'P-256' || strlen($token['sig']) !== 64) {
                    continue;
                }
                $pem = self::p256Pem((string) $jwk['x'], (string) $jwk['y']);
                $der = self::seq(self::int(substr($token['sig'], 0, 32)) . self::int(substr($token['sig'], 32)));
                $ok = openssl_verify($token['input'], $der, $pem, 'sha256');
            }
            if ($ok === 1) {
                return true;
            }
        }
        return false;
    }

    /** True if the JWKS has a key with this kid (used to decide whether to refetch it). */
    public static function hasKid(array $jwks, ?string $kid): bool
    {
        if ($kid === null) {
            return true;
        }
        foreach ($jwks['keys'] ?? [] as $jwk) {
            if (($jwk['kid'] ?? null) === $kid) {
                return true;
            }
        }
        return false;
    }

    public static function b64d(string $s): string
    {
        $d = base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4), true);
        if ($d === false) {
            throw new \UnexpectedValueException('Bad base64url');
        }
        return $d;
    }

    public static function b64e(string $s): string
    {
        return rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
    }

    // ---- minimal DER to turn JWK parameters into PEM public keys

    private static function rsaPem(string $n, string $e): string
    {
        $rsaKey = self::seq(self::int(self::b64d($n)) . self::int(self::b64d($e)));
        $algId = hex2bin('300d06092a864886f70d0101010500'); // rsaEncryption, NULL
        return self::pem(self::seq($algId . self::bits($rsaKey)));
    }

    private static function p256Pem(string $x, string $y): string
    {
        $pad = static fn (string $v): string => str_pad($v, 32, "\0", STR_PAD_LEFT);
        $algId = hex2bin('301306072a8648ce3d020106082a8648ce3d030107'); // ecPublicKey, prime256v1
        return self::pem(self::seq($algId . self::bits("\x04" . $pad(self::b64d($x)) . $pad(self::b64d($y)))));
    }

    private static function pem(string $der): string
    {
        return "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n";
    }

    private static function len(int $l): string
    {
        if ($l < 0x80) {
            return chr($l);
        }
        $b = ltrim(pack('N', $l), "\0");
        return chr(0x80 | strlen($b)) . $b;
    }

    private static function seq(string $content): string
    {
        return "\x30" . self::len(strlen($content)) . $content;
    }

    private static function int(string $bytes): string
    {
        $bytes = ltrim($bytes, "\0");
        if ($bytes === '' || ord($bytes[0]) >= 0x80) {
            $bytes = "\0" . $bytes;
        }
        return "\x02" . self::len(strlen($bytes)) . $bytes;
    }

    private static function bits(string $content): string
    {
        return "\x03" . self::len(strlen($content) + 1) . "\0" . $content;
    }
}
