<?php

declare(strict_types=1);

namespace ParkPulse;

/**
 * Turns the upstream APIs into what the app shows: resolved parks, merged live
 * data (ThemeParks.wiki first, Queue-Times as fallback), hours and the trip plan.
 */
final class ParkService
{
    public const KEYS = ['dlp', 'studios'];
    private const TYPES = ['ATTRACTION', 'SHOW', 'RESTAURANT'];

    private ?array $resolved = null;
    private \DateTimeZone $tz;

    public function __construct(
        private ThemeParks $tp,
        private QueueTimes $qt,
        private \PDO $db,
        private array $config,
    ) {
        $this->tz = new \DateTimeZone($config['timezone']);
    }

    // ------------------------------------------------------------------ parks

    /**
     * Find Disneyland Paris and its two parks in /destinations. Nothing is hard-coded:
     * Walt Disney Studios Park is now "Disney Adventure World", so both names match.
     */
    public function parks(): array
    {
        if ($this->resolved !== null) {
            return $this->resolved;
        }

        $env = $this->tp->destinations();
        $dest = null;
        foreach ($env['data']['destinations'] ?? [] as $d) {
            $slug = strtolower((string) ($d['slug'] ?? ''));
            if ($slug === 'dlp' || str_contains(Text::norm((string) ($d['name'] ?? '')), 'disneyland paris')) {
                $dest = $d;
                break;
            }
        }
        if ($dest === null) {
            throw new UpstreamException('Disneyland Paris was not found in ThemeParks.wiki /destinations');
        }

        $parks = [];
        foreach ($dest['parks'] ?? [] as $p) {
            $key = self::classify((string) ($p['name'] ?? ''));
            if ($key !== null && !isset($parks[$key])) {
                $parks[$key] = [
                    'key'   => $key,
                    'id'    => (string) $p['id'],
                    'name'  => (string) $p['name'],
                    'short' => $key === 'dlp' ? 'Disneyland' : self::studiosShort((string) $p['name']),
                ];
            }
        }
        $ordered = [];
        foreach (self::KEYS as $k) {
            if (isset($parks[$k])) {
                $ordered[$k] = $parks[$k];
            }
        }
        if (!$ordered) {
            throw new UpstreamException('No Disneyland Paris parks found in /destinations');
        }

        return $this->resolved = [
            'destinationId'   => (string) $dest['id'],
            'destinationName' => (string) $dest['name'],
            'parks'           => $ordered,
        ];
    }

    public function park(string $key): array
    {
        $park = $this->parks()['parks'][$key] ?? null;
        if ($park === null) {
            throw new HttpError(404, 'Unknown park');
        }
        return $park;
    }

    /**
     * True from an hour before the park's first opening (incl. Extra Magic Hours) to an
     * hour after closing today. Unknown hours count as open, so nothing is ever missed.
     */
    public function inOperatingWindow(string $key): bool
    {
        $today = $this->today();
        $segments = $this->hoursFor($this->park($key)['id'], [$today])[$today] ?? [];
        $opens = [];
        $closes = [];
        foreach ($segments as $s) {
            if (!empty($s['open']) && !empty($s['close'])) {
                $opens[] = strtotime((string) $s['open']);
                $closes[] = strtotime((string) $s['close']);
            }
        }
        if (!$opens) {
            return true;
        }
        $now = time();
        return $now >= min($opens) - 3600 && $now <= max($closes) + 3600;
    }

    /** Unix time the cron collector last finished, or null if it never ran. */
    public function cronLast(): ?int
    {
        $v = $this->db->query("SELECT value FROM meta WHERE key = 'collector:last'")->fetchColumn();
        return $v ? (int) $v : null;
    }

    /** Resort coordinates for the weather, taken from the Disneyland Park entity. */
    public function location(): array
    {
        try {
            $destId = $this->parks()['destinationId'];
            foreach ($this->tp->children($destId)['data']['children'] ?? [] as $c) {
                if (($c['entityType'] ?? '') === 'PARK' && isset($c['location']['latitude'], $c['location']['longitude'])) {
                    return ['lat' => (float) $c['location']['latitude'], 'lng' => (float) $c['location']['longitude']];
                }
            }
        } catch (\Throwable) {
        }
        return ['lat' => 48.8702, 'lng' => 2.7799]; // Disneyland Park, if the API can't say
    }

    private static function classify(string $name): ?string
    {
        $n = Text::norm($name);
        if (str_contains($n, 'disneyland park')) {
            return 'dlp';
        }
        if (str_contains($n, 'studios') || str_contains($n, 'adventure world')) {
            return 'studios';
        }
        return null;
    }

    private static function studiosShort(string $name): string
    {
        return str_contains(Text::norm($name), 'adventure world') ? 'Adventure World' : 'Studios';
    }

    // ------------------------------------------------------------------- live

    public function live(string $key): array
    {
        $park = $this->park($key);
        $errors = [];
        $sources = [];

        $tpEnv = null;
        try {
            $tpEnv = $this->tp->live($park['id']);
            if ($tpEnv['error']) {
                $errors[] = 'ThemeParks.wiki: ' . $tpEnv['error'];
            }
        } catch (\Throwable $e) {
            $errors[] = 'ThemeParks.wiki: ' . $e->getMessage();
        }

        /** @var array<string, array> $items */
        $items = [];
        if ($tpEnv !== null) {
            $sources[] = 'themeparks';
            foreach ($tpEnv['data']['liveData'] ?? [] as $e) {
                $row = $this->rowFromThemeParks($e);
                if ($row !== null) {
                    $items[$row['id']] = $row;
                }
            }
        }

        // /children (cached daily) adds map locations, restaurants that /live omits
        // (usually closed today) and — if /live is down — the full entity list, so IDs
        // stay stable for favourites/history while Queue-Times fills in the waits.
        try {
            foreach ($this->tp->children($park['id'])['data']['children'] ?? [] as $e) {
                $id = (string) ($e['id'] ?? '');
                $type = $e['entityType'] ?? '';
                if (!in_array($type, self::TYPES, true) || $id === '') {
                    continue;
                }
                if (!isset($items[$id]) && ($tpEnv === null || $type === 'RESTAURANT')) {
                    $items[$id] = $this->blankRow($id, (string) $e['name'], $type);
                }
                if (isset($items[$id], $e['location']['latitude'], $e['location']['longitude'])) {
                    $items[$id]['location'] = [
                        'lat' => (float) $e['location']['latitude'],
                        'lng' => (float) $e['location']['longitude'],
                    ];
                }
            }
        } catch (\Throwable $e) {
            if ($tpEnv === null) {
                $errors[] = 'ThemeParks.wiki children: ' . $e->getMessage();
            }
        }

        $waits = 0;
        foreach ($items as $row) {
            if ($row['type'] === 'ATTRACTION' && $row['wait'] !== null) {
                $waits++;
            }
        }
        $needFallback = $tpEnv === null || $tpEnv['stale'] || $waits === 0;

        $qtId = null;
        try {
            $qtId = $this->queueTimesParkId($key);
        } catch (\Throwable $e) {
            $errors[] = 'Queue-Times: ' . $e->getMessage();
        }

        $qtFetchedAt = null;
        if ($qtId !== null) {
            if ($needFallback) {
                try {
                    $qtEnv = $this->qt->queueTimes($qtId);
                    $filled = $this->mergeQueueTimes($items, $this->qt->rides($qtEnv['data']), $tpEnv === null);
                    if ($filled > 0) {
                        $sources[] = 'queue-times';
                        $qtFetchedAt = $qtEnv['fetchedAt'];
                    }
                } catch (\Throwable $e) {
                    $errors[] = 'Queue-Times: ' . $e->getMessage();
                }
            }
            try {
                $this->applyLands($items, $this->qt->lands($qtId));
            } catch (\Throwable) {
                // Land labels are cosmetic; ignore.
            }
        }
        $this->landsByProximity($items);

        $fetchedAt = $tpEnv['fetchedAt'] ?? $qtFetchedAt ?? time();
        if ($qtFetchedAt !== null && $tpEnv !== null && $tpEnv['stale']) {
            $fetchedAt = max($fetchedAt, $qtFetchedAt);
        }

        $fresh = time() - $fetchedAt <= 180;
        if ($fresh) {
            $this->trackStatus($key, $items);
        }
        $this->recordSnapshot($key, $items, $fetchedAt);
        $this->decorate($key, $items);
        $this->decorateDowntime($key, $items);

        $today = $this->today();

        return [
            'park'  => $this->publicPark($park),
            'date'  => $today,
            'hours' => $this->hoursFor($park['id'], [$today])[$today] ?? [],
            'crowd' => $this->crowd($key, $items),
            'items' => array_values($items),
            'meta'  => [
                'fetchedAt' => $fetchedAt,
                'cronLast'  => $this->cronLast(),
                'stale'     => ($tpEnv['stale'] ?? true) && $qtFetchedAt === null,
                'sources'   => $sources,
                'errors'    => $errors,
            ],
        ];
    }

