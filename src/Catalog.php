<?php

declare(strict_types=1);

namespace ParkPulse;

/**
 * Once a day: what's new at the parks, and which days each show runs.
 *
 * ThemeParks.wiki drops show dates as soon as they pass and only publishes up to the end
 * of next month, so the dates are kept here. A show is completed when it has run and has
 * no dates left in what's published. Having no dates proves nothing on its own (seasonal
 * shows sit in the feed all year), and a failed fetch never counts. Completed isn't final:
 * new dates bring a show straight back.
 */
final class Catalog
{
    private const CHECK_EVERY = 86400 - 300; // a little under 24 h, so a 5-minute cron doesn't drift later each day
    private const NEW_FOR_DAYS = 14;
    private const TYPES = ['ATTRACTION', 'SHOW', 'RESTAURANT'];

    public function __construct(
        private \PDO $db,
        private ThemeParks $tp,
        private ParkService $parks,
        private \DateTimeZone $tz,
    ) {
    }

    public function due(): bool
    {
        return time() - $this->checkedAt() >= self::CHECK_EVERY;
    }

    public function check(): array
    {
        $today = $this->today();
        $added = [];
        $completed = 0;
        $errors = [];
        $anyOk = false;

        foreach ($this->parks->parks()['parks'] as $key => $park) {
            try {
                $children = $this->tp->children($park['id'])['data']['children'] ?? [];
            } catch (\Throwable $e) {
                $errors[] = $park['name'] . ': ' . $e->getMessage();
                continue;
            }
            $tracked = array_filter($children, fn ($c) => in_array($c['entityType'] ?? '', self::TYPES, true));
            if (!$tracked) {
                $errors[] = $park['name'] . ': nothing listed';
                continue;
            }
            $anyOk = true;

            $showIds = [];
            foreach ($tracked as $c) {
                if ($c['entityType'] === 'SHOW') {
                    $showIds[] = (string) $c['id'];
                }
            }
            [$dates, $fresh] = $this->schedules($showIds);

            $this->db->exec('BEGIN IMMEDIATE'); // web requests write too: take the lock before the first read
            try {
                array_push($added, ...$this->recordEntities($key, $tracked, $today));
                $this->recordDays($dates, $fresh, $today);
                $seen = array_flip(array_map(fn ($c) => (string) $c['id'], $tracked));
                $completed += $this->updateStatuses($key, $seen, $fresh, $dates, $today);
                $this->db->exec('COMMIT');
            } catch (\Throwable $e) {
                $this->db->exec('ROLLBACK');
                throw $e;
            }
        }

        if ($anyOk) {
            $this->db->prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('catalog:checked', ?)")->execute([(string) time()]);
        }
        return ['new' => $added, 'completed' => $completed, 'errors' => $errors];
    }

    /** What the app shows: things that appeared lately, and shows that have finished. */
    public function data(): array
    {
        $cutoff = (new \DateTimeImmutable('today', $this->tz))->modify('-' . self::NEW_FOR_DAYS . ' days')->format('Y-m-d');
        $new = $this->db->prepare(
            'SELECT entity_id AS id, park_key AS park, type, name, first_seen AS firstSeen FROM catalog
             WHERE baseline = 0 AND first_seen >= ? ORDER BY first_seen DESC, name'
        );
        $new->execute([$cutoff]);
        $completed = $this->db->query(
            "SELECT c.entity_id AS id, c.park_key AS park, c.name, MAX(d.day) AS lastDay FROM catalog c
             JOIN show_days d ON d.entity_id = c.entity_id
             WHERE c.status = 'completed' GROUP BY c.entity_id ORDER BY lastDay DESC, c.name"
        )->fetchAll();

        $added = $this->db->query(
            'SELECT entity_id AS id, park_key AS park, type, name, first_seen AS firstSeen FROM catalog
             WHERE baseline = 0 ORDER BY first_seen DESC, name'
        )->fetchAll();

        return [
            'new'       => array_values(array_filter($new->fetchAll(), fn ($r) => !self::reserved($r['name']))),
            'added'     => array_values(array_filter($added, fn ($r) => !self::reserved($r['name']))),
            'completed' => array_values(array_filter($completed, fn ($r) => !self::reserved($r['name']))),
            'checkedAt' => $this->checkedAt() ?: null,
        ];
    }

    /** Put back the performances upstream has already dropped from the visit's past days. */
    public function mergeTrip(array $trip): array
    {
        $today = $this->today();
        $s = $this->db->prepare(
            "SELECT d.entity_id, d.times, c.park_key, c.name FROM show_days d
             JOIN catalog c ON c.entity_id = d.entity_id
             WHERE d.day = ? AND c.type = 'SHOW'"
        );
        foreach ($trip['days'] as &$day) {
            if ($day['date'] >= $today) {
                continue;
            }
            $have = [];
            foreach ($day['shows'] as $show) {
                $have[$show['id'] . '|' . $show['start']] = true;
            }
            $s->execute([$day['date']]);
            foreach ($s->fetchAll() as $r) {
                foreach (json_decode((string) $r['times'], true) ?: [] as $t) {
                    if (!isset($have[$r['entity_id'] . '|' . $t['start']])) {
                        $day['shows'][] = [
                            'id'       => $r['entity_id'],
                            'park'     => $r['park_key'],
                            'name'     => $r['name'],
                            'reserved' => self::reserved($r['name']),
                            'start'    => $t['start'],
                            'end'      => $t['end'],
                        ];
                    }
                }
            }
            usort($day['shows'], fn ($a, $b) => strcmp($a['start'], $b['start']));
        }
        unset($day);
        return $trip;
    }

