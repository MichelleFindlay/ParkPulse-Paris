<?php

declare(strict_types=1);

namespace ParkPulse;

/**
 * Login modes:
 *   oidc — OpenID Connect (when oidc.issuer + oidc.client_id are configured)
 *   pin  — one shared PIN (when 'pin' is set)
 *   none — open app
 *
 * Sessions are stateless HMAC-signed cookies (nothing to clean up on shared hosting).
 */
final class Auth
{
    private const SESSION_COOKIE = 'parkpulse_session';
    private const STATE_COOKIE = 'parkpulse_oidc';
    private const STATE_TTL = 600;

    private ?array $session = null;
    private bool $loaded = false;
    private ?string $secretValue = null;

    public function __construct(
        private \PDO $db,
        private array $config,
        private Http $http,
        private Cache $cache,
        private string $base,
    ) {
    }

    public function mode(): string
    {
        $o = $this->config['oidc'] ?? [];
        if (!empty($o['issuer']) && !empty($o['client_id'])) {
            return 'oidc';
        }
        return ($this->config['pin'] ?? '') !== '' ? 'pin' : 'none';
    }

    public function authed(): bool
    {
        return $this->mode() === 'none' || $this->session() !== null;
    }

    /** Signed-in OIDC user ['sub', 'name', 'email'] or null (PIN/open modes are shared). */
    public function user(): ?array
    {
        $s = $this->session();
        if ($s === null) {
            return null;
        }
        if (($s['m'] ?? '') === 'oidc') {
            $a = $this->avatar((string) $s['sub']);
            return ['sub' => $s['sub'], 'name' => $s['name'], 'email' => $s['email'], 'emoji' => $a['emoji'], 'avatar' => $a['image']];
        }
        // PIN mode: the chosen profile is the identity.
        $p = isset($s['pid']) ? $this->profile((int) $s['pid']) : null;
        if ($p === null) {
            return null;
        }
        $a = $this->avatar('pin:' . $p['id']);
        return ['sub' => 'pin:' . $p['id'], 'name' => $p['name'], 'email' => null, 'emoji' => $p['emoji'], 'avatar' => $a['image'], 'profileId' => $p['id']];
    }

    // ---------------------------------------------------------- profile picture / emoji

    private array $avatarCache = [];

    /** ['emoji' => ?string, 'image' => ?data-URL] chosen by a person (SSO subject or pin:<id>). */
    private function avatar(string $sub): array
    {
        if (!isset($this->avatarCache[$sub])) {
            $st = $this->db->prepare('SELECT emoji, image FROM avatars WHERE sub = ?');
            $st->execute([$sub]);
            $r = $st->fetch();
            $this->avatarCache[$sub] = $r ? ['emoji' => $r['emoji'] ?: null, 'image' => $r['image'] ?: null] : ['emoji' => null, 'image' => null];
        }
        return $this->avatarCache[$sub];
    }

    /**
     * Set the signed-in person's emoji and/or picture. $emoji null = leave as is ('' = back to initials,
     * SSO only); $setImage false = leave the picture as is, otherwise $image (null removes it).
     */
    public function setAvatar(?string $emoji, ?string $image, bool $setImage): array
    {
        $u = $this->user();
        if ($u === null) {
            throw new HttpError(400, 'Sign in with your own account or profile to choose a picture');
        }
        $sub = (string) $u['sub'];
        $cur = $this->avatar($sub);
        if ($emoji !== null && isset($u['profileId'])) {
            if ($emoji !== '') {
                $this->db->prepare('UPDATE profiles SET emoji = ? WHERE id = ?')->execute([$emoji, $u['profileId']]);
                $this->profileCache = null;
            }
            $emoji = null; // PIN profiles keep their emoji in the profiles table
        }
        $this->db->prepare(
            'INSERT INTO avatars (sub, emoji, image, updated) VALUES (?, ?, ?, ?)
             ON CONFLICT(sub) DO UPDATE SET emoji = excluded.emoji, image = excluded.image, updated = excluded.updated'
        )->execute([
            $sub,
            $emoji !== null ? ($emoji === '' ? null : $emoji) : $cur['emoji'],
            $setImage ? $image : $cur['image'],
            time(),
        ]);
        unset($this->avatarCache[$sub]);
        return $this->user();
    }

    // ---------------------------------------------------------- profiles (PIN mode)

    /** PIN accepted but no (valid) profile chosen yet → the app shows the chooser. */
    public function needsProfile(): bool
    {
        return $this->mode() === 'pin' && $this->session() !== null && $this->user() === null;
    }