    private function rowFromThemeParks(array $e): ?array
    {
        $type = $e['entityType'] ?? '';
        if (!in_array($type, self::TYPES, true)) {
            return null;
        }
        $row = $this->blankRow((string) $e['id'], (string) $e['name'], $type);
        $row['status'] = (string) ($e['status'] ?? 'UNKNOWN');
        $row['lastUpdated'] = $e['lastUpdated'] ?? null;
        $row['source'] = 'themeparks';

        $queue = $e['queue'] ?? [];
        if (isset($queue['STANDBY']['waitTime']) && is_numeric($queue['STANDBY']['waitTime'])) {
            $row['wait'] = (int) $queue['STANDBY']['waitTime'];
        }
        if (isset($queue['SINGLE_RIDER']['waitTime']) && is_numeric($queue['SINGLE_RIDER']['waitTime'])) {
            $row['singleRider'] = (int) $queue['SINGLE_RIDER']['waitTime'];
        }
        if (isset($queue['PAID_RETURN_TIME'])) {
            $p = $queue['PAID_RETURN_TIME'];
            $row['paid'] = [
                'price'       => $p['price']['formatted'] ?? null,
                'amount'      => isset($p['price']['amount']) && is_numeric($p['price']['amount']) ? ((int) $p['price']['amount']) / 100 : null,
                'currency'    => $p['price']['currency'] ?? null,
                'state'       => $p['state'] ?? null,
                'returnStart' => $p['returnStart'] ?? null,
                'returnEnd'   => $p['returnEnd'] ?? null,
            ];
        }
        foreach ($e['showtimes'] ?? [] as $st) {
            if (!empty($st['startTime'])) {
                $row['showtimes'][] = ['start' => $st['startTime'], 'end' => $st['endTime'] ?? null];
            }
        }
        foreach ($e['operatingHours'] ?? [] as $oh) {
            if (!empty($oh['startTime'])) {
                $row['hours'][] = [
                    'type'  => (string) ($oh['type'] ?? 'OPERATING'),
                    'start' => $oh['startTime'],
                    'end'   => $oh['endTime'] ?? null,
                ];
            }
        }
        return $row;
    }

    /**
     * Queue-Times only knows lands for rides. Give restaurants (and anything else
     * without one) the land of the nearest ride within ~200 m.
     *
     * @param array<string, array> $items
     */
    private function landsByProximity(array &$items): void
    {
        $anchors = [];
        foreach ($items as $row) {
            if ($row['land'] !== null && $row['location'] !== null) {
                $anchors[] = [$row['location']['lat'], $row['location']['lng'], $row['land']];
            }
        }
        if (!$anchors) {
            return;
        }
        $mPerDegLat = 111_320.0;
        foreach ($items as &$row) {
            if ($row['land'] !== null || $row['location'] === null) {
                continue;
            }
            $mPerDegLng = $mPerDegLat * cos(deg2rad($row['location']['lat']));
            $best = null;
            $bestD = 200.0;
            foreach ($anchors as [$lat, $lng, $land]) {
                $d = hypot(($lat - $row['location']['lat']) * $mPerDegLat, ($lng - $row['location']['lng']) * $mPerDegLng);
                if ($d < $bestD) {
                    $bestD = $d;
                    $best = $land;
                }
            }
            $row['land'] = $best;
        }
        unset($row);
    }

    private function blankRow(string $id, string $name, string $type): array
    {
        $display = Text::displayName($name);
        return [
            'id'          => $id,
            'name'        => $display,
            'type'        => $type,
            'reserved'    => $type === 'SHOW' && str_starts_with(Text::norm($display), 'reserved viewing area'),
            'status'      => 'UNKNOWN',
            'wait'        => null,
            'singleRider' => null,
            'paid'        => null,
            'showtimes'   => [],
            'hours'       => [],
            'location'    => null,
            'land'        => null,
            'source'      => null,
            'lastUpdated' => null,
        ];
    }

    /**
     * Fill missing waits from Queue-Times. When $authoritative (ThemeParks.wiki had
     * nothing) the open/closed state comes from Queue-Times as well.
     *
     * @param array<string, array> $items
     * @return int number of rows that took Queue-Times data
     */
    private function mergeQueueTimes(array &$items, array $qtRides, bool $authoritative): int
    {
        $standby = [];
        $single = [];
        foreach ($qtRides as $r) {
            if ($r['singleRider']) {
                $single[$r['norm']] = $r;
            } else {
                $standby[$r['norm']] = $r;
            }
        }

        $filled = 0;
        foreach ($items as &$row) {
            if ($row['type'] !== 'ATTRACTION') {
                continue;
            }
            $norm = Text::norm($row['name']);
            $q = self::match($norm, $standby);
            if ($q !== null) {
                $took = false;
                if ($authoritative || $row['status'] === 'UNKNOWN') {
                    $row['status'] = $q['open'] ? 'OPERATING' : 'CLOSED';
                    $took = true;
                }
                if ($row['wait'] === null && $q['open'] && $q['wait'] !== null) {
                    $row['wait'] = $q['wait'];
                    $took = true;
                }
                if ($took) {
                    $row['source'] = 'queue-times';
                    $row['lastUpdated'] = $q['updated'];
                    $filled++;
                }
            }
            $s = self::match($norm, $single);
            if ($s !== null && $row['singleRider'] === null && $s['open'] && $s['wait'] !== null) {
                $row['singleRider'] = $s['wait'];
            }
        }
        unset($row);
        return $filled;
    }