    /**
     * Published dates for these shows, this month and next (later months are refused upstream).
     *
     * @return array{array<string, array<string, list<array>>>, array<string, true>} dates by
     *         show and day, and the shows whose whole window loaded
     */
    private function schedules(array $ids): array
    {
        $month = new \DateTimeImmutable('first day of this month', $this->tz);
        $fresh = array_fill_keys($ids, true);
        $dates = [];
        foreach ([$month, $month->modify('+1 month')] as $m) {
            foreach ($this->tp->scheduleMany($ids, (int) $m->format('Y'), (int) $m->format('n')) as $id => $env) {
                if ($env === null || !empty($env['stale'])) {
                    unset($fresh[$id]);
                    continue;
                }
                foreach ($env['data']['schedule'] ?? [] as $s) {
                    if (!empty($s['date']) && !empty($s['openingTime'])) {
                        $dates[$id][$s['date']][] = ['start' => $s['openingTime'], 'end' => $s['closingTime'] ?? null];
                    }
                }
            }
        }
        return [$dates, $fresh];
    }

    /** @return list<array> what's appeared since the last check. A park's first check is the baseline, not news. */
    private function recordEntities(string $key, array $tracked, string $today): array
    {
        $s = $this->db->prepare('SELECT entity_id FROM catalog WHERE park_key = ?');
        $s->execute([$key]);
        $known = array_flip($s->fetchAll(\PDO::FETCH_COLUMN));
        $baseline = $known === [] ? 1 : 0;

        $upsert = $this->db->prepare(
            "INSERT INTO catalog (entity_id, park_key, type, name, first_seen, last_seen, baseline, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
             ON CONFLICT(entity_id) DO UPDATE SET park_key = excluded.park_key, type = excluded.type,
                 name = excluded.name, last_seen = excluded.last_seen"
        );
        $added = [];
        foreach ($tracked as $c) {
            $id = (string) $c['id'];
            $name = Text::displayName((string) $c['name']);
            $upsert->execute([$id, $key, $c['entityType'], $name, $today, $today, $baseline]);
            if (!$baseline && !isset($known[$id])) {
                $added[] = $name;
            }
        }
        return $added;
    }

    /** Keep every past day. Future days upstream has withdrawn go, or a cancelled show would never finish. */
    private function recordDays(array $dates, array $fresh, string $today): void
    {
        $this->db->exec(
            "INSERT OR IGNORE INTO show_days (entity_id, day, times)
             SELECT entity_id, date(watched_at, 'unixepoch'), '[]' FROM show_log"
        );
        $put = $this->db->prepare('INSERT OR REPLACE INTO show_days (entity_id, day, times) VALUES (?, ?, ?)');
        foreach ($dates as $id => $days) {
            foreach ($days as $day => $times) {
                $put->execute([$id, $day, json_encode($times)]);
            }
        }
        $future = $this->db->prepare('SELECT day FROM show_days WHERE entity_id = ? AND day > ?');
        $drop = $this->db->prepare('DELETE FROM show_days WHERE entity_id = ? AND day = ?');
        foreach (array_keys($fresh) as $id) {
            $future->execute([$id, $today]);
            foreach ($future->fetchAll(\PDO::FETCH_COLUMN) as $day) {
                if (!isset($dates[$id][$day])) {
                    $drop->execute([$id, $day]);
                }
            }
        }
    }

    /** @return int shows newly marked completed */
    private function updateStatuses(string $key, array $seen, array $fresh, array $dates, string $today): int
    {
        // No dates ahead for any show in the park means a feed problem, not that everything ended.
        $parkHasFuture = false;
        foreach ($dates as $days) {
            foreach (array_keys($days) as $day) {
                $parkHasFuture = $parkHasFuture || $day >= $today;
            }
        }

        $rows = $this->db->prepare("SELECT entity_id, status FROM catalog WHERE park_key = ? AND type = 'SHOW'");
        $rows->execute([$key]);
        $lastDay = $this->db->prepare('SELECT MAX(day) FROM show_days WHERE entity_id = ?');
        $set = $this->db->prepare('UPDATE catalog SET status = ? WHERE entity_id = ?');
        $count = 0;
        foreach ($rows->fetchAll() as $r) {
            $id = $r['entity_id'];
            $lastDay->execute([$id]);
            $last = $lastDay->fetchColumn();
            $lastDay->closeCursor();
            if (!$last) {
                continue; // never seen running
            }
            $status = $r['status'];
            if ($last >= $today) {
                $status = 'active';
            } elseif (!isset($seen[$id]) || (isset($fresh[$id]) && $parkHasFuture)) {
                $status = 'completed';
            }
            if ($status !== $r['status']) {
                $set->execute([$status, $id]);
                $count += $status === 'completed' ? 1 : 0;
            }
        }
        return $count;
    }

    private function checkedAt(): int
    {
        return (int) $this->db->query("SELECT value FROM meta WHERE key = 'catalog:checked'")->fetchColumn();
    }

    private function today(): string
    {
        return (new \DateTimeImmutable('now', $this->tz))->format('Y-m-d');
    }

    private static function reserved(string $name): bool
    {
        return str_starts_with(Text::norm($name), 'reserved viewing area');
    }
}
