<?php

declare(strict_types=1);

// Local overrides — copy to config.local.php (git-ignored, blocked in .htaccess).
// Only include the keys you want to override from config.php.
return [
    'oidc' => [
        'issuer'        => '',   // e.g. https://sso.example.com
        'client_id'     => '',
        'client_secret' => '',   // empty = public client (PKCE only)

        // Who may sign in. Fill at least one list if sign-up is open on your provider.
        'allowed_emails' => [],  // ['you@example.com']
    ],

    // Secret for the web-cron URL: https://<your-site>/api/cron?key=<this>
    // Generate one with: php -r 'echo bin2hex(random_bytes(24)), PHP_EOL;'
    'cron_key' => '',

    // Île-de-France Mobilités PRIM API key for live RER A info (free:
    // https://prim.iledefrance-mobilites.fr → create account → "Mon jeton").
    'prim_api_key' => '',
];