    /** @param array<string, mixed> $byNorm */
    private static function match(string $norm, array $byNorm): mixed
    {
        if ($norm === '') {
            return null;
        }
        if (isset($byNorm[$norm])) {
            return $byNorm[$norm];
        }
        // Loose match for names where one side carries extra words
        // (e.g. "Ratatouille L'Aventure Totalement Toquée de Rémy" vs "Ratatouille").
        foreach ($byNorm as $k => $v) {
            $k = (string) $k;
            if (strlen($k) >= 6 && strlen($norm) >= 6 && (str_starts_with($norm, $k . ' ') || str_starts_with($k, $norm . ' '))) {
                return $v;
            }
        }
        return null;
    }

    /** @param array<string, array> $items */
    private function applyLands(array &$items, array $lands): void
    {
        foreach ($items as &$row) {
            $land = self::match(Text::norm($row['name']), $lands);
            if (is_string($land)) {
                $row['land'] = $land;
            }
        }
        unset($row);
    }

    private function queueTimesParkId(string $key): ?int
    {
        $override = $this->config['queuetimes_park_ids'][$key] ?? null;
        if ($override) {
            return (int) $override;
        }
        foreach ($this->qt->parks()['data'] as $group) {
            foreach ($group['parks'] ?? [] as $p) {
                if (($p['country'] ?? '') === 'France' && self::classify((string) ($p['name'] ?? '')) === $key) {
                    return (int) $p['id'];
                }
            }
        }
        return null;
    }

    // ---------------------------------------------------------------- history

    /** @param array<string, array> $items */
    private function recordSnapshot(string $key, array $items, int $fetchedAt): void
    {
        // Only record genuinely fresh data, at most once per interval per park.
        if (time() - $fetchedAt > 180) {
            return;
        }
        $metaKey = "snapshot:$key";
        $stmt = $this->db->prepare('SELECT value FROM meta WHERE key = ?');
        $stmt->execute([$metaKey]);
        $last = (int) ($stmt->fetchColumn() ?: 0);
        // 30 s of slack so a cron job running exactly every 5 min never skips a beat.
        if (time() - $last < (int) $this->config['snapshot_every'] - 30) {
            return;
        }

        $active = false;
        foreach ($items as $row) {
            if ($row['type'] === 'ATTRACTION' && ($row['status'] === 'OPERATING' || $row['status'] === 'DOWN')) {
                $active = true;
                break;
            }
        }
        if (!$active) {
            return; // park closed: rows of "CLOSED" would only bloat the history
        }

        $now = new \DateTimeImmutable('now', $this->tz);
        $day = $now->format('Y-m-d');
        $hour = (int) $now->format('G');
        $ts = $now->getTimestamp();

        $this->db->beginTransaction();
        try {
            $ins = $this->db->prepare(
                'INSERT INTO wait_history (park_key, entity_id, ts, day, hour, status, wait) VALUES (?, ?, ?, ?, ?, ?, ?)'
            );
            $pa = $this->db->prepare(
                'INSERT INTO pa_history (entity_id, ts, day, state, return_start) VALUES (?, ?, ?, ?, ?)'
            );
            foreach ($items as $row) {
                if ($row['type'] === 'ATTRACTION' && $row['status'] !== 'UNKNOWN') {
                    $ins->execute([$key, $row['id'], $ts, $day, $hour, $row['status'], $row['wait']]);
                }
                if ($row['type'] === 'ATTRACTION' && !empty($row['paid']['state'])) {
                    $rs = !empty($row['paid']['returnStart']) ? strtotime((string) $row['paid']['returnStart']) : null;
                    $pa->execute([$row['id'], $ts, $day, (string) $row['paid']['state'], $rs ?: null]);
                }
            }
            $this->db->prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')->execute([$metaKey, (string) $ts]);
            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }
    }

    /**
     * Add trend (vs ~30-60 min ago), "usually" (same hour on other days),
     * favourite flag and ride count to each row.
     *
     * @param array<string, array> $items
     */
    private function decorate(string $key, array &$items): void
    {
        $now = time();
        $earlier = [];
        $stmt = $this->db->prepare(
            'SELECT entity_id, wait FROM wait_history
             WHERE park_key = ? AND ts BETWEEN ? AND ? AND wait IS NOT NULL ORDER BY ts'
        );
        $stmt->execute([$key, $now - 3600, $now - 1500]);
        foreach ($stmt as $r) {
            $earlier[$r['entity_id']] = (int) $r['wait']; // latest in window wins
        }

        $nowLocal = new \DateTimeImmutable('now', $this->tz);
        $usual = [];
        $stmt = $this->db->prepare(
            "SELECT entity_id, AVG(wait) AS avg_wait, COUNT(DISTINCT day) AS days FROM wait_history
             WHERE park_key = ? AND hour = ? AND day <> ? AND status = 'OPERATING' AND wait IS NOT NULL
             GROUP BY entity_id"
        );
        $stmt->execute([$key, (int) $nowLocal->format('G'), $nowLocal->format('Y-m-d')]);
        foreach ($stmt as $r) {
            if ((int) $r['days'] >= 1) {
                $usual[$r['entity_id']] = (int) round((float) $r['avg_wait'] / 5) * 5;
            }
        }

        $favs = array_flip($this->db->query('SELECT entity_id FROM favourites')->fetchAll(\PDO::FETCH_COLUMN));
        $rides = [];
        foreach ($this->db->query('SELECT entity_id, COUNT(*) AS n FROM ride_log GROUP BY entity_id') as $r) {
            $rides[$r['entity_id']] = (int) $r['n'];
        }

        $paTrend = $this->premierAccessTrends($key);

        foreach ($items as $id => &$row) {
            $row['trend'] = ($row['wait'] !== null && isset($earlier[$id])) ? $row['wait'] - $earlier[$id] : null;
            $row['usually'] = $usual[$id] ?? null;
            $row['fav'] = isset($favs[$id]);
            $row['rides'] = $rides[$id] ?? 0;
            $row['info'] = $row['type'] === 'ATTRACTION' ? $this->rideInfo($row['name']) : null;
            $row['paTrend'] = $paTrend[$id] ?? null;
        }
        unset($row);
    }

    private ?array $rideInfo = null;

    /** Static facts from ride-info.php (indoor/outdoor, min height, thrill, duration). */
    public function rideInfo(string $name): ?array
    {
        if ($this->rideInfo === null) {
            $file = dirname(__DIR__) . '/ride-info.php';
            $list = is_file($file) ? require $file : [];
            $this->rideInfo = is_array($list) ? $list : [];
        }
        foreach ($this->rideInfo as $r) {
            if (isset($r['match']) && self::namesMatch($name, (string) $r['match'])) {
                return [
                    'where'  => (string) ($r['where'] ?? 'outdoor'),
                    'height' => isset($r['height']) ? (int) $r['height'] : null,
                    'thrill' => (int) ($r['thrill'] ?? 1),
                    'mins'   => (int) ($r['mins'] ?? 5),
                    'drop'   => (int) ($r['drop'] ?? 0),
                    'speed'  => (int) ($r['speed'] ?? 0),
                    'inversions' => (int) ($r['inversions'] ?? 0),
                    'wet'    => (bool) ($r['wet'] ?? false),
                    'dark'   => (bool) ($r['dark'] ?? false),
                ];
            }
        }
        return null;
    }

