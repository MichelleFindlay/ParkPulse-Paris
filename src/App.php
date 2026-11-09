<?php

declare(strict_types=1);

namespace ParkPulse;

final class App
{
    /** Park Pulse release (semantic versioning). Shown in the footer, About, /api/health and the docs. */
    public const VERSION = '1.0.0';
    private const PHOTO_MAX = 400000; // bytes, after the phone has shrunk it
    private const PHOTO_BODY_MAX = 600000; // the same photo as base64 in JSON

    private \PDO $db;
    private Http $http;
    private Cache $cache;
    private ParkService $parks;
    private UserData $user;
    private QueueTimes $qt;
    private Auth $auth;
    private Transit $transit;
    private PushStore $pushStore;
    private Party $party;
    private Visits $visits;
    private Catalog $catalog;
    private string $base = '';

    public function __construct(private array $config)
    {
        $this->db = Db::connect($config['db_path']);
        // Everything below reads the trip from config, so give it the current visit.
        $this->visits = new Visits($this->db, new \DateTimeZone($config['timezone']), (array) $config['trip']);
        $config['trip'] = $this->config['trip'] = $this->visits->current();
        $this->http = new Http($config['user_agent'], (int) $config['http_timeout']);
        $this->cache = new Cache($this->db);
        if (random_int(1, 200) === 1) {
            $this->cache->prune();
        }
        $tp = new ThemeParks($this->http, $this->cache, $config['themeparks_base'], $config['ttl']);
        $this->qt = new QueueTimes($this->http, $this->cache, $config['queuetimes_base'], $config['ttl']);
        $this->parks = new ParkService($tp, $this->qt, $this->db, $config);
        $this->catalog = new Catalog($this->db, $tp, $this->parks, new \DateTimeZone($config['timezone']));
        $this->user = new UserData($this->db, new \DateTimeZone($config['timezone']));
        $this->transit = new Transit($this->http, $this->cache, $config['transit'], (string) $config['prim_api_key']);
        $this->pushStore = new PushStore($this->db);
        $this->party = new Party($this->db, new \DateTimeZone($config['timezone']));
    }

    private function webPush(): WebPush
    {
        $subject = (string) ($this->config['push_subject'] ?? '');
        if ($subject === '') {
            $subject = (string) ($this->db->query("SELECT value FROM meta WHERE key = 'site_origin'")->fetchColumn() ?: 'mailto:park-pulse@example.invalid');
        }
        return new WebPush($this->db, $subject, $this->config['user_agent']);
    }

    private function osm(): OsmShops
    {
        return new OsmShops(
            $this->http,
            $this->cache,
            (array) $this->config['overpass_urls'],
            (array) $this->config['shops_bbox'],
            (array) $this->config['venues_bbox'],
        );
    }

    /** A markdown page from the project root, with {{placeholders}} filled from config. */
    private function markdownPage(string $name, string $title): array
    {
        $file = dirname(__DIR__) . '/' . basename($name);
        $md = is_file($file) ? (string) file_get_contents($file) : "# {$title}\n\n{$name} is missing on the server.";
        $md = strtr($md, [
            '{{trip_dates}}' => $this->tripDates(),
            '{{app_name}}'   => (string) $this->config['app_name'],
            '{{version}}'    => self::VERSION,
        ]);
        return ['markdown' => $md, 'updated' => is_file($file) ? (int) filemtime($file) : null];
    }

    /** Trip dates from config as readable text: "4–6 November 2026", "30 October – 2 November 2026", … */
    private function tripDates(): string
    {
        $tz = new \DateTimeZone($this->config['timezone']);
        try {
            $a = new \DateTimeImmutable((string) $this->config['trip']['start'], $tz);
            $b = new \DateTimeImmutable((string) $this->config['trip']['end'], $tz);
        } catch (\Throwable) {
            return 'our trip dates';
        }
        if ($a->format('Y-m-d') === $b->format('Y-m-d')) {
            return $a->format('j F Y');
        }
        if ($a->format('Y-m') === $b->format('Y-m')) {
            return $a->format('j') . '–' . $b->format('j F Y');
        }
        if ($a->format('Y') === $b->format('Y')) {
            return $a->format('j F') . ' – ' . $b->format('j F Y');
        }
        return $a->format('j F Y') . ' – ' . $b->format('j F Y');
    }

    private function walkGraph(): WalkGraph
    {
        return new WalkGraph($this->http, $this->cache, (array) $this->config['overpass_urls'], (array) ($this->config['walk_bbox'] ?? [48.86, 2.768, 48.878, 2.80]));
    }

    private function wrapped(): Wrapped
    {
        return new Wrapped($this->db, $this->parks, $this->cache, $this->http, $this->party, $this->visits, $this->config);
    }

    private function weather(): Weather
    {
        $loc = $this->parks->location();
        return new Weather($this->http, $this->cache, $this->config['timezone'], $loc['lat'], $loc['lng']);
    }

    /**
     * Refresh everything that builds history (wait snapshots, downtime events) and warm
     * the caches. Run every 5 minutes from cron: php bin/collect.php
     */
    public function collect(): array
    {
        // Never let two runs overlap (a slow upstream can make one take > 5 min).
        $lockFile = dirname($this->config['db_path']) . '/collect.lock';
        $lock = @fopen($lockFile, 'c');
        if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) {
            return ['at' => date(DATE_ATOM), 'skipped' => 'another collector run is still in progress'];
        }