    public function profiles(): array
    {
        $out = [];
        $sql = "SELECT p.id, p.name, p.emoji, p.last_seen, a.image FROM profiles p LEFT JOIN avatars a ON a.sub = 'pin:' || p.id
                ORDER BY p.last_seen IS NULL, p.last_seen DESC, p.name";
        foreach ($this->db->query($sql) as $r) {
            $out[] = ['id' => (int) $r['id'], 'name' => $r['name'], 'emoji' => $r['emoji'], 'avatar' => $r['image'] ?: null, 'lastSeen' => $r['last_seen'] === null ? null : (int) $r['last_seen']];
        }
        return $out;
    }

    private ?array $profileCache = null;

    private function profile(int $id): ?array
    {
        if ($this->profileCache !== null && $this->profileCache['id'] === $id) {
            return $this->profileCache;
        }
        $st = $this->db->prepare('SELECT id, name, emoji FROM profiles WHERE id = ?');
        $st->execute([$id]);
        $r = $st->fetch();
        return $this->profileCache = $r ? ['id' => (int) $r['id'], 'name' => $r['name'], 'emoji' => $r['emoji']] : null;
    }

    public function createProfile(string $name, string $emoji): array
    {
        $this->requirePinSession();
        if ((int) $this->db->query('SELECT COUNT(*) FROM profiles')->fetchColumn() >= 30) {
            throw new HttpError(409, 'Too many profiles (30 max)');
        }
        try {
            $this->db->prepare('INSERT INTO profiles (name, emoji, created_at) VALUES (?, ?, ?)')->execute([$name, $emoji, time()]);
        } catch (\PDOException) {
            throw new HttpError(409, "There’s already a profile called {$name} — pick it from the list");
        }
        $this->selectProfile((int) $this->db->lastInsertId());
        return $this->user();
    }

    public function selectProfile(int $id): array
    {
        $this->requirePinSession();
        $this->profileCache = null;
        if ($this->profile($id) === null) {
            throw new HttpError(404, 'Profile not found');
        }
        $this->db->prepare('UPDATE profiles SET last_seen = ? WHERE id = ?')->execute([time(), $id]);
        $this->setSession(['m' => 'pin', 'p' => $this->pinFingerprint(), 'pid' => $id], 60);
        return $this->user();
    }

    private function requirePinSession(): void
    {
        if ($this->mode() !== 'pin' || $this->session() === null) {
            throw new HttpError(400, 'Profiles are only used with PIN login');
        }
    }

    // ------------------------------------------------------------- PIN

    private const PIN_MAX_PER_IP = 5;       // wrong PINs per address…
    private const PIN_MAX_GLOBAL = 30;      // …and from everyone, per window
    private const PIN_WINDOW = 3600;        // counting window (s)
    private const PIN_LOCK = 900;           // lockout (s)

    public function loginPin(string $pin): void
    {
        if ($this->mode() !== 'pin') {
            throw new HttpError(400, 'PIN login is not enabled');
        }
        $ipKey = 'pinfail:' . substr(hash('sha256', (string) ($_SERVER['REMOTE_ADDR'] ?? '?') . $this->secret()), 0, 24);
        $ip = $this->failState($ipKey);
        $all = $this->failState('pinfail:all');
        foreach ([$ip, $all] as $st) {
            if ($st['until'] > time()) {
                $mins = (int) ceil(($st['until'] - time()) / 60);
                throw new HttpError(429, "Too many wrong PINs — try again in {$mins} min");
            }
        }

        if (!hash_equals((string) $this->config['pin'], $pin)) {
            $ip = $this->recordFail($ipKey, $ip, self::PIN_MAX_PER_IP);
            $this->recordFail('pinfail:all', $all, self::PIN_MAX_GLOBAL);
            usleep(random_int(400000, 900000)); // blunt timing + slow down guessing
            if ($ip['until'] > time()) {
                throw new HttpError(429, 'Wrong PIN — too many tries, locked for 15 min');
            }
            $left = max(1, self::PIN_MAX_PER_IP - $ip['count']);
            throw new HttpError(403, "Wrong PIN ({$left} " . ($left === 1 ? 'try' : 'tries') . ' left)');
        }
        $this->clearFail($ipKey);
        $this->setSession(['m' => 'pin', 'p' => $this->pinFingerprint()], 60);
    }