    /**
     * How fast Premier Access return times are moving today, and roughly when each
     * ride's PA will sell out (when the return time reaches an hour before closing).
     *
     * @return array<string, array{perHour:int, sellsOutAt:?string, since:int}>
     */
    private function premierAccessTrends(string $key): array
    {
        $today = $this->today();
        $close = null;
        foreach ($this->hoursFor($this->park($key)['id'], [$today])[$today] ?? [] as $s) {
            if ($s['type'] === 'OPERATING' && !empty($s['close'])) {
                $close = strtotime((string) $s['close']);
            }
        }
        $stmt = $this->db->prepare(
            "SELECT entity_id, ts, return_start FROM pa_history
             WHERE day = ? AND ts >= ? AND state = 'AVAILABLE' AND return_start IS NOT NULL ORDER BY ts"
        );
        $stmt->execute([$today, time() - 3 * 3600]);
        $pts = [];
        foreach ($stmt as $r) {
            $pts[$r['entity_id']][] = [(int) $r['ts'], (int) $r['return_start']];
        }
        $out = [];
        foreach ($pts as $id => $list) {
            [$t0, $r0] = $list[0];
            [$t1, $r1] = $list[count($list) - 1];
            if ($t1 - $t0 < 1800) {
                continue; // need at least 30 min of observations
            }
            $slope = ($r1 - $r0) / ($t1 - $t0); // seconds of return time per second
            $eta = null;
            if ($close !== null && $slope > 0.05) {
                $target = $close - 3600;
                $eta = $r1 >= $target ? time() : (int) ($t1 + ($target - $r1) / $slope);
            }
            $out[$id] = [
                'perHour'    => (int) round($slope * 60),
                'sellsOutAt' => $eta ? (new \DateTimeImmutable('@' . $eta))->setTimezone($this->tz)->format(DATE_ATOM) : null,
                'since'      => $t0,
            ];
        }
        return $out;
    }

    /** Official menu PDF per park restaurant (entity id => url|null), via MenuFinder. */
    public function menus(MenuFinder $finder): array
    {
        $list = [];
        foreach ($this->parks()['parks'] as $park) {
            try {
                foreach ($this->tp->children($park['id'])['data']['children'] ?? [] as $c) {
                    if (($c['entityType'] ?? '') === 'RESTAURANT' && !empty($c['externalId'])) {
                        $list[] = ['id' => (string) $c['id'], 'ext' => (string) $c['externalId'], 'name' => (string) $c['name']];
                    }
                }
            } catch (\Throwable) {
            }
        }
        return $finder->find($list);
    }

    /** Opening-hours segments for one park across many dates. */
    public function hoursRange(string $key, array $dates): array
    {
        return $this->hoursFor($this->park($key)['id'], $dates);
    }

    /**
     * Touring-plan templates and rope-drop strategies (touring-plans.php) with names
     * resolved to live entity ids, plus "queues that build fastest after opening"
     * measured from wait history.
     */
    public function touringPlans(): array
    {
        $file = dirname(__DIR__) . '/touring-plans.php';
        $cfg = is_file($file) ? require $file : [];

        $entities = []; // park => list of [id, name, type]
        foreach ($this->parks()['parks'] as $key => $park) {
            try {
                foreach ($this->tp->children($park['id'])['data']['children'] ?? [] as $c) {
                    $type = $c['entityType'] ?? '';
                    if ($type === 'ATTRACTION' || $type === 'SHOW') {
                        $entities[$key][] = [(string) $c['id'], Text::displayName((string) $c['name']), $type];
                    }
                }
            } catch (\Throwable) {
            }
        }
        $resolve = function (string $park, array $names, string $type) use ($entities): array {
            $out = [];
            foreach ($names as $n) {
                foreach ($entities[$park] ?? [] as [$id, $name, $t]) {
                    if ($t === $type && !str_starts_with(Text::norm($name), 'reserved viewing area') && self::namesMatch($n, $name)) {
                        $out[] = ['id' => $id, 'name' => $name];
                        break;
                    }
                }
            }
            return $out;
        };

        $plans = [];
        foreach ($cfg['plans'] ?? [] as $park => $groups) {
            if (!isset($entities[$park])) {
                continue;
            }
            foreach ($groups as $group => $p) {
                $plans[$park][$group] = [
                    'rides' => $resolve($park, $p['rides'] ?? [], 'ATTRACTION'),
                    'shows' => $resolve($park, $p['shows'] ?? [], 'SHOW'),
                    'tips'  => $p['tips'] ?? [],
                ];
            }
        }
        $rope = [];
        foreach ($cfg['ropeDrop'] ?? [] as $park => $r) {
            if ($park === 'sources' || !isset($entities[$park])) {
                continue;
            }
            $rope[$park] = [
                'emt'     => $resolve($park, $r['emt'] ?? [], 'ATTRACTION'),
                'first'   => $resolve($park, $r['first'] ?? [], 'ATTRACTION'),
                'tips'    => $r['tips'] ?? [],
                'fastest' => $this->fastestBuilding($park),
            ];
        }

        return [
            'groups'  => $cfg['groups'] ?? [],
            'plans'   => $plans ?: new \stdClass(),
            'ropeDrop' => $rope ?: new \stdClass(),
            'sources' => $cfg['ropeDrop']['sources'] ?? [],
        ];
    }

    /** Rides whose standby grows most in the first ~2 hours after the park's first hour of data each day. */
    private function fastestBuilding(string $key): array
    {
        $stmt = $this->db->prepare(
            "SELECT entity_id, day, hour, AVG(wait) AS a FROM wait_history
             WHERE park_key = ? AND status = 'OPERATING' AND wait IS NOT NULL GROUP BY entity_id, day, hour"
        );
        $stmt->execute([$key]);
        $byDay = [];
        $first = [];
        foreach ($stmt as $r) {
            $byDay[$r['entity_id']][$r['day']][(int) $r['hour']] = (float) $r['a'];
            $first[$r['day']] = min($first[$r['day']] ?? 99, (int) $r['hour']);
        }
        $growth = [];
        foreach ($byDay as $id => $days) {
            $g = [];
            foreach ($days as $day => $hours) {
                $h0 = $first[$day];
                if (isset($hours[$h0], $hours[$h0 + 2])) {
                    $g[] = $hours[$h0 + 2] - $hours[$h0];
                }
            }
            if ($g) {
                $growth[$id] = ['id' => $id, 'growth' => (int) round(array_sum($g) / count($g)), 'days' => count($g)];
            }
        }
        usort($growth, fn ($a, $b) => $b['growth'] <=> $a['growth']);
        return array_values(array_filter(array_slice($growth, 0, 6), fn ($x) => $x['growth'] >= 5));
    }

    /** Opening-hours segments for one park on one date. */
    public function dayHours(string $key, string $date): array
    {
        return $this->hoursFor($this->park($key)['id'], [$date])[$date] ?? [];
    }

