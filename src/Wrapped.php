<?php

declare(strict_types=1);

namespace ParkPulse;

/**
 * Everything Trip Wrapped and its badges need beyond the ride log: ride facts, what the
 * sign said when each person joined a queue, stoppages, park hours, the trip's actual
 * weather and the last saved plan. The badge rules themselves live in app.js.
 */
final class Wrapped
{
    private const WEATHER_TTL = 6 * 3600;

    public function __construct(
        private \PDO $db,
        private ParkService $parks,
        private Cache $cache,
        private Http $http,
        private Party $party,
        private Visits $visits,
        private array $config,
    ) {
    }

    /** @param array|null $visit a row from Visits; the current visit if left out */
    public function data(?array $visit = null): array
    {
        $visit ??= $this->config['trip'];
        $tz = new \DateTimeZone($this->config['timezone']);
        $start = (string) $visit['start'];
        $end = (string) $visit['end'];
        $from = (new \DateTimeImmutable($start . ' 00:00:00', $tz))->getTimestamp();
        $to = (new \DateTimeImmutable($end . ' 23:59:59', $tz))->getTimestamp();

        $saved = $this->visits->snapshot((int) ($visit['id'] ?? 0));
        $catalog = $saved['catalog'] ?? $this->catalog($start, $end);

        return [
            'rides'   => $this->rides($from, $to, $catalog) ?: new \stdClass(),
            'catalog' => $catalog,
            'noRoast' => $this->noRoast(),
            'hours'   => ($saved['hours'] ?? $this->hours($start, $end)) ?: new \stdClass(),
            'weather' => $saved['weather'] ?? $this->weather($start, $end),
            'plan'    => array_key_exists('plan', $saved) ? $saved['plan'] : $this->planFor($start, $end),
        ];
    }

    /**
     * Save what can't be rebuilt later: ride facts for rides that close, park hours and the
     * forecast drop off upstream, and the next visit overwrites the plan. Run by the collector;
     * anything missing gets another go for a fortnight after the visit ends.
     */
    public function freezeEnded(): void
    {
        $tz = new \DateTimeZone($this->config['timezone']);
        $today = new \DateTimeImmutable('today', $tz);
        $cutoff = $today->modify('-14 days')->format('Y-m-d');
        foreach ($this->visits->all() as $v) {
            if ($v['end'] >= $today->format('Y-m-d') || $v['end'] < $cutoff) {
                continue;
            }
            $saved = $this->visits->snapshot($v['id']);
            $was = $saved;
            if (!isset($saved['catalog']) && ($c = $this->catalog($v['start'], $v['end']))) {
                $saved['catalog'] = $c;
            }
            if (!isset($saved['hours'])) {
                $h = $this->hours($v['start'], $v['end']);
                if (count($h) === count(ParkService::KEYS)) {
                    $saved['hours'] = $h;
                }
            }
            if (!isset($saved['weather']) && ($w = $this->weather($v['start'], $v['end']))) {
                $saved['weather'] = $w;
            }
            if (!array_key_exists('plan', $saved)) {
                $saved['plan'] = $this->planFor($v['start'], $v['end']);
            }
            if ($saved !== $was) {
                $this->visits->setSnapshot($v['id'], $saved);
            }
        }
    }

    /** The saved plan, if it's for a day of this visit. */
    private function planFor(string $start, string $end): ?array
    {
        $plan = $this->party->getPlan();
        $day = (string) ($plan['date'] ?? '');
        return $day >= $start && $day <= $end ? $plan : null;
    }

    /** Names of people who've opted out of roast badges. */
    public function noRoast(): array
    {
        return $this->db->query("SELECT value FROM meta WHERE key LIKE 'noroast:%'")->fetchAll(\PDO::FETCH_COLUMN);
    }

    /** Turn roast badges on or off for one person. */
    public function setRoasts(string $name, bool $on): array
    {
        $key = 'noroast:' . sha1($name);
        if ($on) {
            $this->db->prepare('DELETE FROM meta WHERE key = ?')->execute([$key]);
        } else {
            $this->db->prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')->execute([$key, $name]);
        }
        return $this->noRoast();
    }