    /** @return array{count:int, first:int, until:int} */
    private function failState(string $key): array
    {
        $s = $this->db->prepare('SELECT value FROM meta WHERE key = ?');
        $s->execute([$key]);
        $v = json_decode((string) ($s->fetchColumn() ?: ''), true);
        $st = is_array($v) ? $v + ['count' => 0, 'first' => 0, 'until' => 0] : ['count' => 0, 'first' => 0, 'until' => 0];
        if ($st['first'] < time() - self::PIN_WINDOW && $st['until'] <= time()) {
            $st = ['count' => 0, 'first' => 0, 'until' => 0]; // window expired
        }
        return $st;
    }

    private function recordFail(string $key, array $st, int $max): array
    {
        $st['first'] = $st['first'] ?: time();
        $st['count']++;
        if ($st['count'] >= $max) {
            $st['until'] = time() + self::PIN_LOCK;
            $st['count'] = 0;
            $st['first'] = time();
        }
        $this->db->prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')->execute([$key, json_encode($st)]);
        return $st + ['count' => 0];
    }

    private function clearFail(string $key): void
    {
        $this->db->prepare('DELETE FROM meta WHERE key = ?')->execute([$key]);
    }

    // ------------------------------------------------------------ OIDC

    /** Start the login: remember state/nonce/PKCE verifier, return the provider URL. */
    public function oidcStart(): string
    {
        $state = Jwt::b64e(random_bytes(16));
        $nonce = Jwt::b64e(random_bytes(16));
        $verifier = Jwt::b64e(random_bytes(32));
        $this->setCookie(self::STATE_COOKIE, $this->sign([
            's' => $state, 'n' => $nonce, 'v' => $verifier, 'exp' => time() + self::STATE_TTL,
        ]), time() + self::STATE_TTL);
        return $this->oidc()->authorizationUrl($this->redirectUri(), $state, $nonce, $verifier);
    }

    /** Handle the provider's redirect back. Throws with a user-readable message on failure. */
    public function oidcFinish(array $query): void
    {
        $pending = $this->unsign((string) ($_COOKIE[self::STATE_COOKIE] ?? ''));
        $this->setCookie(self::STATE_COOKIE, '', time() - 3600);

        if (isset($query['error'])) {
            $desc = (string) ($query['error_description'] ?? $query['error']);
            throw new \RuntimeException('The identity provider said: ' . $desc);
        }
        if ($pending === null) {
            throw new \RuntimeException('Your sign-in attempt expired. Please try again.');
        }
        $state = (string) ($query['state'] ?? '');
        $code = (string) ($query['code'] ?? '');
        if ($state === '' || !hash_equals($pending['s'], $state) || $code === '') {
            throw new \RuntimeException('Sign-in response did not match (state mismatch). Please try again.');
        }

        $claims = $this->oidc()->finish($code, $this->redirectUri(), $pending['v'], $pending['n']);

        $email = isset($claims['email']) && is_string($claims['email']) ? strtolower($claims['email']) : null;
        $verified = !array_key_exists('email_verified', $claims)
            || $claims['email_verified'] === true || $claims['email_verified'] === 'true';
        if (!$this->allowed((string) $claims['sub'], $verified ? $email : null)) {
            throw new \RuntimeException(
                'Signed in as ' . ($email ?? $claims['sub']) . ', but that account is not allowed to use Park Pulse.'
            );
        }

        $name = $claims['given_name'] ?? $claims['name'] ?? $claims['preferred_username'] ?? $email ?? 'Guest';
        $this->setSession([
            'm'     => 'oidc',
            'iss'   => rtrim((string) $this->config['oidc']['issuer'], '/'),
            'sub'   => (string) $claims['sub'],
            'name'  => function_exists('mb_substr') ? mb_substr((string) $name, 0, 60) : substr((string) $name, 0, 60),
            'email' => $email,
        ], (int) ($this->config['oidc']['session_days'] ?? 30));
    }

    /** Clear the session; returns the provider's logout URL if it has one. */
    public function logout(): ?string
    {
        $wasOidc = ($this->session()['m'] ?? '') === 'oidc';
        $this->setCookie(self::SESSION_COOKIE, '', time() - 3600);
        $this->session = null;
        return $wasOidc ? $this->oidc()->endSessionUrl($this->origin() . $this->base . '/') : null;
    }