    /**
     * Remember each ride's status and log every change (OPERATING → DOWN → OPERATING…).
     * The conditional UPDATE makes concurrent requests record a change only once.
     *
     * @param array<string, array> $items
     */
    private function trackStatus(string $key, array $items): void
    {
        $now = time();
        $known = [];
        $stmt = $this->db->prepare('SELECT entity_id, status FROM entity_state WHERE park_key = ?');
        $stmt->execute([$key]);
        foreach ($stmt as $r) {
            $known[$r['entity_id']] = $r['status'];
        }

        $insertState = $this->db->prepare(
            'INSERT OR IGNORE INTO entity_state (entity_id, park_key, status, since, updated) VALUES (?, ?, ?, NULL, ?)'
        );
        $change = $this->db->prepare(
            'UPDATE entity_state SET status = ?, since = ?, updated = ? WHERE entity_id = ? AND status = ?'
        );
        $touch = $this->db->prepare('UPDATE entity_state SET updated = ? WHERE entity_id = ?');
        $event = $this->db->prepare(
            'INSERT INTO status_events (park_key, entity_id, ts, from_status, to_status) VALUES (?, ?, ?, ?, ?)'
        );

        $this->db->beginTransaction();
        try {
            foreach ($items as $id => $row) {
                if ($row['type'] !== 'ATTRACTION' || $row['status'] === 'UNKNOWN') {
                    continue;
                }
                $old = $known[$id] ?? null;
                if ($old === null) {
                    $insertState->execute([$id, $key, $row['status'], $now]);
                } elseif ($old !== $row['status']) {
                    $change->execute([$row['status'], $now, $now, $id, $old]);
                    if ($change->rowCount() === 1) {
                        $event->execute([$key, $id, $now, $old, $row['status']]);
                    }
                } else {
                    $touch->execute([$now, $id]);
                }
            }
            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }
    }

    /**
     * Add 'since' (when the current status began, if seen), 'prevStatus', and
     * today's breakdown count / minutes to each ride.
     *
     * @param array<string, array> $items
     */
    private function decorateDowntime(string $key, array &$items): void
    {
        $state = [];
        $stmt = $this->db->prepare('SELECT entity_id, status, since FROM entity_state WHERE park_key = ?');
        $stmt->execute([$key]);
        foreach ($stmt as $r) {
            $state[$r['entity_id']] = $r;
        }

        $midnight = (new \DateTimeImmutable('today', $this->tz))->getTimestamp();
        $now = time();
        $events = [];
        $stmt = $this->db->prepare(
            'SELECT entity_id, ts, from_status, to_status FROM status_events WHERE park_key = ? AND ts >= ? ORDER BY ts'
        );
        $stmt->execute([$key, $midnight]);
        foreach ($stmt as $r) {
            $events[$r['entity_id']][] = $r;
        }

        foreach ($items as $id => &$row) {
            $row['since'] = null;
            $row['prevStatus'] = null;
            $row['downToday'] = null;
            if ($row['type'] !== 'ATTRACTION') {
                continue;
            }
            $s = $state[$id] ?? null;
            if ($s !== null && $s['status'] === $row['status'] && $s['since'] !== null) {
                $row['since'] = (int) $s['since'];
            }
            $count = 0;
            $seconds = 0;
            $downAt = null;
            foreach ($events[$id] ?? [] as $ev) {
                if ($ev['to_status'] === 'DOWN') {
                    $count++;
                    $downAt = (int) $ev['ts'];
                } elseif ($ev['from_status'] === 'DOWN') {
                    $seconds += (int) $ev['ts'] - ($downAt ?? $midnight);
                    $downAt = null;
                }
                $row['prevStatus'] = $ev['from_status'];
            }
            if ($downAt !== null && $row['status'] === 'DOWN') {
                $seconds += $now - $downAt;
            }
            if ($count > 0) {
                $row['downToday'] = ['count' => $count, 'minutes' => (int) round($seconds / 60)];
            }
        }
        unset($row);
    }

    /**
     * Park-wide busyness: the mean standby wait of open rides, compared with earlier
     * today and with the same hour on other days.
     *
     * @param array<string, array> $items
     */
    private function crowd(string $key, array $items): ?array
    {
        $waits = [];
        foreach ($items as $row) {
            if ($row['type'] === 'ATTRACTION' && $row['status'] === 'OPERATING' && $row['wait'] !== null) {
                $waits[] = $row['wait'];
            }
        }
        if (count($waits) < 3) {
            return null;
        }
        $avg = (int) round(array_sum($waits) / count($waits));

        $now = new \DateTimeImmutable('now', $this->tz);
        $series = [];
        $stmt = $this->db->prepare(
            "SELECT ts, AVG(wait) AS a, COUNT(*) AS n FROM wait_history
             WHERE park_key = ? AND day = ? AND status = 'OPERATING' AND wait IS NOT NULL
             GROUP BY ts HAVING n >= 3 ORDER BY ts"
        );
        $stmt->execute([$key, $now->format('Y-m-d')]);
        foreach ($stmt as $r) {
            $series[] = ['t' => (int) $r['ts'], 'avg' => (int) round((float) $r['a'])];
        }

        $stmt = $this->db->prepare(
            "SELECT AVG(wait) FROM wait_history
             WHERE park_key = ? AND hour = ? AND day <> ? AND status = 'OPERATING' AND wait IS NOT NULL"
        );
        $stmt->execute([$key, (int) $now->format('G'), $now->format('Y-m-d')]);
        $usual = $stmt->fetchColumn();
        $usual = $usual === null || $usual === false ? null : (int) round((float) $usual);

        $earlier = null;
        foreach ($series as $p) {
            if ($p['t'] <= time() - 1500 && $p['t'] >= time() - 3600) {
                $earlier = $p['avg'];
            }
        }
        $peak = $series ? max(array_column($series, 'avg')) : $avg;

        $levels = [[10, 'Very quiet'], [20, 'Quiet'], [30, 'Moderate'], [45, 'Busy'], [PHP_INT_MAX, 'Very busy']];
        foreach ($levels as $i => [$max, $label]) {
            if ($avg < $max) {
                $level = $i + 1;
                break;
            }
        }

        return [
            'avg'    => $avg,
            'rides'  => count($waits),
            'level'  => $level ?? 5,
            'label'  => $label ?? 'Very busy',
            'usual'  => $usual,
            'trend'  => $earlier === null ? null : $avg - $earlier,
            'peak'   => max($peak, $avg),
            'series' => $series,
        ];
    }