        try {
            $out = ['at' => date(DATE_ATOM)];
            $liveByPark = [];
            foreach (ParkService::KEYS as $key) {
                try {
                    if (!$this->parks->inOperatingWindow($key)) {
                        $out[$key] = ['ok' => true, 'skipped' => 'outside park hours'];
                        continue;
                    }
                    $live = $this->parks->live($key);
                    $liveByPark[$key] = $live;
                    $out[$key] = ['ok' => true, 'items' => count($live['items']), 'crowd' => $live['crowd']['label'] ?? null];
                } catch (\Throwable $e) {
                    $out[$key] = ['ok' => false, 'error' => $e->getMessage()];
                }
            }
            foreach (ParkService::KEYS as $key) {
                try {
                    $this->parks->restaurantSchedules($key); // warms the per-restaurant schedule cache
                } catch (\Throwable) {
                }
            }
            try {
                $this->parks->menus(new MenuFinder($this->cache, $this->config['user_agent'])); // weekly menu-PDF lookup
            } catch (\Throwable) {
            }
            try {
                $this->walkGraph()->graph(); // fortnightly walking-network refresh
                (new Essentials($this->http, $this->cache, (array) $this->config['overpass_urls'], (array) ($this->config['walk_bbox'] ?? [48.86, 2.768, 48.878, 2.80])))->fetch();
            } catch (\Throwable) {
            }
            try {
                $out['shops'] = ['ok' => true, 'count' => count($this->parks->shops($this->osm())['items'])];
            } catch (\Throwable $e) {
                $out['shops'] = ['ok' => false, 'error' => $e->getMessage()];
            }
            try {
                $this->weather()->forecast();
                $out['weather'] = ['ok' => true];
            } catch (\Throwable $e) {
                $out['weather'] = ['ok' => false, 'error' => $e->getMessage()];
            }
            try {
                if ($this->catalog->due()) {
                    $out['catalog'] = $this->catalog->check();
                }
            } catch (\Throwable $e) {
                $out['catalog'] = ['ok' => false, 'error' => $e->getMessage()];
            }
            try {
                $this->wrapped()->freezeEnded();
            } catch (\Throwable $e) {
                $out['visits'] = ['ok' => false, 'error' => $e->getMessage()];
            }
            if (WebPush::available()) {
                try {
                    $notifier = new Notifier(
                        $this->pushStore, $this->webPush(), $this->parks, $this->party, $this->db, $this->config,
                        fn () => $this->weather()->forecast(),
                        fn () => $this->transit->status(),
                    );
                    $out['push'] = $notifier->run($liveByPark);
                } catch (\Throwable $e) {
                    $out['push'] = ['ok' => false, 'error' => $e->getMessage()];
                }
            }
            $this->db->prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('collector:last', ?)")
                ->execute([(string) time()]);
            return $out;
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    public function run(): void
    {
        self::isolationHeaders();
        $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        [$this->base, $path] = $this->paths();
        $this->auth = new Auth($this->db, $this->config, $this->http, $this->cache, $this->base);

        if ($path === '/auth/login' || $path === '/auth/callback') {
            $this->oidcRoute($path);
            return;
        }

        if (!str_starts_with($path, '/api/')) {
            if ($method !== 'GET' && $method !== 'HEAD') {
                $this->json(405, ['error' => 'Method not allowed']);
                return;
            }
            $this->page();
            return;
        }

        try {
            if ($method !== 'GET' && ($_SERVER['HTTP_X_PARK_PULSE'] ?? '') !== '1') {
                throw new HttpError(403, 'Missing X-Park-Pulse header');
            }
            $open = ['/api/bootstrap', '/api/login', '/api/logout', '/api/health', '/api/cron'];
            if (!in_array($path, $open, true) && !$this->auth->authed()) {
                throw new HttpError(401, 'Sign-in required');
            }
            $result = $this->router()->dispatch($method, $path);
            if ($result !== null) {
                $this->json(200, $result);
            }
        } catch (HttpError $e) {
            $this->json($e->status, ['error' => $e->getMessage()]);
        } catch (UpstreamException $e) {
            $this->json(502, ['error' => 'Upstream unavailable: ' . $e->getMessage()]);
        } catch (\Throwable $e) {
            error_log('[park-pulse] ' . $e);
            $this->json(500, ['error' => 'Server error: ' . $e->getMessage()]);
        }
    }

    private function router(): Router
    {
        $r = new Router();

        $r->add('GET', '/api/bootstrap', function (): array {
            $out = [
                'appName'  => $this->config['app_name'],
                'version'  => self::VERSION,
                'timezone' => $this->config['timezone'],
                'trip'     => $this->config['trip'],
                'visits'   => $this->visits->all(),
                'today'    => $this->parks->today(),
                'cronLast' => $this->parks->cronLast(),
                'auth'     => $this->auth->mode(),
                'authed'   => $this->auth->authed(),
                'user'     => $this->publicUser($this->auth->user()),
                'needsProfile' => $this->auth->needsProfile(),
                'parks'    => [],
                'transit'  => $this->transit->enabled(),
                'w3w'      => (string) ($this->config['w3w_api_key'] ?? '') !== '',
                'map'      => ['tiles' => $this->config['map_tiles'], 'attribution' => $this->config['map_attribution']],
                'error'    => null,
            ];
            try {
                $out['parks'] = array_values(array_map(
                    [$this->parks, 'publicPark'],
                    $this->parks->parks()['parks'],
                ));
            } catch (\Throwable $e) {
                $out['error'] = $e->getMessage();
            }
            return $out;
        });

        // Deployment self-check — open /api/health in a browser after uploading.
        $r->add('GET', '/api/health', fn () => $this->health());

        $r->add('POST', '/api/login', function (): array {
            $this->auth->loginPin((string) ($this->body()['pin'] ?? ''));
            return ['ok' => true];
        });

        $r->add('POST', '/api/logout', fn () => ['ok' => true, 'redirect' => $this->auth->logout()]);

        // ---- PIN-mode profiles: choose / create / switch who you are
        $r->add('GET', '/api/profiles', fn () => ['profiles' => $this->auth->profiles(), 'current' => $this->auth->user()['profileId'] ?? null]);
        $r->add('POST', '/api/profiles', function (): array {
            $b = $this->body();
            $name = trim(preg_replace('/\s+/u', ' ', (string) ($b['name'] ?? '')) ?? '');
            $len = static fn (string $v): int => function_exists('mb_strlen') ? mb_strlen($v) : strlen($v);
            if ($name === '' || $len($name) > 30) {
                throw new HttpError(422, 'Enter a name (up to 30 characters)');
            }
            $emoji = (string) ($b['emoji'] ?? '🙂');
            if (!self::validEmoji($emoji)) {
                $emoji = '🙂';
            }
            return ['user' => $this->publicUser($this->auth->createProfile($name, $emoji)), 'profiles' => $this->auth->profiles()];
        });

        // ---- Profile picture / emoji (SSO users and PIN profiles)
        $r->add('POST', '/api/avatar', function (): array {
            $b = $this->body();
            $emoji = null;
            if (array_key_exists('emoji', $b) && $b['emoji'] !== null) {
                $emoji = trim((string) $b['emoji']);
                if ($emoji !== '' && !self::validEmoji($emoji)) {
                    throw new HttpError(422, 'Pick an emoji');
                }
            }
            $setImage = array_key_exists('image', $b);
            $image = $setImage && $b['image'] !== null && $b['image'] !== '' ? self::validAvatarImage((string) $b['image']) : null;
            return ['user' => $this->publicUser($this->auth->setAvatar($emoji, $image, $setImage))];
        });
        $r->add('POST', '/api/profiles/select', function (): array {
            return ['user' => $this->publicUser($this->auth->selectProfile((int) ($this->body()['id'] ?? 0))), 'profiles' => $this->auth->profiles()];
        });

        $r->add('GET', '/api/live/(?<park>dlp|studios)', fn (array $p) => $this->parks->live($p['park']));

        $r->add('GET', '/api/village', fn () => $this->parks->village($this->osm()));

        // Per-restaurant Disney schedules: today + every trip day.
        $r->add('GET', '/api/food-schedule/(?<park>dlp|studios)', fn (array $p) => $this->parks->restaurantSchedules($p['park']));

        $r->add('GET', '/api/shops', function (): array {
            try {
                return $this->parks->shops($this->osm());
            } catch (\Throwable $e) {
                // Overpass down and nothing cached yet: empty list, app keeps working.
                return ['items' => [], 'fetchedAt' => time(), 'stale' => true, 'error' => $e->getMessage()];
            }
        });

        $r->add('GET', '/api/weather', fn () => $this->weather()->forecast());

        $r->add('GET', '/api/essentials', function (): array {
            try {
                return (new Essentials($this->http, $this->cache, (array) $this->config['overpass_urls'], (array) ($this->config['walk_bbox'] ?? [48.86, 2.768, 48.878, 2.80])))->fetch();
            } catch (\Throwable $e) {
                return ['items' => [], 'fetchedAt' => time(), 'stale' => true, 'error' => $e->getMessage()];
            }
        });

        // Walking network for in-app navigation (big, so gzip it when the client accepts it).
        $r->add('GET', '/api/walk-graph', function (): null {
            $g = $this->walkGraph()->graph();
            header('Content-Type: application/json; charset=utf-8');
            header('Cache-Control: private, max-age=86400');
            $json = json_encode($g, JSON_UNESCAPED_SLASHES);
            if (function_exists('gzencode') && str_contains((string) ($_SERVER['HTTP_ACCEPT_ENCODING'] ?? ''), 'gzip') && !ini_get('zlib.output_compression')) {
                header('Content-Encoding: gzip');
                header('Vary: Accept-Encoding');
                $json = gzencode($json, 6);
            }
            echo $json;
            return null;
        });

        // what3words lookup for one point (on demand; nothing is stored server-side).
        $r->add('GET', '/api/w3w', function (): array {
            $w = new What3Words($this->http, (string) ($this->config['w3w_api_key'] ?? ''), (string) ($this->config['w3w_language'] ?? 'en'));
            if (!$w->enabled()) {
                throw new HttpError(404, 'what3words is not set up (add w3w_api_key)');
            }
            $lat = (float) ($_GET['lat'] ?? 0);
            $lng = (float) ($_GET['lng'] ?? 0);
            if (abs($lat) > 90 || abs($lng) > 180 || ($lat == 0.0 && $lng == 0.0)) {
                throw new HttpError(422, 'Bad coordinates');
            }
            return $w->toWords($lat, $lng);
        });

        $r->add('GET', '/api/transit', fn () => $this->transit->status());

        // Web-cron alternative to bin/collect.php: /api/cron?key=<cron_key>
        $r->add('GET', '/api/cron', function (): array {
            $key = (string) $this->config['cron_key'];
            if ($key === '' || !hash_equals($key, (string) ($_GET['key'] ?? ''))) {
                throw new HttpError(403, 'Cron is disabled or the key is wrong');
            }
            // At most one run per 4 minutes, whoever calls it.
            $last = (int) ($this->db->query("SELECT value FROM meta WHERE key = 'collector:last'")->fetchColumn() ?: 0);
            if (time() - $last < 240) {
                return ['ok' => true, 'skipped' => 'ran ' . (time() - $last) . ' s ago'];
            }
            return $this->collect();
        });

        $r->add('GET', '/api/history/(?<id>[A-Za-z0-9_-]{1,80})', fn (array $p) => $this->parks->history($p['id']));

        $r->add('GET', '/api/trip', fn () => $this->catalog->mergeTrip($this->parks->trip()));
        $r->add('GET', '/api/catalog', fn () => $this->catalog->data());

        $r->add('GET', '/api/best-times', fn () => $this->parks->bestTimes());

        $r->add('GET', '/api/crowd-calendar', function (): array {
            $tz = new \DateTimeZone($this->config['timezone']);
            $from = (new \DateTimeImmutable('now', $tz))->modify('-14 days')->format('Y-m-d');
            return (new CrowdCalendar($this->parks, $this->db, $tz))->range($from, 75);
        });

        $r->add('GET', '/api/touring-plans', fn () => $this->parks->touringPlans());

        $r->add('GET', '/api/menus', fn () => [
            'menus'    => $this->parks->menus(new MenuFinder($this->cache, $this->config['user_agent'])) ?: new \stdClass(),
            'fallback' => [
                ['Disneyphile — current menus for every park restaurant', 'https://www.disneyphile.fr/menus-restaurants-parcs-disney/'],
                ['julieears.com — restaurant guides with menus & prices', 'https://julieears.com/en/restaurants/'],
            ],
        ]);

        // FEATURES.md for the in-app About → Features page (one source of truth).
        $r->add('GET', '/api/features', fn () => $this->markdownPage('FEATURES.md', 'Features'));
        $r->add('GET', '/api/docs', fn () => $this->markdownPage('DOCS.md', 'Documentation'));

        $r->add('GET', '/api/guide', function (): array {
            $file = dirname(__DIR__) . '/guide.php';
            $g = is_file($file) ? require $file : [];
            return is_array($g) ? $g : [];
        });

        // ---- party ratings for restaurants
        $r->add('GET', '/api/ratings', fn () => ['ratings' => $this->party->ratings($this->device($_GET['device'] ?? null)) ?: new \stdClass()]);
        $r->add('POST', '/api/ratings', function (): array {
            $b = $this->body();
            $device = $this->device($b['device'] ?? null);
            $stars = (int) ($b['stars'] ?? 0);
            if ($stars < 0 || $stars > 5) {
                throw new HttpError(422, 'Stars must be 0–5');
            }
            $by = $this->auth->user()['name'] ?? ($this->text($b['by'] ?? '', 40, false) ?: null);
            $this->party->rate($this->entityId($b['id'] ?? null), $device, $this->text($b['name'] ?? null, 200, true),
                $stars, $this->text($b['note'] ?? '', 300, false), $by);
            return ['ratings' => $this->party->ratings($device) ?: new \stdClass()];
        });

        // ---- push notifications (standard Web Push)
        $r->add('GET', '/api/push/key', fn () => [
            'available' => WebPush::available(),
            'publicKey' => WebPush::available() ? $this->webPush()->publicKey() : null,
        ]);
        $r->add('POST', '/api/push/subscribe', function (): array {
            $b = $this->body();
            $sub = $b['subscription'] ?? [];
            $endpoint = $this->pushEndpoint($sub['endpoint'] ?? null);
            $p256dh = (string) ($sub['keys']['p256dh'] ?? '');
            $auth = (string) ($sub['keys']['auth'] ?? '');
            if (!preg_match('/^[A-Za-z0-9_-]{80,100}$/', $p256dh) || !preg_match('/^[A-Za-z0-9_-]{16,32}$/', $auth)) {
                throw new HttpError(422, 'Bad subscription keys');
            }
            $this->db->prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('site_origin', ?)")
                ->execute([$this->origin()]);
            $this->pushStore->subscribe($endpoint, $p256dh, $auth, $this->device($b['device'] ?? null),
                $this->auth->user(), is_array($b['prefs'] ?? null) ? $b['prefs'] : []);
            if (is_array($b['alerts'] ?? null)) {
                $this->pushStore->setAlerts($endpoint, $b['alerts']);
            }
            return ['ok' => true, 'status' => $this->pushStore->status($endpoint)];
        });
        $r->add('POST', '/api/push/unsubscribe', function (): array {
            $this->pushStore->unsubscribe($this->pushEndpoint($this->body()['endpoint'] ?? null));
            return ['ok' => true];
        });
        $r->add('POST', '/api/push/prefs', function (): array {
            $b = $this->body();
            $endpoint = $this->pushEndpoint($b['endpoint'] ?? null);
            $this->pushStore->setPrefs($endpoint, is_array($b['prefs'] ?? null) ? $b['prefs'] : []);
            return ['ok' => true, 'status' => $this->pushStore->status($endpoint)];
        });
        $r->add('POST', '/api/push/alerts', function (): array {
            $b = $this->body();
            $endpoint = $this->pushEndpoint($b['endpoint'] ?? null);
            $this->pushStore->setAlerts($endpoint, is_array($b['alerts'] ?? null) ? $b['alerts'] : []);
            return ['ok' => true, 'status' => $this->pushStore->status($endpoint)];
        });
        $r->add('POST', '/api/push/status', function (): array {
            $ran = $this->db->query("SELECT value FROM meta WHERE key = 'collector:last'")->fetchColumn();
            return [
                'status'    => $this->pushStore->status($this->pushEndpoint($this->body()['endpoint'] ?? null)),
                'cronLast'  => $ran ? (int) $ran : null,
                'log'       => array_slice(WebPush::readLog($this->db), 0, 8),
                'subject'   => (string) ($this->config['push_subject'] ?: ($this->db->query("SELECT value FROM meta WHERE key = 'site_origin'")->fetchColumn() ?: '')),
                'available' => WebPush::available(),
            ];
        });
        $r->add('POST', '/api/push/test', function (): array {
            $endpoint = $this->pushEndpoint($this->body()['endpoint'] ?? null);
            $id = $this->pushStore->idFor($endpoint);
            if ($id === null) {
                throw new HttpError(404, 'This phone is not subscribed');
            }
            foreach ($this->pushStore->all() as $sub) {
                if ((int) $sub['id'] === $id) {
                    $wp = $this->webPush();
                    try {
                        $code = $wp->send($sub, ['title' => 'Park Pulse', 'body' => 'Notifications work on this phone ✨', 'tag' => 'test', 'url' => './#tab=mine'], 300, 'high');
                    } catch (\Throwable $e) {
                        return ['ok' => false, 'code' => 0, 'reason' => 'Server could not encrypt/sign: ' . $e->getMessage()];
                    }
                    if ($code === 404 || $code === 410) {
                        $this->pushStore->delete($id);
                    }
                    return ['ok' => $code >= 200 && $code < 300, 'code' => $code, 'reason' => $wp->lastReason];
                }
            }
            throw new HttpError(404, 'Subscription not found');
        });

        // ---- bookings (shared by the party)
        $r->add('GET', '/api/bookings', fn () => ['bookings' => $this->party->bookings()]);
        $r->add('POST', '/api/bookings', function (): array {
            $b = $this->body();
            $kind = (string) ($b['kind'] ?? 'RESTAURANT');
            if (!in_array($kind, Party::BOOKING_KINDS, true)) {
                throw new HttpError(422, 'Unknown booking type');
            }
            $at = strtotime((string) ($b['at'] ?? '')) ?: 0;
            if ($at < time() - 86400 || $at > time() + 400 * 86400) {
                throw new HttpError(422, 'Pick a valid date and time');
            }
            $ends = !empty($b['endsAt']) ? (strtotime((string) $b['endsAt']) ?: null) : null;
            $entity = isset($b['entityId']) && is_string($b['entityId']) && preg_match('/^[A-Za-z0-9_-]{1,80}$/', $b['entityId']) ? $b['entityId'] : null;
            $park = isset($b['park']) && in_array($b['park'], UserData::AREAS, true) ? $b['park'] : null;
            $this->party->addBooking($kind, $this->text($b['name'] ?? null, 200, true), $entity, $park, $at,
                $ends && $ends > $at ? $ends : null, $this->text($b['note'] ?? '', 300, false), $this->auth->user()['name'] ?? null);
            return ['bookings' => $this->party->bookings()];
        });
        $r->add('DELETE', '/api/bookings/(?<id>\d{1,12})', function (array $p): array {
            if (!$this->party->deleteBooking((int) $p['id'])) {
                throw new HttpError(404, 'Booking not found');
            }
            return ['bookings' => $this->party->bookings()];
        });

        // ---- party: opt-in live locations + meet-here pin
        $r->add('GET', '/api/party', fn () => $this->party->state());
        $r->add('POST', '/api/party/location', function (): array {
            $b = $this->body();
            $lat = (float) ($b['lat'] ?? 0);
            $lng = (float) ($b['lng'] ?? 0);
            if (abs($lat) > 90 || abs($lng) > 180 || ($lat == 0.0 && $lng == 0.0)) {
                throw new HttpError(422, 'Bad location');
            }
            $name = $this->auth->user()['name'] ?? $this->text($b['name'] ?? null, 40, true);
            $this->party->setLocation($this->device($b['device'] ?? null), $name, $lat, $lng,
                isset($b['acc']) ? min(5000.0, (float) $b['acc']) : null);
            return $this->party->state();
        });
        $r->add('POST', '/api/party/stop', function (): array {
            $this->party->stopSharing($this->device($this->body()['device'] ?? null));
            return $this->party->state();
        });
        $r->add('POST', '/api/meet', function (): array {
            $b = $this->body();
            $lat = (float) ($b['lat'] ?? 0);
            $lng = (float) ($b['lng'] ?? 0);
            if (abs($lat) > 90 || abs($lng) > 180) {
                throw new HttpError(422, 'Bad location');
            }
            $by = $this->auth->user()['name'] ?? $this->text($b['by'] ?? '', 40, false);
            $this->party->setMeet($lat, $lng, $this->text($b['label'] ?? 'Meet here', 80, false) ?: 'Meet here', $by ?: null);
            return $this->party->state();
        });
        $r->add('DELETE', '/api/meet', function (): array {
            $this->party->clearMeet();
            return $this->party->state();
        });

        // ---- day plan (shared by the party: set it once, everyone sees it)
        $r->add('GET', '/api/plan', fn () => ['plan' => $this->party->getPlan()]);
        $r->add('POST', '/api/plan', function (): array {
            $b = $this->body();
            $plan = is_array($b['plan'] ?? null) ? $b['plan'] : null;
            if ($plan === null) {
                $this->party->clearPlan();
                $this->pushStore->broadcastPlan(null);
                return ['plan' => null];
            }
            $by = $this->auth->user()['name'] ?? $this->text($b['by'] ?? '', 40, false);
            $clean = $this->party->setPlan($plan, $by ?: null);
            if ($clean === null) {
                throw new HttpError(422, 'Invalid plan');
            }
            $this->pushStore->broadcastPlan([
                'date'  => $clean['date'],
                'items' => array_values(array_map(
                    fn ($it) => ['id' => $it['id'], 'park' => $clean['park'], 'name' => $it['name'], 'start' => $it['start']],
                    array_filter($clean['items'], fn ($it) => $it['kind'] === 'ride')
                )),
            ]);
            return ['plan' => $this->party->getPlan()];
        });
        $r->add('DELETE', '/api/plan', function (): array {
            $this->party->clearPlan();
            $this->pushStore->broadcastPlan(null);
            return ['plan' => null];
        });

        $r->add('GET', '/api/me', fn () => $this->user->me($this->auth->user()));
        $wrapped = fn () => $this->wrapped();
        $r->add('GET', '/api/wrapped', function () use ($wrapped): array {
            if (!isset($_GET['visit'])) {
                return $wrapped()->data();
            }
            $visit = ctype_digit((string) $_GET['visit']) ? $this->visits->find((int) $_GET['visit']) : null;
            if ($visit === null) {
                throw new HttpError(404, 'Visit not found');
            }
            return $wrapped()->data($visit);
        });

        $visitList = fn () => ['visits' => $this->visits->all(), 'current' => $this->visits->current()];
        $r->add('GET', '/api/visits', $visitList);
        $r->add('POST', '/api/visits', function () use ($visitList): array {
            $b = $this->body();
            $this->visits->save(
                isset($b['id']) ? (int) $b['id'] : null,
                $this->text($b['name'] ?? '', 60, false),
                $this->text($b['start'] ?? '', 10, false),
                $this->text($b['end'] ?? '', 10, false),
                $this->auth->user()['name'] ?? null,
            );
            return $visitList();
        });
        $r->add('POST', '/api/visits/(?<id>\d{1,12})/budget', function (array $p) use ($visitList): array {
            $this->visits->setBudget((int) $p['id'], self::cents($this->body()['amount'] ?? null));
            return $visitList();
        });
        $r->add('DELETE', '/api/visits/(?<id>\d{1,12})', function (array $p) use ($visitList): array {
            $this->visits->delete((int) $p['id']);
            return $visitList();
        });
        $r->add('POST', '/api/wrapped/roasts', function () use ($wrapped): array {
            $name = (string) ($this->auth->user()['name'] ?? '');
            if ($name === '') {
                throw new HttpError(422, 'Sign in to change this');
            }
            return ['noRoast' => $wrapped()->setRoasts($name, (bool) ($this->body()['on'] ?? true))];
        });

        $r->add('POST', '/api/favourites', function (): array {
            $b = $this->body();
            $this->user->setFavourite(
                $this->entityId($b['id'] ?? null),
                $this->area($b['park'] ?? null),
                $this->text($b['name'] ?? null, 200, true),
                (bool) ($b['on'] ?? true),
            );
            return $this->user->me($this->auth->user());
        });

        $r->add('POST', '/api/log', function (): array {
            $b = $this->body();
            $wait = $b['wait'] ?? null;
            if ($wait !== null && $wait !== '') {
                if (!is_numeric($wait) || (int) $wait < 0 || (int) $wait > 600) {
                    throw new HttpError(422, 'Wait must be 0–600 minutes');
                }
                $wait = (int) $wait;
            } else {
                $wait = null;
            }
            $posted = $b['posted'] ?? null;
            if ($posted !== null && (!is_numeric($posted) || (int) $posted < 0 || (int) $posted > 600)) {
                throw new HttpError(422, 'Posted wait must be 0–600 minutes');
            }
            $posted = $posted === null ? null : (int) $posted;
            $type = (string) ($b['queueType'] ?? 'STANDBY');
            if (!in_array($type, UserData::QUEUE_TYPES, true)) {
                throw new HttpError(422, 'Unknown queue type');
            }
            $at = time();
            if (!empty($b['riddenAt'])) {
                $at = is_numeric($b['riddenAt']) ? (int) $b['riddenAt'] : (strtotime((string) $b['riddenAt']) ?: 0);
                if ($at < 946684800 || $at > time() + 86400) {
                    throw new HttpError(422, 'Invalid time');
                }
            }
            $this->user->addLog(
                $this->entityId($b['id'] ?? null),
                $this->area($b['park'] ?? null),
                $this->text($b['name'] ?? null, 200, true),
                $wait,
                $posted,
                $type,
                $this->text($b['note'] ?? '', 500, false),
                $at,
                $this->auth->user(),
            );
            return $this->user->me($this->auth->user());
        });

        $r->add('DELETE', '/api/log/(?<id>\d{1,12})', function (array $p): array {
            if (!$this->user->deleteLog((int) $p['id'])) {
                throw new HttpError(404, 'Log entry not found');
            }
            return $this->user->me($this->auth->user());
        });

        $r->add('POST', '/api/watched', function (): array {
            $b = $this->body();
            $at = time();
            if (!empty($b['watchedAt'])) {
                $at = is_numeric($b['watchedAt']) ? (int) $b['watchedAt'] : (strtotime((string) $b['watchedAt']) ?: 0);
                if ($at < 946684800 || $at > time() + 86400) {
                    throw new HttpError(422, 'Invalid time');
                }
            }
            $this->user->addWatched(
                $this->entityId($b['id'] ?? null),
                $this->area($b['park'] ?? null),
                $this->text($b['name'] ?? null, 200, true),
                $this->text($b['note'] ?? '', 500, false),
                $at,
                $this->auth->user(),
            );
            return $this->user->me($this->auth->user());
        });

        $r->add('DELETE', '/api/watched/(?<id>\d{1,12})', function (array $p): array {
            if (!$this->user->deleteWatched((int) $p['id'])) {
                throw new HttpError(404, 'Entry not found');
            }
            return $this->user->me($this->auth->user());
        });

        $r->add('POST', '/api/places', function (): array {
            $b = $this->body();
            $kind = (string) ($b['kind'] ?? '');
            if (!in_array($kind, UserData::PLACE_KINDS, true)) {
                throw new HttpError(422, 'Unknown kind of place');
            }
            $at = time();
            if (!empty($b['visitedAt'])) {
                $at = is_numeric($b['visitedAt']) ? (int) $b['visitedAt'] : (strtotime((string) $b['visitedAt']) ?: 0);
                if ($at < 946684800 || $at > time() + 86400) {
                    throw new HttpError(422, 'Invalid time');
                }
            }
            $this->user->addPlace(
                $kind,
                $this->entityId($b['id'] ?? null),
                $this->area($b['park'] ?? null),
                $this->text($b['name'] ?? null, 200, true),
                $this->text($b['note'] ?? '', 500, false),
                self::cents($b['amount'] ?? null),
                $at,
                $this->auth->user(),
            );
            return $this->user->me($this->auth->user());
        });

        $r->add('DELETE', '/api/places/(?<id>\d{1,12})', function (array $p): array {
            if (!$this->user->deletePlace((int) $p['id'])) {
                throw new HttpError(404, 'Entry not found');
            }
            return $this->user->me($this->auth->user());
        });

        $r->add('POST', '/api/characters', function (): array {
            $b = $this->body(self::PHOTO_BODY_MAX);
            $at = time();
            if (!empty($b['metAt'])) {
                $at = is_numeric($b['metAt']) ? (int) $b['metAt'] : (strtotime((string) $b['metAt']) ?: 0);
                if ($at < 946684800 || $at > time() + 86400) {
                    throw new HttpError(422, 'Invalid time');
                }
            }
            $kind = (string) ($b['kind'] ?? 'met');
            if (!in_array($kind, UserData::CHARACTER_KINDS, true)) {
                throw new HttpError(422, 'Choose met or seen');
            }
            $this->user->addCharacter(
                $this->text($b['name'] ?? null, 60, true),
                $kind,
                $this->text($b['note'] ?? '', 500, false),
                empty($b['photo']) ? null : self::validPhoto((string) $b['photo']),
                $at,
                $this->auth->user(),
            );
            return $this->user->me($this->auth->user());
        });

        $r->add('GET', '/api/characters/(?<id>\d{1,12})/photo', function (array $p): null {
            $image = $this->user->characterPhoto((int) $p['id']);
            if ($image === null) {
                throw new HttpError(404, 'Photo not found');
            }
            header('Content-Type: image/jpeg');
            header('X-Content-Type-Options: nosniff');
            header('Cache-Control: private, max-age=31536000, immutable'); // ids are never reused
            echo $image;
            return null;
        });

        $r->add('DELETE', '/api/characters/(?<id>\d{1,12})', function (array $p): array {
            if (!$this->user->deleteCharacter((int) $p['id'])) {
                throw new HttpError(404, 'Entry not found');
            }
            return $this->user->me($this->auth->user());
        });

        $r->add('GET', '/api/export', function (): null {
            $data = [
                'exportedAt' => date(DATE_ATOM),
                'trip'       => $this->config['trip'],
                'visits'     => $this->visits->all(),
            ] + $this->user->me($this->auth->user());
            header('Content-Type: application/json; charset=utf-8');
            header('Content-Disposition: attachment; filename="park-pulse-' . date('Y-m-d') . '.json"');
            header('Cache-Control: no-store');
            echo json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            return null;
        });

        return $r;
    }

    // ------------------------------------------------------------- OIDC

    private function oidcRoute(string $path): void
    {
        header('Cache-Control: no-store');
        if ($this->auth->mode() !== 'oidc') {
            $this->redirect($this->base . '/');
            return;
        }
        try {
            if ($path === '/auth/login') {
                $this->redirect($this->auth->oidcStart());
            } else {
                $this->auth->oidcFinish($_GET);
                $this->redirect($this->base . '/');
            }
        } catch (\Throwable $e) {
            error_log('[park-pulse] OIDC: ' . $e->getMessage());
            $this->authErrorPage($e->getMessage());
        }
    }

    /**
     * Cross-origin isolation headers on every PHP response (static files get the same
     * from public/.htaccess). The only cross-origin resources the app loads are map
     * tiles, which are fetched with CORS, so require-corp doesn't block them.
     */
    public static function isolationHeaders(): void
    {
        if (headers_sent()) {
            return;
        }
        header('Cross-Origin-Embedder-Policy: require-corp');
        header('Cross-Origin-Opener-Policy: same-origin');
        header('Cross-Origin-Resource-Policy: same-origin');
        // HSTS: only meaningful (and only honoured) over HTTPS; skipped on http://localhost dev.
        $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
        if ($https) {
            header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
        }
    }

    private function redirect(string $url): void
    {
        header('Location: ' . $url, true, 302);
    }

    private function authErrorPage(string $message): void
    {
        $e = static fn (string $s): string => htmlspecialchars($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        http_response_code(400);
        header('Content-Type: text/html; charset=utf-8');
        header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
        $base = $e($this->base);
        $msg = $e($message);
        echo <<<HTML
        <!doctype html><html lang="en"><meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Sign-in problem · Park Pulse</title>
        <body style="font:16px/1.5 system-ui,sans-serif;max-width:28rem;margin:15vh auto;padding:0 1rem;text-align:center">
        <h1 style="font-size:1.3rem">Couldn’t sign you in</h1>
        <p>{$msg}</p>
        <p><a href="{$base}/auth/login">Try again</a> · <a href="{$base}/">Home</a></p>
        </body></html>
        HTML;
    }

    // ------------------------------------------------------------ health

    private function health(): array
    {
        $dataDir = dirname($this->config['db_path']);
        $outbound = function_exists('curl_init') ? 'curl' : (ini_get('allow_url_fopen') ? 'allow_url_fopen' : null);
        $mode = $this->auth->mode();
        $checks = [
            'park_pulse_version' => ['ok' => true, 'detail' => 'v' . self::VERSION],
            'php_8_2_or_newer'  => ['ok' => PHP_VERSION_ID >= 80200, 'detail' => PHP_VERSION],
            'pdo_sqlite'        => ['ok' => true, 'detail' => 'SQLite ' . $this->db->query('SELECT sqlite_version()')->fetchColumn()],
            'data_dir_writable' => ['ok' => is_writable($dataDir), 'detail' => $dataDir],
            'outbound_http'     => ['ok' => $outbound !== null, 'detail' => $outbound ?? 'needs the curl extension or allow_url_fopen=On'],
            'mbstring'          => ['ok' => function_exists('mb_strtolower'), 'detail' => 'optional'],
            'auth_mode'         => ['ok' => true, 'detail' => $mode],
        ];
        try {
            $p = $this->parks->parks();
            $checks['themeparks_wiki'] = ['ok' => true, 'detail' => implode(' + ', array_column($p['parks'], 'name'))];
        } catch (\Throwable $e) {
            $checks['themeparks_wiki'] = ['ok' => false, 'detail' => $e->getMessage()];
        }
        try {
            $this->qt->parks();
            $checks['queue_times'] = ['ok' => true, 'detail' => 'reachable'];
        } catch (\Throwable $e) {
            $checks['queue_times'] = ['ok' => false, 'detail' => $e->getMessage()];
        }
        try {
            $w = $this->weather()->forecast();
            $checks['weather_open_meteo'] = ['ok' => true, 'detail' => $w['current'] ? $w['current']['temp'] . '° ' . $w['current']['label'] : 'no current data'];
        } catch (\Throwable $e) {
            $checks['weather_open_meteo'] = ['ok' => false, 'detail' => $e->getMessage()];
        }
        try {
            $sh = $this->parks->shops($this->osm());
            $checks['shops_openstreetmap'] = ['ok' => !$sh['stale'] || (bool) $sh['items'], 'detail' => count($sh['items']) . ' shops' . ($sh['error'] ? ' (served from cache: ' . $sh['error'] . ')' : '')];
        } catch (\Throwable $e) {
            $checks['shops_openstreetmap'] = ['ok' => false, 'detail' => $e->getMessage()];
        }
        if ($this->transit->enabled()) {
            $t = $this->transit->status();
            $checks['trains_prim'] = ['ok' => !$t['errors'], 'detail' => $t['errors'] ? implode('; ', $t['errors']) : count($t['departures']) . ' departures'];
        } else {
            $checks['trains_prim'] = ['ok' => true, 'detail' => 'off (no prim_api_key)'];
        }
        $subs = (int) $this->db->query('SELECT COUNT(*) FROM push_subs')->fetchColumn();
        $checks['push_notifications'] = [
            'ok'     => WebPush::available(),
            'detail' => WebPush::available() ? "ready · {$subs} phone(s) subscribed" : 'needs the openssl extension with EC + aes-128-gcm (PHP 7.3+)',
        ];
        $plog = WebPush::readLog($this->db);
        if ($plog) {
            $l = $plog[0];
            $checks['push_last_delivery'] = [
                'ok'     => $l['code'] >= 200 && $l['code'] < 300,
                'detail' => "HTTP {$l['code']} from {$l['host']} " . (int) round((time() - $l['t']) / 60) . ' min ago' . ($l['reason'] !== '' ? " — {$l['reason']}" : ''),
            ];
        }
        $last = $this->db->query("SELECT MAX(value) FROM meta WHERE key LIKE 'snapshot:%'")->fetchColumn();
        $ran = $this->db->query("SELECT value FROM meta WHERE key = 'collector:last'")->fetchColumn();
        $ago = static fn ($t) => (int) round((time() - (int) $t) / 60) . ' min ago';
        $checks['history_collector'] = [
            'ok'     => true,
            'detail' => ($ran ? 'cron last ran ' . $ago($ran) : 'cron has never run — set it up (README)')
                . ' · ' . ($last ? 'last snapshot ' . $ago($last) : 'no snapshots yet'),
        ];
        if ($mode === 'oidc') {
            $checks['openssl'] = ['ok' => function_exists('openssl_verify'), 'detail' => 'needed to verify ID tokens'];
            try {
                $d = (new Oidc($this->config['oidc'], $this->http, $this->cache))->discovery();
                $checks['oidc_discovery'] = ['ok' => true, 'detail' => $d['issuer']];
            } catch (\Throwable $e) {
                $checks['oidc_discovery'] = ['ok' => false, 'detail' => $e->getMessage()];
            }
            $checks['oidc_redirect_uri'] = ['ok' => true, 'detail' => 'register this with your provider: ' . $this->auth->redirectUri()];
            $checks['oidc_allowlist'] = [
                'ok'     => true,
                'detail' => $this->auth->hasAllowlist() ? 'set' : 'EMPTY — anyone your provider authenticates can sign in',
            ];
        }
        $optional = ['mbstring' => 1, 'queue_times' => 1, 'weather_open_meteo' => 1, 'trains_prim' => 1, 'shops_openstreetmap' => 1, 'push_notifications' => 1, 'push_last_delivery' => 1];
        $required = array_diff_key($checks, $optional);
        return [
            'ok'     => !in_array(false, array_column($required, 'ok'), true),
            'checks' => $checks,
        ];
    }

    // ------------------------------------------------------------ requests

    /** @return array{string, string} [base path without trailing slash, app path] */
    private function paths(): array
    {
        $uri = (string) (parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');
        $scriptDir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/index.php')), '/');

        // Deployed with the docroot on public/ → base is the script dir. Deployed with the
        // project root as docroot (root .htaccess rewrites into public/) → strip "/public".
        $candidates = [$scriptDir];
        if (str_ends_with($scriptDir, '/public')) {
            $candidates[] = substr($scriptDir, 0, -strlen('/public'));
        }
        $base = '';
        foreach ($candidates as $c) {
            if ($c === '' || $uri === $c || str_starts_with($uri, $c . '/')) {
                $base = $c;
                break;
            }
        }
        $path = substr($uri, strlen($base));
        if (str_starts_with($path, '/index.php')) {
            $path = substr($path, strlen('/index.php'));
        }
        return [$base, $path === '' ? '/' : $path];
    }

    /** What the browser may see about the signed-in person. */
    private function publicUser(?array $u): ?array
    {
        return $u ? array_intersect_key($u, ['name' => 1, 'email' => 1, 'emoji' => 1, 'avatar' => 1, 'profileId' => 1]) : null;
    }

    private static function validEmoji(string $e): bool
    {
        $len = function_exists('mb_strlen') ? mb_strlen($e) : strlen($e) / 4;
        return $e !== '' && $len <= 8 && strlen($e) <= 32 && !preg_match('/[\p{L}\p{N}<>"\'\s]/u', $e);
    }

    /** A small JPEG/PNG/WebP sent as a data: URL (the app resizes to 160×160). Re-encoded so only clean base64 is stored. */
    /** An optional euro amount as whole cents. */
    private static function cents(mixed $amount): ?int
    {
        if ($amount === null || $amount === '') {
            return null;
        }
        if (!is_numeric($amount) || (float) $amount < 0 || (float) $amount > 100000) {
            throw new HttpError(422, 'Amount must be between 0 and 100,000 euros');
        }
        return (int) round((float) $amount * 100);
    }

    /** A character photo, already shrunk on the phone. Returns the raw JPEG. */
    private static function validPhoto(string $url): string
    {
        if (!preg_match('#^data:image/jpeg;base64,([A-Za-z0-9+/]+={0,2})$#', $url, $m)) {
            throw new HttpError(422, 'That photo isn’t a JPEG image');
        }
        $raw = base64_decode($m[1], true);
        if ($raw === false || strlen($raw) < 32 || strlen($raw) > self::PHOTO_MAX) {
            throw new HttpError(422, 'That photo is too big — pick another');
        }
        if (strncmp($raw, "\xFF\xD8\xFF", 3) !== 0) {
            throw new HttpError(422, 'That photo isn’t a valid image');
        }
        if (function_exists('getimagesizefromstring')) {
            $size = @getimagesizefromstring($raw);
            if (!$size || $size[0] > 2000 || $size[1] > 2000) {
                throw new HttpError(422, 'That photo isn’t a valid image');
            }
        }
        return $raw;
    }

    private static function validAvatarImage(string $url): string
    {
        if (!preg_match('#^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$#', $url, $m)) {
            throw new HttpError(422, 'That picture isn’t a JPEG, PNG or WebP image');
        }
        $raw = base64_decode($m[2], true);
        if ($raw === false || strlen($raw) < 32 || strlen($raw) > 60000) {
            throw new HttpError(422, 'That picture is too big — pick another');
        }
        $magic = ['jpeg' => "\xFF\xD8\xFF", 'png' => "\x89PNG\r\n\x1A\n", 'webp' => 'RIFF'];
        if (strncmp($raw, $magic[$m[1]], strlen($magic[$m[1]])) !== 0 || ($m[1] === 'webp' && substr($raw, 8, 4) !== 'WEBP')) {
            throw new HttpError(422, 'That picture isn’t a valid image');
        }
        if (function_exists('getimagesizefromstring')) {
            $size = @getimagesizefromstring($raw);
            if (!$size || $size[0] > 512 || $size[1] > 512) {
                throw new HttpError(422, 'That picture isn’t a valid image');
            }
        }
        return 'data:image/' . $m[1] . ';base64,' . base64_encode($raw);
    }

    private function body(int $max = 65536): array
    {
        $raw = file_get_contents('php://input') ?: '';
        if (strlen($raw) > $max) {
            throw new HttpError(413, 'Request too large');
        }
        $data = json_decode($raw, true);
        return is_array($data) ? $data : [];
    }

    private function entityId(mixed $v): string
    {
        if (!is_string($v) || !preg_match('/^[A-Za-z0-9_-]{1,80}$/', $v)) {
            throw new HttpError(422, 'Invalid id');
        }
        return $v;
    }

    private function pushEndpoint(mixed $v): string
    {
        if (!is_string($v) || strlen($v) > 1000 || !preg_match('#^https://[A-Za-z0-9.\-]+(:\d+)?/\S*$#', $v)) {
            throw new HttpError(422, 'Bad push endpoint');
        }
        return $v;
    }

    private function device(mixed $v): string
    {
        if (!is_string($v) || !preg_match('/^[A-Za-z0-9_-]{8,64}$/', $v)) {
            throw new HttpError(422, 'Bad device id');
        }
        return $v;
    }

    private function origin(): string
    {
        $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
        $host = (string) ($_SERVER['HTTP_HOST'] ?? 'localhost');
        if (!preg_match('/^[A-Za-z0-9.\-:\[\]]+$/', $host)) {
            $host = 'localhost';
        }
        return ($https ? 'https' : 'http') . '://' . $host . $this->base . '/';
    }

    private function area(mixed $v): string
    {
        if (!is_string($v) || !in_array($v, UserData::AREAS, true)) {
            throw new HttpError(422, 'Invalid park');
        }
        return $v;
    }

    private function text(mixed $v, int $max, bool $required): string
    {
        $s = trim(is_scalar($v) ? (string) $v : '');
        if ($required && $s === '') {
            throw new HttpError(422, 'Missing name');
        }
        return function_exists('mb_substr') ? mb_substr($s, 0, $max) : substr($s, 0, $max);
    }

    // ------------------------------------------------------------ output

    private function json(int $status, array $data): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    }

    private function page(): void
    {
        $public = dirname(__DIR__) . '/public';
        $v = static fn (string $f): string => (string) (@filemtime("$public/$f") ?: '1');
        $e = static fn (string $s): string => htmlspecialchars($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');

        $base = $e($this->base . '/');
        $name = $e((string) $this->config['app_name']);
        $css = 'assets/app.css?v=' . $v('assets/app.css');
        $js = 'assets/app.js?v=' . $v('assets/app.js');
        $mapJs = 'assets/map.js?v=' . $v('assets/map.js');
        $themeJs = 'assets/theme.js?v=' . $v('assets/theme.js');
        $qrJs = 'assets/qr.js?v=' . $v('assets/qr.js');

        header('Content-Type: text/html; charset=utf-8');
        header('Cache-Control: no-cache');
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: strict-origin-when-cross-origin'); // tile servers ask for a Referer
        header('Permissions-Policy: geolocation=(self), camera=(self)');
        $tileHost = parse_url((string) $this->config['map_tiles'], PHP_URL_HOST);
        $tileSrc = is_string($tileHost) && preg_match('/^[a-z0-9.-]+$/i', $tileHost)
            ? ' https://' . (preg_match('/^[a-c]\./', $tileHost) ? '*.' . substr($tileHost, 2) : $tileHost) : '';
        header("Content-Security-Policy: default-src 'self'; img-src 'self' data:{$tileSrc}; style-src 'self'; script-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'self'; frame-ancestors 'none'");

        echo <<<HTML
        <!doctype html>
        <html lang="en">
        <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
        <meta name="theme-color" content="#16163a">
        <meta name="apple-mobile-web-app-capable" content="yes">
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
        <base href="{$base}">
        <title>{$name}</title>
        <link rel="manifest" href="manifest.webmanifest">
        <link rel="icon" href="assets/icon.svg" type="image/svg+xml">
        <link rel="icon" href="assets/icon-192.png" type="image/png" sizes="192x192">
        <link rel="apple-touch-icon" href="assets/icon-180.png">
        <meta name="mobile-web-app-capable" content="yes">
        <link rel="stylesheet" href="{$css}">
        <script src="{$themeJs}"></script>
        <script src="{$mapJs}" defer></script>
        <script src="{$qrJs}" defer></script>
        <script src="{$js}" defer></script>
        </head>
        <body>
        <header class="top">
          <div class="top-row">
            <h1 class="brand"><span class="pulse" aria-hidden="true"></span>{$name}</h1>
            <span class="status" id="status" aria-live="polite"></span>
            <button type="button" class="search-btn" id="whatNowBtn" aria-label="What now? Best things to do right now">🎯</button>
            <button type="button" class="search-btn" id="guideBtn" aria-label="Guide: hotels, dining, park info, transport">📖</button>
            <button type="button" class="search-btn" id="searchBtn" aria-label="Search" aria-controls="searchBar" hidden>🔍</button>
            <button type="button" class="user-pill" id="userPill" hidden></button>
          </div>
          <div class="seg" id="parkSeg" role="tablist" aria-label="Park"></div>
          <div class="hours" id="hours"></div>
          <div class="searchbar" id="searchBar" role="search" hidden>
            <input type="search" id="searchInput" enterkeyhint="search" autocomplete="off" spellcheck="false">
            <button type="button" id="searchClose" aria-label="Close search">✕</button>
          </div>
        </header>
        <main id="view" tabindex="-1"><p class="empty">Loading…</p></main>
        <div class="dock">
          <div class="toolbar" id="toolbar" hidden></div>
          <nav class="tabs" id="tabs" aria-label="Sections">
            <button type="button" data-tab="now"><span class="ti" aria-hidden="true">⏱</span>Waits</button>
            <button type="button" data-tab="shows"><span class="ti" aria-hidden="true">✨</span>Shows</button>
            <button type="button" data-tab="food"><span class="ti" aria-hidden="true">🍴</span>Eat &amp; shop</button>
            <button type="button" data-tab="map"><span class="ti" aria-hidden="true">🗺</span>Map</button>
            <button type="button" data-tab="trip"><span class="ti" aria-hidden="true">🗓</span>Trip</button>
            <button type="button" data-tab="mine"><span class="ti" aria-hidden="true">★</span>Mine</button>
          </nav>
        </div>
        <dialog id="sheet" class="sheet"></dialog>
        <div class="toast" id="toast" role="status" hidden></div>
        <noscript><p class="empty">Park Pulse needs JavaScript.</p></noscript>
        </body>
        </html>
        HTML;
    }
}
