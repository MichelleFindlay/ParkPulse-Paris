<?php

declare(strict_types=1);

/*
 * Park Pulse configuration template. Copy to config.php (git-ignored).
 *
 * Don't edit this file on a server — create config.local.php next to it that
 * returns an array with just the keys you want to override, e.g.
 *
 *   <?php return ['pin' => '4711'];
 */
return [
    'app_name' => 'Park Pulse',
    'timezone' => 'Europe/Paris',

    // First visit (inclusive, park-local dates). More are added in the app under Mine → Visits.
    // Changing these adds a new visit, or corrects the one they overlap.
    'trip' => [
        'start' => '2026-11-04',
        'end'   => '2026-11-06',
    ],

    // SQLite file. Created (with its directory) on first request.
    'db_path' => __DIR__ . '/data/parkpulse.sqlite',

    // Login. If an OIDC issuer is configured, OIDC is used; otherwise the PIN
    // (if set); otherwise the app is open. Put real values in config.local.php.
    'pin' => (string) (getenv('PARK_PULSE_PIN') ?: ''),

    'oidc' => [
        // e.g. https://accounts.google.com, https://auth.example.com/application/o/park-pulse/
        'issuer'        => (string) (getenv('PARK_PULSE_OIDC_ISSUER') ?: ''),
        'client_id'     => (string) (getenv('PARK_PULSE_OIDC_CLIENT_ID') ?: ''),
        'client_secret' => (string) (getenv('PARK_PULSE_OIDC_CLIENT_SECRET') ?: ''), // empty = public client (PKCE only)
        'scopes'        => 'openid email profile',

        // Leave empty to auto-detect https://<host>/auth/callback. Register this exact
        // URL with your identity provider.
        'redirect_uri'  => '',

        // Who may sign in. With a public provider (Google, Microsoft…) you MUST fill at
        // least one list, otherwise anyone with an account there gets in.
        'allowed_emails'  => [],   // ['me@example.com', 'partner@example.com']
        'allowed_domains' => [],   // ['example.com']
        'allowed_subs'    => [],   // provider user IDs

        'session_days' => 30,
    ],

    'themeparks_base' => 'https://api.themeparks.wiki/v1',
    'queuetimes_base' => 'https://queue-times.com',

    // Queue-Times park IDs are looked up from /parks.json by name. Set them here
    // only if that lookup ever breaks, e.g. ['dlp' => 4, 'studios' => 28].
    'queuetimes_park_ids' => [],

    'user_agent'   => 'ParkPulse/1.0 (personal trip tracker; PHP)',
    'http_timeout' => 8,

    // Cache lifetimes in seconds. Stale entries are still served if an upstream is down.
    'ttl' => [
        'destinations'  => 7 * 86400,
        'children'      => 12 * 3600, // under a day, so the daily new-rides check sees fresh lists
        'live'          => 60,
        'schedule'      => 3600,
        'show_schedule' => 6 * 3600,
        'qt_parks'      => 7 * 86400,
        'qt_live'       => 120,
        'qt_lands'      => 86400,
    ],

    // Store a wait-time snapshot per park at most this often (powers trends + "usually").
    'snapshot_every' => 300,

    // Push notifications (standard Web Push, keys generated automatically).
    // 'push_subject' identifies you to the browsers' push services: your site URL or a
    // mailto: address. Empty = the site URL seen when the first phone subscribed.
    'push_subject' => '',
    // Morning brief time on trip days (and the day before).
    'brief_time' => '08:00',

    // Optional: lets a web-cron service call /api/cron?key=… (see README). Empty = off;
    // the CLI collector (php bin/collect.php) works without it.
    'cron_key' => (string) (getenv('PARK_PULSE_CRON_KEY') ?: ''),

    // Shops come from OpenStreetMap. Box around both parks + Disney Village
    // [south, west, north, east], and the Village part of it.
    'shops_bbox'   => [48.8620, 2.7700, 48.8770, 2.7920],
    'village_bbox' => [48.8655, 2.7815, 48.8750, 2.7920],
    // Restaurants/bars/cinema for Disney Village + the Disney hotels (opening hours from OSM).
    'venues_bbox'  => [48.8640, 2.7800, 48.8770, 2.7990],
    'overpass_urls' => [
        'https://overpass-api.de/api/interpreter',
        'https://overpass.private.coffee/api/interpreter',
        'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    ],

    // Map tiles for the Map tab (OpenStreetMap's own tiles are fine for light personal use;
    // swap in another XYZ provider if you prefer). Must be https.
    'map_tiles'       => 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    'map_attribution' => '© OpenStreetMap contributors',

    // Live RER A info (Île-de-France Mobilités PRIM API). Free key from
    // https://prim.iledefrance-mobilites.fr — leave empty to hide the trains card.
    'prim_api_key' => (string) (getenv('PARK_PULSE_PRIM_KEY') ?: ''),
    'transit' => [
        'label'     => 'RER A · Marne-la-Vallée–Chessy',
        'stop_area' => '43239',   // IDFM zone d'arrêt for Marne-la-Vallée–Chessy (rail)
        'line'      => 'C01742',  // IDFM line id for RER A
    ],
];