    /**
     * Best times of day per ride, from every wait snapshot collected so far:
     * average standby per hour (operating only), the quietest hours and the hour to
     * avoid, plus each park's quietest hours overall.
     */
    public function bestTimes(): array
    {
        $names = [];
        foreach ($this->parks()['parks'] as $key => $park) {
            try {
                foreach ($this->tp->children($park['id'])['data']['children'] ?? [] as $c) {
                    if (($c['entityType'] ?? '') === 'ATTRACTION') {
                        $names[(string) $c['id']] = Text::displayName((string) $c['name']);
                    }
                }
            } catch (\Throwable) {
            }
        }

        $stmt = $this->db->query(
            "SELECT park_key, entity_id, hour, AVG(wait) AS a, COUNT(*) AS n, COUNT(DISTINCT day) AS d
             FROM wait_history WHERE status = 'OPERATING' AND wait IS NOT NULL
             GROUP BY park_key, entity_id, hour"
        );
        $rides = [];
        $parkHours = []; // park => hour => [sum of ride averages, ride count]
        foreach ($stmt as $r) {
            if ((int) $r['n'] < 3) {
                continue; // a single snapshot or two isn't a pattern
            }
            $id = $r['entity_id'];
            $h = (int) $r['hour'];
            $avg = (float) $r['a'];
            $rides[$id]['park'] = $r['park_key'];
            $rides[$id]['hours'][$h] = ['avg' => (int) round($avg), 'n' => (int) $r['n'], 'days' => (int) $r['d']];
            $parkHours[$r['park_key']][$h][0] = ($parkHours[$r['park_key']][$h][0] ?? 0) + $avg;
            $parkHours[$r['park_key']][$h][1] = ($parkHours[$r['park_key']][$h][1] ?? 0) + 1;
        }

        $out = [];
        foreach ($rides as $id => $r) {
            ksort($r['hours']);
            $avgs = array_map(fn ($x) => $x['avg'], $r['hours']);
            $enough = count($avgs) >= 3;
            $min = min($avgs);
            $max = max($avgs);
            // Best = every hour within a few minutes of the quietest one.
            $slack = max(5, (int) round($min * 0.2));
            $best = array_keys(array_filter($avgs, fn ($a) => $a <= $min + $slack));
            $worst = array_search($max, $avgs, true);
            $out[] = [
                'id'          => $id,
                'name'        => $names[$id] ?? $id,
                'park'        => $r['park'],
                'hours'       => $r['hours'],
                'avg'         => (int) round(array_sum($avgs) / count($avgs)),
                'best'        => $enough ? $best : [],
                'bestAvg'     => $min,
                'worst'       => $enough && $max - $min >= 10 ? $worst : null,
                'worstAvg'    => $max,
                'alwaysShort' => $max <= 10,
                'enough'      => $enough,
                'days'        => max(array_map(fn ($x) => $x['days'], $r['hours'])),
            ];
        }
        usort($out, fn ($a, $b) => $b['avg'] <=> $a['avg']);

        $parks = [];
        foreach ($parkHours as $key => $hours) {
            ksort($hours);
            $avgs = array_map(fn ($x) => (int) round($x[0] / $x[1]), $hours);
            $min = $avgs ? min($avgs) : 0;
            $parks[$key] = [
                'hours' => $avgs,
                'best'  => array_keys(array_filter($avgs, fn ($a) => $a <= $min + max(3, (int) round($min * 0.15)))),
            ];
        }

        $span = $this->db->query(
            "SELECT COUNT(DISTINCT day) AS days, MIN(day) AS first, MAX(day) AS last FROM wait_history WHERE status = 'OPERATING'"
        )->fetch() ?: [];

        return [
            'days'  => (int) ($span['days'] ?? 0),
            'first' => $span['first'] ?? null,
            'last'  => $span['last'] ?? null,
            'rides' => $out,
            'parks' => $parks ?: new \stdClass(),
            'hour'  => (int) (new \DateTimeImmutable('now', $this->tz))->format('G'),
        ];
    }

    /** Today's wait points for one attraction. */
    public function history(string $entityId): array
    {
        $stmt = $this->db->prepare(
            'SELECT ts, wait, status FROM wait_history WHERE entity_id = ? AND day = ? ORDER BY ts'
        );
        $stmt->execute([$entityId, $this->today()]);
        $points = [];
        foreach ($stmt as $r) {
            $points[] = ['t' => (int) $r['ts'], 'w' => $r['wait'] === null ? null : (int) $r['wait'], 's' => $r['status']];
        }
        return ['id' => $entityId, 'date' => $this->today(), 'points' => $points];
    }

    // ------------------------------------------------------------------ shops

    /**
     * [lat, lng, parkKey, name] for every ride and restaurant. Shows are left out on
     * purpose: some are pinned on the entrance plazas, which would pull Disney Village
     * places into the park.
     */
    private function anchors(): array
    {
        $anchors = [];
        foreach ($this->parks()['parks'] as $key => $park) {
            try {
                foreach ($this->tp->children($park['id'])['data']['children'] ?? [] as $c) {
                    if (isset($c['location']['latitude'], $c['location']['longitude'])
                        && in_array($c['entityType'] ?? '', ['ATTRACTION', 'RESTAURANT'], true)) {
                        $anchors[] = [(float) $c['location']['latitude'], (float) $c['location']['longitude'], $key, Text::displayName((string) $c['name'])];
                    }
                }
            } catch (\Throwable) {
            }
        }
        return $anchors;
    }

    /** @return array{0: ?array, 1: float} nearest anchor and its distance in metres */
    private static function nearest(array $loc, array $anchors): array
    {
        $best = null;
        $bestD = PHP_FLOAT_MAX;
        foreach ($anchors as $a) {
            $d = self::metres($loc['lat'], $loc['lng'], $a[0], $a[1]);
            if ($d < $bestD) {
                $bestD = $d;
                $best = $a;
            }
        }
        return [$best, $bestD];
    }

    private function inVillage(array $loc): bool
    {
        [$s, $w, $n, $e] = array_map('floatval', $this->config['village_bbox']);
        return $loc['lat'] >= $s && $loc['lat'] <= $n && $loc['lng'] >= $w && $loc['lng'] <= $e;
    }

    /**
     * OSM shops tagged with their area (dlp / studios / village), the nearest ride or
     * restaurant ("near Phantom Manor"), and today's hours: from OSM when tagged,
     * otherwise the park's opening hours (marked hoursSource = 'park').
     */
    public function shops(OsmShops $osm): array
    {
        $res = $osm->fetch();
        $anchors = $this->anchors();
        $favs = array_flip($this->db->query('SELECT entity_id FROM favourites')->fetchAll(\PDO::FETCH_COLUMN));
        $today = $this->today();

        $parkHours = [];
        foreach ($this->parks()['parks'] as $key => $park) {
            $parkHours[$key] = array_values(array_map(
                fn ($s) => ['type' => 'OPERATING', 'start' => $s['open'], 'end' => $s['close']],
                array_filter($this->hoursFor($park['id'], [$today])[$today] ?? [], fn ($s) => $s['type'] === 'OPERATING'),
            ));
        }

        $out = [];
        foreach ($res['items'] as $shop) {
            [$best, $bestD] = self::nearest($shop['location'], $anchors);
            $inVillage = $this->inVillage($shop['location']);
            if ($best !== null && $bestD <= 150 && !($inVillage && $bestD > 60)) {
                $area = $best[2];
            } elseif ($inVillage) {
                $area = 'village';
            } else {
                continue; // hotels, car parks, outside the resort
            }
            $shop['hoursSource'] = null;
            $this->applyWebHours($shop);
            $oh = OpeningHours::parse($shop['hoursText']);
            if ($oh !== null) {
                $shop['hours'] = $oh->segments($today, $this->tz);
                $shop['hoursSource'] ??= 'osm';
            } elseif ($area !== 'village') {
                $shop['hours'] = $parkHours[$area] ?? [];
                $shop['hoursSource'] = $shop['hours'] ? 'park' : null;
            } else {
                $shop['hours'] = [];
                $shop['hoursSource'] = null;
            }
            $shop['area'] = $area;
            $shop['near'] = ($best !== null && $bestD <= 150 && $area !== 'village') ? $best[3] : null;
            $shop['fav'] = isset($favs[$shop['id']]);
            $out[] = $shop;
        }
        usort($out, fn ($a, $b) => strcmp($a['name'], $b['name']));

        return ['items' => $out, 'fetchedAt' => $res['fetchedAt'], 'stale' => $res['stale'], 'error' => $res['error']];
    }