    /** Metres between two catalog rides, or null if either has no position. */
    private static function metres(array $a, array $b): ?float
    {
        if ($a['lat'] === null || $a['lng'] === null || $b['lat'] === null || $b['lng'] === null) {
            return null;
        }
        $dLat = deg2rad((float) $b['lat'] - (float) $a['lat']);
        $dLng = deg2rad((float) $b['lng'] - (float) $a['lng']);
        $h = sin($dLat / 2) ** 2 + cos(deg2rad((float) $a['lat'])) * cos(deg2rad((float) $b['lat'])) * sin($dLng / 2) ** 2;
        return 12742000 * asin(min(1.0, sqrt($h)));
    }

    /**
     * For each logged ride: the posted wait when that person joined the queue, any stoppage
     * while there, how soon a Premier Access return was, and a much shorter queue next door.
     */
    private function rides(int $from, int $to, array $catalog): array
    {
        $byId = [];
        foreach ($catalog as $c) {
            $byId[$c['id']] = $c;
        }
        $log = $this->db->prepare('SELECT id, entity_id, name, ridden_at, wait_minutes, queue_type FROM ride_log WHERE ridden_at BETWEEN ? AND ?');
        $log->execute([$from, $to]);
        $posted = $this->db->prepare(
            'SELECT wait FROM wait_history WHERE entity_id = ? AND ts BETWEEN ? AND ? AND wait IS NOT NULL AND status = \'OPERATING\'
             ORDER BY ABS(ts - ?) LIMIT 1'
        );
        $down = $this->db->prepare(
            'SELECT 1 FROM status_events WHERE entity_id = ? AND ts BETWEEN ? AND ? AND to_status = \'DOWN\' LIMIT 1'
        );

        $pa = $this->db->prepare(
            "SELECT return_start FROM pa_history WHERE entity_id = ? AND ts BETWEEN ? AND ? AND state = 'AVAILABLE' AND return_start IS NOT NULL
             ORDER BY ABS(ts - ?) LIMIT 1"
        );

        $out = [];
        foreach ($log->fetchAll() as $r) {
            $at = (int) $r['ridden_at'];
            $mins = $this->parks->rideInfo((string) $r['name'])['mins'] ?? 5;
            $joined = $at - ((int) ($r['wait_minutes'] ?? 0) + $mins) * 60;

            $posted->execute([$r['entity_id'], $joined - 900, $joined + 900, $joined]);
            $wait = $posted->fetchColumn();
            $posted->closeCursor();

            $down->execute([$r['entity_id'], $joined, $at]);
            $stopped = $down->fetchColumn() !== false;
            $down->closeCursor();

            $row = ['posted' => $wait === false ? null : (int) $wait, 'stopped' => $stopped, 'paIn' => null, 'nearby' => null];

            if ($r['queue_type'] === 'STANDBY') {
                $pa->execute([$r['entity_id'], $joined - 900, $joined + 900, $joined]);
                $return = $pa->fetchColumn();
                $pa->closeCursor();
                if ($return !== false) {
                    $row['paIn'] = (int) round(((int) $return - $joined) / 60);
                }

                $me = $byId[$r['entity_id']] ?? null;
                if ($me !== null && $row['posted'] !== null && $row['posted'] >= 30) {
                    foreach ($catalog as $c) {
                        if ($c['id'] === $me['id'] || $c['park'] !== $me['park']) {
                            continue;
                        }
                        $m = self::metres($me, $c);
                        if ($m === null || $m > 200) {
                            continue;
                        }
                        $posted->execute([$c['id'], $joined - 900, $joined + 900, $joined]);
                        $other = $posted->fetchColumn();
                        $posted->closeCursor();
                        if ($other !== false && (int) $other <= 15 && $row['posted'] - (int) $other >= 30
                            && ($row['nearby'] === null || (int) $other < $row['nearby']['posted'])) {
                            $row['nearby'] = ['name' => $c['name'], 'posted' => (int) $other];
                        }
                    }
                }
            }

            $out[(string) $r['id']] = $row;
        }
        return $out;
    }