    private function allowed(string $sub, ?string $verifiedEmail): bool
    {
        $o = $this->config['oidc'];
        $emails = array_map('strtolower', (array) ($o['allowed_emails'] ?? []));
        $domains = array_map(fn ($d) => strtolower(ltrim((string) $d, '@')), (array) ($o['allowed_domains'] ?? []));
        $subs = array_map('strval', (array) ($o['allowed_subs'] ?? []));

        if (!$emails && !$domains && !$subs) {
            return true; // no allowlist: anyone the provider authenticates
        }
        if (in_array($sub, $subs, true)) {
            return true;
        }
        if ($verifiedEmail !== null) {
            if (in_array($verifiedEmail, $emails, true)) {
                return true;
            }
            $domain = substr((string) strrchr($verifiedEmail, '@'), 1);
            if ($domain !== '' && in_array($domain, $domains, true)) {
                return true;
            }
        }
        return false;
    }

    public function hasAllowlist(): bool
    {
        $o = $this->config['oidc'] ?? [];
        return !empty($o['allowed_emails']) || !empty($o['allowed_domains']) || !empty($o['allowed_subs']);
    }

    public function redirectUri(): string
    {
        $configured = (string) ($this->config['oidc']['redirect_uri'] ?? '');
        return $configured !== '' ? $configured : $this->origin() . $this->base . '/auth/callback';
    }

    private function oidc(): Oidc
    {
        return new Oidc($this->config['oidc'], $this->http, $this->cache);
    }

    // --------------------------------------------------------- sessions

    private function session(): ?array
    {
        if ($this->loaded) {
            return $this->session;
        }
        $this->loaded = true;
        $s = $this->unsign((string) ($_COOKIE[self::SESSION_COOKIE] ?? ''));
        $mode = $this->mode();
        if ($s === null || ($s['m'] ?? '') !== $mode) {
            return $this->session = null;
        }
        // Changing the PIN or the issuer logs everyone out.
        if ($mode === 'pin' && !hash_equals($this->pinFingerprint(), (string) ($s['p'] ?? ''))) {
            return $this->session = null;
        }
        if ($mode === 'oidc' && ($s['iss'] ?? '') !== rtrim((string) $this->config['oidc']['issuer'], '/')) {
            return $this->session = null;
        }
        return $this->session = $s;
    }

    private function setSession(array $payload, int $days): void
    {
        $exp = time() + $days * 86400;
        $payload['exp'] = $exp;
        $this->setCookie(self::SESSION_COOKIE, $this->sign($payload), $exp);
        $this->session = $payload;
        $this->loaded = true;
    }

    private function pinFingerprint(): string
    {
        return substr(hash_hmac('sha256', 'pin:' . $this->config['pin'], $this->secret()), 0, 32);
    }

    private function sign(array $payload): string
    {
        $body = Jwt::b64e(json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
        return $body . '.' . Jwt::b64e(hash_hmac('sha256', $body, $this->secret(), true));
    }

    private function unsign(string $token): ?array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 2) {
            return null;
        }
        try {
            $expected = Jwt::b64e(hash_hmac('sha256', $parts[0], $this->secret(), true));
            if (!hash_equals($expected, $parts[1])) {
                return null;
            }
            $data = json_decode(Jwt::b64d($parts[0]), true);
        } catch (\Throwable) {
            return null;
        }
        if (!is_array($data) || (int) ($data['exp'] ?? 0) < time()) {
            return null;
        }
        return $data;
    }

    private function setCookie(string $name, string $value, int $expires): void
    {
        setcookie($name, $value, [
            'expires'  => $expires,
            'path'     => $this->base . '/',
            'secure'   => $this->https(),
            'httponly' => true,
            'samesite' => 'Lax', // Lax so the cookie survives the provider's redirect back
        ]);
    }

    private function https(): bool
    {
        return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https'
            || (string) ($_SERVER['SERVER_PORT'] ?? '') === '443';
    }

    private function origin(): string
    {
        $host = (string) ($_SERVER['HTTP_HOST'] ?? 'localhost');
        if (!preg_match('/^[A-Za-z0-9.\-:\[\]]+$/', $host)) {
            $host = 'localhost';
        }
        return ($this->https() ? 'https' : 'http') . '://' . $host;
    }

    private function secret(): string
    {
        if ($this->secretValue !== null) {
            return $this->secretValue;
        }
        $stmt = $this->db->prepare("SELECT value FROM meta WHERE key = 'secret'");
        $stmt->execute();
        $secret = $stmt->fetchColumn();
        if (!is_string($secret) || $secret === '') {
            $this->db->prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('secret', ?)")
                ->execute([bin2hex(random_bytes(32))]);
            $stmt->execute();
            $secret = (string) $stmt->fetchColumn();
        }
        return $this->secretValue = $secret;
    }
}