    public static function metres(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $dLat = ($lat2 - $lat1) * 111_320.0;
        $dLng = ($lng2 - $lng1) * 111_320.0 * cos(deg2rad(($lat1 + $lat2) / 2));
        return hypot($dLat, $dLng);
    }

    // -------------------------------------------------- restaurant schedules

    /**
     * Disney's own per-restaurant schedules (ThemeParks.wiki /schedule) for today and
     * every trip day — fills the gaps when /live has no hours for a restaurant.
     */
    public function restaurantSchedules(string $key): array
    {
        $park = $this->park($key);
        $ids = [];
        foreach ($this->tp->children($park['id'])['data']['children'] ?? [] as $c) {
            if (($c['entityType'] ?? '') === 'RESTAURANT' && !empty($c['id'])) {
                $ids[] = (string) $c['id'];
            }
        }
        $dates = array_values(array_unique(array_merge([$this->today()], $this->tripDates())));
        sort($dates);

        $out = [];
        foreach ($this->months($dates) as [$y, $m]) {
            foreach ($this->tp->scheduleMany($ids, $y, $m) as $id => $env) {
                foreach ($env['data']['schedule'] ?? [] as $s) {
                    $d = $s['date'] ?? '';
                    if (!in_array($d, $dates, true) || empty($s['openingTime'])) {
                        continue;
                    }
                    $out[$id][$d][] = [
                        'type'  => (string) ($s['type'] ?? 'OPERATING'),
                        'start' => $s['openingTime'],
                        'end'   => $s['closingTime'] ?? null,
                    ];
                }
            }
        }
        return ['park' => $key, 'today' => $this->today(), 'dates' => $dates, 'schedules' => $out ?: new \stdClass()];
    }

    // ---------------------------------------------------------- Disney Village

    /**
     * Disney Village + Disney hotel restaurants, bars and the cinema.
     * Sources, merged by name: the hand-maintained disney-village.php (descriptions,
     * booking tips, manual hour overrides) and OpenStreetMap (locations, opening hours,
     * venues the hand list doesn't have). Shops come from shops() instead.
     */
    public function village(?OsmShops $osm = null): array
    {
        $file = dirname(__DIR__) . '/disney-village.php';
        $list = is_file($file) ? require $file : [];
        $favs = array_flip($this->db->query('SELECT entity_id FROM favourites')->fetchAll(\PDO::FETCH_COLUMN));

        /** @var array<string, array> $items */
        $items = [];
        foreach (is_array($list) ? $list : [] as $p) {
            $id = (string) ($p['id'] ?? '');
            if (!preg_match('/^[A-Za-z0-9_-]{1,80}$/', $id) || empty($p['name'])) {
                continue;
            }
            $manual = null;
            if (isset($p['hours']['open'], $p['hours']['close'])) {
                $manual = $p['hours']['open'] . '-' . $p['hours']['close'];
            }
            $items[$id] = [
                'id'          => $id,
                'name'        => (string) $p['name'],
                'type'        => 'VILLAGE',
                'section'     => (string) ($p['section'] ?? 'Disney Village'),
                'kind'        => (string) ($p['kind'] ?? ''),
                'about'       => (string) ($p['about'] ?? ''),
                'book'        => (bool) ($p['book'] ?? false),
                'location'    => null,
                'hoursText'   => $manual,
                'hoursSource' => $manual !== null ? 'manual' : null,
            ];
        }

        $error = null;
        $fetchedAt = null;
        if ($osm !== null) {
            try {
                $res = $osm->fetch();
                $fetchedAt = $res['fetchedAt'];
                $error = $res['error'];
                $anchors = $this->anchors();
                foreach ($res['venues'] as $v) {
                    // Which hotel (if any) is it in? Hotels are big, so allow ~110 m from the pin.
                    $hotel = null;
                    $hotelD = 110.0;
                    foreach ($res['hotels'] as $h) {
                        $d = self::metres($v['location']['lat'], $v['location']['lng'], $h['location']['lat'], $h['location']['lng']);
                        if ($d < $hotelD) {
                            $hotelD = $d;
                            $hotel = $h['name'];
                        }
                    }
                    if ($hotel === null) {
                        [, $parkD] = self::nearest($v['location'], $anchors);
                        if (!$this->inVillage($v['location']) || $parkD <= 60) {
                            continue; // in-park restaurants come from ThemeParks.wiki
                        }
                    }

                    $match = $hotel === null ? self::matchVenue($v['name'], $items) : null;
                    // Already matched (e.g. a second Starbucks)? Then list this one separately.
                    if ($match !== null && $items[$match]['location'] === null) {
                        $items[$match]['location'] = $v['location'];
                        if ($items[$match]['hoursText'] === null && $v['hoursText'] !== null) {
                            $items[$match]['hoursText'] = $v['hoursText'];
                            $items[$match]['hoursSource'] = 'osm';
                        }
                        continue;
                    }
                    $items[$v['id']] = [
                        'id'          => $v['id'],
                        'name'        => $v['name'],
                        'type'        => 'VILLAGE',
                        'section'     => $hotel !== null ? '🏨 ' . $hotel : $v['section'],
                        'kind'        => $v['kind'],
                        'about'       => (string) ($v['about'] ?? ''),
                        'book'        => false,
                        'location'    => $v['location'],
                        'hoursText'   => $v['hoursText'],
                        'hoursSource' => $v['hoursText'] !== null ? 'osm' : null,
                    ];
                }
            } catch (\Throwable $e) {
                $error = $e->getMessage();
            }
        }

        $now = time();
        $today = $this->today();
        $trip = $this->tripDates();
        $out = [];
        foreach ($items as $it) {
            $this->applyWebHours($it);
            $oh = OpeningHours::parse($it['hoursText']);
            $it['hours'] = $oh ? $oh->segments($today, $this->tz) : [];
            $it['tripHours'] = [];
            if ($oh) {
                foreach ($trip as $d) {
                    // Only spans that start on that day (segments() also returns the previous night's tail).
                    $it['tripHours'][$d] = array_values(array_filter(
                        $oh->segments($d, $this->tz),
                        fn ($s) => substr($s['start'], 0, 10) === $d,
                    ));
                }
            } else {
                $it['hoursSource'] = null;
            }
            $open = false;
            foreach ($it['hours'] as $s) {
                if (strtotime($s['start']) <= $now && $now < strtotime($s['end'])) {
                    $open = true;
                }
            }
            $it['status'] = $oh ? ($open ? 'OPERATING' : 'CLOSED') : 'UNKNOWN';
            $it['fav'] = isset($favs[$it['id']]);
            $out[] = $it;
        }

        return ['items' => $out, 'date' => $today, 'fetchedAt' => $fetchedAt, 'error' => $error];
    }

