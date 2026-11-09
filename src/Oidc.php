<?php

declare(strict_types=1);

namespace ParkPulse;

/** OpenID Connect relying party: discovery, auth code + PKCE, ID token validation. */
final class Oidc
{
    private const LEEWAY = 120; // seconds of clock skew tolerated

    public function __construct(private array $cfg, private Http $http, private Cache $cache)
    {
    }

    public function discovery(): array
    {
        $issuer = rtrim((string) $this->cfg['issuer'], '/');
        $doc = $this->cache->remember('oidc:discovery:' . sha1($issuer), 86400, function () use ($issuer): array {
            $d = $this->http->getJson($issuer . '/.well-known/openid-configuration');
            foreach (['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri'] as $k) {
                if (empty($d[$k])) {
                    throw new UpstreamException("OIDC discovery document has no $k");
                }
            }
            return $d;
        })['data'];
        return $doc;
    }

    public function authorizationUrl(string $redirectUri, string $state, string $nonce, string $verifier): string
    {
        $d = $this->discovery();
        $query = http_build_query([
            'response_type'         => 'code',
            'client_id'             => $this->cfg['client_id'],
            'redirect_uri'          => $redirectUri,
            'scope'                 => $this->cfg['scopes'] ?: 'openid email profile',
            'state'                 => $state,
            'nonce'                 => $nonce,
            'code_challenge'        => Jwt::b64e(hash('sha256', $verifier, true)),
            'code_challenge_method' => 'S256',
        ], '', '&', PHP_QUERY_RFC3986);
        $sep = str_contains($d['authorization_endpoint'], '?') ? '&' : '?';
        return $d['authorization_endpoint'] . $sep . $query;
    }

    /** Swap the code for tokens and return validated ID token claims (merged with userinfo). */
    public function finish(string $code, string $redirectUri, string $verifier, string $nonce): array
    {
        $d = $this->discovery();
        $fields = [
            'grant_type'    => 'authorization_code',
            'code'          => $code,
            'redirect_uri'  => $redirectUri,
            'code_verifier' => $verifier,
        ];
        $headers = [];
        $secret = (string) $this->cfg['client_secret'];
        $methods = $d['token_endpoint_auth_methods_supported'] ?? ['client_secret_basic'];
        if ($secret !== '' && in_array('client_secret_basic', $methods, true)) {
            $headers[] = 'Authorization: Basic ' . base64_encode(rawurlencode($this->cfg['client_id']) . ':' . rawurlencode($secret));
        } else {
            $fields['client_id'] = (string) $this->cfg['client_id'];
            if ($secret !== '') {
                $fields['client_secret'] = $secret;
            }
        }

        $tokens = $this->http->postForm($d['token_endpoint'], $fields, $headers);
        if (empty($tokens['id_token']) || !is_string($tokens['id_token'])) {
            throw new \RuntimeException('The identity provider returned no ID token');
        }

        $claims = $this->validate($tokens['id_token'], $nonce);

        if (empty($claims['email']) && !empty($d['userinfo_endpoint']) && !empty($tokens['access_token'])) {
            try {
                $info = $this->http->getJson($d['userinfo_endpoint'], ['Authorization: Bearer ' . $tokens['access_token']]);
                if (($info['sub'] ?? null) === $claims['sub']) {
                    $claims += $info;
                }
            } catch (\Throwable) {
                // userinfo is a nice-to-have
            }
        }
        return $claims;
    }

    public function endSessionUrl(string $postLogoutRedirect): ?string
    {
        try {
            $end = $this->discovery()['end_session_endpoint'] ?? null;
        } catch (\Throwable) {
            return null;
        }
        if (!is_string($end) || $end === '') {
            return null;
        }
        $sep = str_contains($end, '?') ? '&' : '?';
        return $end . $sep . http_build_query([
            'client_id'                => $this->cfg['client_id'],
            'post_logout_redirect_uri' => $postLogoutRedirect,
        ], '', '&', PHP_QUERY_RFC3986);
    }

    private function validate(string $idToken, string $nonce): array
    {
        $d = $this->discovery();
        $token = Jwt::parse($idToken);
        $c = $token['claims'];

        $jwksKey = 'oidc:jwks:' . sha1($d['jwks_uri']);
        $jwks = $this->cache->remember($jwksKey, 86400, fn () => $this->http->getJson($d['jwks_uri']))['data'];
        $kid = isset($token['header']['kid']) ? (string) $token['header']['kid'] : null;
        if (!Jwt::hasKid($jwks, $kid)) {
            // Provider rotated keys since we cached them.
            $this->cache->forget($jwksKey);
            $jwks = $this->cache->remember($jwksKey, 86400, fn () => $this->http->getJson($d['jwks_uri']))['data'];
        }
        if (!Jwt::verify($token, $jwks, (string) $this->cfg['client_secret'])) {
            throw new \RuntimeException('ID token signature is invalid');
        }

        $clientId = (string) $this->cfg['client_id'];
        $aud = (array) ($c['aud'] ?? []);
        $now = time();
        $checks = [
            'issuer'   => ($c['iss'] ?? null) === $d['issuer'],
            'audience' => in_array($clientId, $aud, true),
            'azp'      => count($aud) <= 1 || ($c['azp'] ?? null) === $clientId,
            'expiry'   => isset($c['exp']) && (int) $c['exp'] + self::LEEWAY >= $now,
            'iat'      => !isset($c['iat']) || (int) $c['iat'] - self::LEEWAY <= $now,
            'nonce'    => isset($c['nonce']) && is_string($c['nonce']) && hash_equals($nonce, $c['nonce']),
            'subject'  => isset($c['sub']) && is_string($c['sub']) && $c['sub'] !== '',
        ];
        foreach ($checks as $what => $ok) {
            if (!$ok) {
                throw new \RuntimeException("ID token rejected ($what check failed)");
            }
        }
        return $c;
    }
}