    /** Every attraction with its land, position and facts. `ran` = seen operating during the trip. */
    private function catalog(string $start, string $end): array
    {
        $stmt = $this->db->prepare("SELECT DISTINCT entity_id FROM wait_history WHERE day BETWEEN ? AND ? AND status = 'OPERATING'");
        $stmt->execute([$start, $end]);
        $ran = array_flip($stmt->fetchAll(\PDO::FETCH_COLUMN));

        $out = [];
        foreach (ParkService::KEYS as $key) {
            try {
                $items = $this->parks->live($key)['items'] ?? [];
            } catch (\Throwable) {
                continue;
            }
            foreach ($items as $it) {
                if (($it['type'] ?? '') !== 'ATTRACTION') {
                    continue;
                }
                $out[] = [
                    'id'   => $it['id'],
                    'park' => $key,
                    'name' => $it['name'],
                    'land' => $it['land'] ?? null,
                    'lat'  => $it['location']['lat'] ?? null,
                    'lng'  => $it['location']['lng'] ?? null,
                    'info' => $it['info'] ?? null,
                    'ran'  => $ran === [] || isset($ran[$it['id']]),
                ];
            }
        }
        return $out;
    }

    /** Public opening and closing per park and day (Extra Magic Hours left out). */
    private function hours(string $start, string $end): array
    {
        $dates = [];
        $tz = new \DateTimeZone($this->config['timezone']);
        $d = new \DateTimeImmutable($start, $tz);
        $last = new \DateTimeImmutable($end, $tz);
        while ($d <= $last) {
            $dates[] = $d->format('Y-m-d');
            $d = $d->modify('+1 day');
        }

        $out = [];
        foreach (ParkService::KEYS as $key) {
            try {
                $range = $this->parks->hoursRange($key, $dates);
            } catch (\Throwable) {
                continue;
            }
            foreach ($range as $date => $segments) {
                foreach ($segments as $s) {
                    if ($s['type'] === 'OPERATING' && $s['open'] && $s['close']) {
                        $out[$key][$date] = ['open' => $s['open'], 'close' => $s['close']];
                    }
                }
            }
        }
        return $out;
    }

    /** What the weather actually did (Open-Meteo, park-local times), or null if unavailable. */
    private function weather(string $start, string $end): ?array
    {
        $loc = $this->parks->location();
        // The forecast API only reaches back about three months. The archive has the same fields.
        $tz = new \DateTimeZone($this->config['timezone']);
        $old = $start < (new \DateTimeImmutable('-60 days', $tz))->format('Y-m-d');
        $base = $old ? 'https://archive-api.open-meteo.com/v1/archive?' : 'https://api.open-meteo.com/v1/forecast?';
        $url = $base . http_build_query([
            'latitude'   => round($loc['lat'], 4),
            'longitude'  => round($loc['lng'], 4),
            'hourly'     => 'precipitation,temperature_2m',
            'daily'      => 'temperature_2m_max,sunset,uv_index_max',
            'timezone'   => $this->config['timezone'],
            'start_date' => $start,
            'end_date'   => $end,
        ]);
        try {
            $d = $this->cache->remember('wrapped:weather:' . sha1($url), self::WEATHER_TTL, fn () => $this->http->getJson($url))['data'];
        } catch (\Throwable) {
            return null;
        }

        $days = [];
        foreach ($d['daily']['time'] ?? [] as $i => $date) {
            $days[$date] = [
                'max'    => isset($d['daily']['temperature_2m_max'][$i]) ? (float) $d['daily']['temperature_2m_max'][$i] : null,
                'sunset' => $d['daily']['sunset'][$i] ?? null,
                'uv'     => isset($d['daily']['uv_index_max'][$i]) ? (float) $d['daily']['uv_index_max'][$i] : null,
            ];
        }
        $rain = [];
        $temps = [];
        foreach ($d['hourly']['time'] ?? [] as $i => $time) {
            if (isset($d['hourly']['temperature_2m'][$i])) {
                $temps[$time] = (float) $d['hourly']['temperature_2m'][$i];
            }
            if ((float) ($d['hourly']['precipitation'][$i] ?? 0) >= 0.1) {
                $rain[] = $time; // "2026-11-04T13:00"
            }
        }
        return $days ? ['days' => $days, 'rainHours' => $rain, 'temps' => $temps ?: new \stdClass()] : null;
    }
}