    /** Find the hand-list entry an OSM venue refers to ("Sports Bar" ~ "Sports Bar & Lounge"). */
    private static function matchVenue(string $name, array $items): ?string
    {
        foreach ($items as $id => $it) {
            if ($it['section'] !== 'Shops' && self::namesMatch($name, $it['name'])) {
                return (string) $id;
            }
        }
        return null;
    }

    /** Loose name equality across sources: exact, one extends the other, or same distinctive first word. */
    private static function namesMatch(string $x, string $y): bool
    {
        $a = Text::norm($x);
        $b = Text::norm($y);
        if ($a === '' || $b === '') {
            return false;
        }
        if ($a === $b
            || (strlen($a) >= 5 && str_starts_with($b, $a . ' '))
            || (strlen($b) >= 5 && str_starts_with($a, $b . ' '))) {
            return true;
        }
        $fa = explode(' ', $a)[0];
        $stop = ['disney', 'the', 'restaurant', 'hotel', 'cafe', 'bar', 'le', 'la', 'les', 'captain'];
        return $fa === explode(' ', $b)[0] && strlen($fa) >= 6 && !in_array($fa, $stop, true);
    }

    private ?array $webHours = null;

    /** Researched hours from opening-hours.php, matched by name. */
    private function webHours(string $name): ?array
    {
        if ($this->webHours === null) {
            $file = dirname(__DIR__) . '/opening-hours.php';
            $list = is_file($file) ? require $file : [];
            $this->webHours = is_array($list) ? $list : [];
        }
        foreach ($this->webHours as $o) {
            if (isset($o['match'], $o['hours']) && self::namesMatch($name, (string) $o['match'])) {
                return $o;
            }
        }
        return null;
    }

    /** Copy researched hours onto an item (hoursText/hoursSource + provenance). */
    private function applyWebHours(array &$it): void
    {
        if (($it['hoursSource'] ?? null) === 'manual') {
            return; // your own disney-village.php hours win
        }
        $o = $this->webHours($it['name']);
        if ($o === null) {
            return;
        }
        $it['hoursText'] = (string) $o['hours'];
        $it['hoursSource'] = 'web';
        $it['hoursInfo'] = [
            'source'  => (string) ($o['source'] ?? 'web'),
            'url'     => isset($o['url']) ? (string) $o['url'] : null,
            'checked' => isset($o['checked']) ? (string) $o['checked'] : null,
            'weak'    => (bool) ($o['weak'] ?? false),
        ];
        if (!empty($o['note'])) {
            $it['note'] = (string) $o['note'];
        }
        if (strtolower(trim((string) $o['hours'])) === 'off') {
            $it['closedNote'] = (string) ($o['note'] ?? 'Closed');
        }
    }

    // ------------------------------------------------------------ schedules

    /**
     * Opening-hours segments (OPERATING, EXTRA_HOURS, …) per date.
     *
     * @param string[] $dates Y-m-d
     * @return array<string, list<array>>
     */
    private function hoursFor(string $parkId, array $dates): array
    {
        $out = array_fill_keys($dates, []);
        foreach ($this->months($dates) as [$y, $m]) {
            try {
                $env = $this->tp->schedule($parkId, $y, $m);
            } catch (\Throwable) {
                continue;
            }
            foreach ($env['data']['schedule'] ?? [] as $s) {
                $date = $s['date'] ?? '';
                if (!isset($out[$date])) {
                    continue;
                }
                $out[$date][] = [
                    'type'        => (string) ($s['type'] ?? ''),
                    'open'        => $s['openingTime'] ?? null,
                    'close'       => $s['closingTime'] ?? null,
                    'description' => $s['description'] ?? null,
                ];
            }
        }
        foreach ($out as &$segments) {
            usort($segments, fn ($a, $b) => strcmp((string) $a['open'], (string) $b['open']));
        }
        unset($segments);
        return $out;
    }

    /** Park hours + every show/meet-and-greet time for each day of the trip. */
    public function trip(): array
    {
        $dates = $this->tripDates();
        $days = [];
        foreach ($dates as $d) {
            $days[$d] = ['date' => $d, 'parks' => [], 'shows' => []];
        }
        $errors = [];
        $oldest = time();

        foreach ($this->parks()['parks'] as $key => $park) {
            foreach ($this->hoursFor($park['id'], $dates) as $date => $segments) {
                $days[$date]['parks'][$key] = $segments;
            }

            try {
                $children = $this->tp->children($park['id'])['data']['children'] ?? [];
            } catch (\Throwable $e) {
                $errors[] = $park['name'] . ': ' . $e->getMessage();
                continue;
            }
            $shows = [];
            foreach ($children as $c) {
                if (($c['entityType'] ?? '') === 'SHOW') {
                    $shows[(string) $c['id']] = Text::displayName((string) $c['name']);
                }
            }

            foreach ($this->months($dates) as [$y, $m]) {
                foreach ($this->tp->scheduleMany(array_keys($shows), $y, $m) as $showId => $env) {
                    if ($env === null) {
                        continue;
                    }
                    $oldest = min($oldest, $env['fetchedAt']);
                    foreach ($env['data']['schedule'] ?? [] as $s) {
                        $date = $s['date'] ?? '';
                        if (!isset($days[$date]) || empty($s['openingTime'])) {
                            continue;
                        }
                        $name = $shows[$showId];
                        $days[$date]['shows'][] = [
                            'id'       => $showId,
                            'park'     => $key,
                            'name'     => $name,
                            'reserved' => str_starts_with(Text::norm($name), 'reserved viewing area'),
                            'start'    => $s['openingTime'],
                            'end'      => $s['closingTime'] ?? null,
                        ];
                    }
                }
            }
        }

        foreach ($days as &$day) {
            usort($day['shows'], fn ($a, $b) => strcmp($a['start'], $b['start']));
        }
        unset($day);

        return [
            'start'     => $this->config['trip']['start'],
            'end'       => $this->config['trip']['end'],
            'today'     => $this->today(),
            'parks'     => array_values(array_map([$this, 'publicPark'], $this->parks()['parks'])),
            'days'      => array_values($days),
            'fetchedAt' => $oldest,
            'errors'    => $errors,
        ];
    }

    /** @return string[] */
    private function tripDates(): array
    {
        $start = new \DateTimeImmutable($this->config['trip']['start'], $this->tz);
        $end = new \DateTimeImmutable($this->config['trip']['end'], $this->tz);
        $dates = [];
        for ($d = $start; $d <= $end && count($dates) < 31; $d = $d->modify('+1 day')) {
            $dates[] = $d->format('Y-m-d');
        }
        return $dates;
    }

    /**
     * @param string[] $dates
     * @return list<array{int, int}>
     */
    private function months(array $dates): array
    {
        $months = [];
        foreach ($dates as $d) {
            $months[substr($d, 0, 7)] = [(int) substr($d, 0, 4), (int) substr($d, 5, 2)];
        }
        return array_values($months);
    }

    public function today(): string
    {
        return (new \DateTimeImmutable('now', $this->tz))->format('Y-m-d');
    }

    public function publicPark(array $park): array
    {
        return ['key' => $park['key'], 'name' => $park['name'], 'short' => $park['short']];
    }
}
