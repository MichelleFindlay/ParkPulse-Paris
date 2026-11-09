<?php

declare(strict_types=1);

namespace ParkPulse;

/**
 * The party's trips to the resort. Exactly one is "current": the one happening now, else
 * the next one coming up, else the one that ended last. Rides and shows aren't tied to a
 * visit: a visit is a date range, so deleting one never deletes anything anyone logged.
 *
 * config.php's `trip` seeds the list. Changing it later still works: new dates become a
 * new visit, and dates overlapping one visit correct that visit.
 */
final class Visits
{
    private const MAX_DAYS = 31; // ParkService::tripDates() stops here

    public function __construct(private \PDO $db, private \DateTimeZone $tz, private array $configTrip)
    {
        $this->syncConfig();
    }

    /** @return list<array{id: int, name: string, start: string, end: string}> newest first */
    public function all(): array
    {
        $rows = $this->db->query('SELECT id, name, start_date, end_date, budget_cents FROM visits ORDER BY start_date DESC')->fetchAll();
        return array_map(self::row(...), $rows);
    }

    /** Falls back to the config dates if there are no usable visits, so the app always has a trip. */
    public function current(): array
    {
        $today = $this->today();
        $visits = $this->all(); // newest first
        $next = null;
        foreach ($visits as $v) {
            if ($v['start'] <= $today && $v['end'] >= $today) {
                return $v;
            }
            if ($v['start'] > $today) {
                $next = $v; // keeps overwriting, so this ends up as the soonest
            }
        }
        return $next ?? $visits[0] ?? [
            'id'    => null,
            'name'  => '',
            'budgetCents' => null,
            'start' => (string) ($this->configTrip['start'] ?? $today),
            'end'   => (string) ($this->configTrip['end'] ?? $today),
        ];
    }

    public function find(int $id): ?array
    {
        $s = $this->db->prepare('SELECT id, name, start_date, end_date, budget_cents FROM visits WHERE id = ?');
        $s->execute([$id]);
        $r = $s->fetch();
        return $r ? self::row($r) : null;
    }

    /** Add a visit, or change one when $id is given. New dates throw away what was saved for the old ones. */
    public function save(?int $id, string $name, string $start, string $end, ?string $by): void
    {
        $this->validate($id, $start, $end);
        if ($id === null) {
            $this->db->prepare('INSERT INTO visits (name, start_date, end_date, created_by, created_at) VALUES (?, ?, ?, ?, ?)')
                ->execute([$name, $start, $end, $by, time()]);
            return;
        }
        $old = $this->find($id);
        if ($old === null) {
            throw new HttpError(404, 'Visit not found');
        }
        $this->db->prepare('UPDATE visits SET name = ?, start_date = ?, end_date = ? WHERE id = ?')->execute([$name, $start, $end, $id]);
        if ($old['start'] !== $start || $old['end'] !== $end) {
            $this->setSnapshot($id, null);
        }
    }

    public function setBudget(int $id, ?int $cents): void
    {
        if ($this->find($id) === null) {
            throw new HttpError(404, 'Visit not found');
        }
        $this->db->prepare('UPDATE visits SET budget_cents = ? WHERE id = ?')->execute([$cents, $id]);
    }

    public function delete(int $id): void
    {
        if ($this->find($id) === null) {
            throw new HttpError(404, 'Visit not found');
        }
        if (count($this->all()) <= 1) {
            throw new HttpError(422, 'Add another visit before deleting this one');
        }
        $this->db->prepare('DELETE FROM visits WHERE id = ?')->execute([$id]);
    }

    /** What was saved for Wrapped once this visit ended. */
    public function snapshot(int $id): array
    {
        $s = $this->db->prepare('SELECT snapshot FROM visits WHERE id = ?');
        $s->execute([$id]);
        $data = json_decode((string) $s->fetchColumn(), true);
        return is_array($data) ? $data : [];
    }

    public function setSnapshot(int $id, ?array $data): void
    {
        $this->db->prepare('UPDATE visits SET snapshot = ? WHERE id = ?')->execute([$data === null ? null : json_encode($data), $id]);
    }

    private function validate(?int $id, string $start, string $end): void
    {
        foreach ([$start, $end] as $d) {
            $parsed = \DateTimeImmutable::createFromFormat('!Y-m-d', $d, $this->tz);
            if ($parsed === false || $parsed->format('Y-m-d') !== $d) {
                throw new HttpError(422, 'Choose a start and end date');
            }
        }
        if ($end < $start) {
            throw new HttpError(422, 'The visit can’t end before it starts');
        }
        $days = (new \DateTimeImmutable($start, $this->tz))->diff(new \DateTimeImmutable($end, $this->tz))->days + 1;
        if ($days > self::MAX_DAYS) {
            throw new HttpError(422, 'A visit can be ' . self::MAX_DAYS . ' days at most');
        }
        if ($this->overlapping($start, $end, $id)) {
            throw new HttpError(422, 'Those dates overlap another visit');
        }
    }

    /** @return list<int> ids of visits sharing a day with this range */
    private function overlapping(string $start, string $end, ?int $except): array
    {
        $s = $this->db->prepare('SELECT id FROM visits WHERE start_date <= ? AND end_date >= ? AND id != ?');
        $s->execute([$end, $start, $except ?? 0]);
        return array_map('intval', $s->fetchAll(\PDO::FETCH_COLUMN));
    }

    /** Pick up the config dates once each time they change, so a deleted visit doesn't come back. */
    private function syncConfig(): void
    {
        $start = (string) ($this->configTrip['start'] ?? '');
        $end = (string) ($this->configTrip['end'] ?? '');
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $start) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $end) || $end < $start) {
            return;
        }
        $seen = "{$start}|{$end}";
        $read = $this->db->prepare("SELECT value FROM meta WHERE key = 'visits:config'");
        $read->execute();
        $last = $read->fetchColumn();
        $read->closeCursor(); // an open read would block the write below
        if ($last === $seen) {
            return;
        }

        $this->db->exec('BEGIN IMMEDIATE'); // two first requests mustn't both add it
        try {
            $read->execute();
            $last = $read->fetchColumn();
            $read->closeCursor();
            if ($last !== $seen) {
                $hits = $this->overlapping($start, $end, null);
                if (!$hits) {
                    $this->db->prepare('INSERT INTO visits (name, start_date, end_date, created_at) VALUES (\'\', ?, ?, ?)')->execute([$start, $end, time()]);
                } elseif (count($hits) === 1) {
                    $this->db->prepare('UPDATE visits SET start_date = ?, end_date = ?, snapshot = NULL WHERE id = ?')->execute([$start, $end, $hits[0]]);
                }
                $this->db->prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('visits:config', ?)")->execute([$seen]);
            }
            $this->db->exec('COMMIT');
        } catch (\Throwable $e) {
            $this->db->exec('ROLLBACK');
            throw $e;
        }
    }

    private function today(): string
    {
        return (new \DateTimeImmutable('now', $this->tz))->format('Y-m-d');
    }

    private static function row(array $r): array
    {
        return [
            'id'          => (int) $r['id'],
            'name'        => (string) $r['name'],
            'start'       => $r['start_date'],
            'end'         => $r['end_date'],
            'budgetCents' => $r['budget_cents'] === null ? null : (int) $r['budget_cents'],
        ];
    }
}
