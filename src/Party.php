<?php

declare(strict_types=1);

namespace ParkPulse;

/** Shared party data: bookings, opt-in live locations and the "meet here" pin. */
final class Party
{
    public const BOOKING_KINDS = ['RESTAURANT', 'PREMIER_ACCESS', 'SHOW', 'OTHER'];
    private const LOCATION_TTL = 1800; // locations older than 30 min are hidden

    public function __construct(private \PDO $db, private \DateTimeZone $tz)
    {
    }

    // ---------------------------------------------------------- bookings

    public function bookings(): array
    {
        $out = [];
        $s = $this->db->prepare('SELECT * FROM bookings WHERE at >= ? ORDER BY at');
        $s->execute([time() - 2 * 86400]);
        foreach ($s as $r) {
            $out[] = [
                'id'       => (int) $r['id'],
                'kind'     => $r['kind'],
                'name'     => $r['name'],
                'entityId' => $r['entity_id'],
                'park'     => $r['park_key'],
                'at'       => (int) $r['at'],
                'endsAt'   => $r['ends_at'] === null ? null : (int) $r['ends_at'],
                'day'      => (new \DateTimeImmutable('@' . $r['at']))->setTimezone($this->tz)->format('Y-m-d'),
                'note'     => $r['note'],
                'by'       => $r['created_by'],
            ];
        }
        return $out;
    }

    public function addBooking(string $kind, string $name, ?string $entityId, ?string $park, int $at, ?int $endsAt, string $note, ?string $by): void
    {
        $this->db->prepare(
            'INSERT INTO bookings (kind, name, entity_id, park_key, at, ends_at, note, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([$kind, $name, $entityId, $park, $at, $endsAt, $note, $by, time()]);
    }

    public function deleteBooking(int $id): bool
    {
        $s = $this->db->prepare('DELETE FROM bookings WHERE id = ?');
        $s->execute([$id]);
        return $s->rowCount() > 0;
    }

    /** Bookings starting within the next $seconds (for reminders). */
    public function upcomingBookings(int $seconds): array
    {
        return array_values(array_filter($this->bookings(), fn ($b) => $b['at'] > time() && $b['at'] <= time() + $seconds));
    }

    // ----------------------------------------------------------- ratings

    /** @return array<string, array{avg: float, count: int, mine: ?int, notes: list<array>}> */
    public function ratings(string $device): array
    {
        $out = [];
        foreach ($this->db->query('SELECT * FROM ratings ORDER BY ts DESC') as $r) {
            $id = $r['entity_id'];
            $out[$id] ??= ['sum' => 0, 'count' => 0, 'mine' => null, 'notes' => []];
            $out[$id]['sum'] += (int) $r['stars'];
            $out[$id]['count']++;
            if ($r['device'] === $device) {
                $out[$id]['mine'] = (int) $r['stars'];
                $out[$id]['myNote'] = $r['note'];
            }
            if ($r['note'] !== '') {
                $out[$id]['notes'][] = ['stars' => (int) $r['stars'], 'note' => $r['note'], 'by' => $r['by_name'], 'ts' => (int) $r['ts']];
            }
        }
        foreach ($out as &$o) {
            $o['avg'] = round($o['sum'] / $o['count'], 1);
            unset($o['sum']);
        }
        unset($o);
        return $out;
    }

    public function rate(string $entityId, string $device, string $name, int $stars, string $note, ?string $by): void
    {
        if ($stars === 0) {
            $this->db->prepare('DELETE FROM ratings WHERE entity_id = ? AND device = ?')->execute([$entityId, $device]);
            return;
        }
        $this->db->prepare(
            'INSERT OR REPLACE INTO ratings (entity_id, device, name, stars, note, by_name, ts) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )->execute([$entityId, $device, $name, max(1, min(5, $stars)), $note, $by, time()]);
    }

    // ---------------------------------------------------------- locations

    public function setLocation(string $device, string $name, float $lat, float $lng, ?float $acc): void
    {
        $this->db->prepare(
            'INSERT OR REPLACE INTO party_locations (device, name, lat, lng, acc, ts) VALUES (?, ?, ?, ?, ?, ?)'
        )->execute([$device, $name, $lat, $lng, $acc, time()]);
    }

    public function stopSharing(string $device): void
    {
        $this->db->prepare('DELETE FROM party_locations WHERE device = ?')->execute([$device]);
    }

    public function state(): array
    {
        $this->db->prepare('DELETE FROM party_locations WHERE ts < ?')->execute([time() - 6 * 3600]);
        $s = $this->db->prepare('SELECT device, name, lat, lng, acc, ts FROM party_locations WHERE ts >= ? ORDER BY name');
        $s->execute([time() - self::LOCATION_TTL]);
        $people = [];
        foreach ($s as $r) {
            $people[] = [
                'device' => $r['device'], 'name' => $r['name'],
                'lat' => (float) $r['lat'], 'lng' => (float) $r['lng'],
                'acc' => $r['acc'] === null ? null : (float) $r['acc'], 'ts' => (int) $r['ts'],
            ];
        }
        $pin = $this->db->query('SELECT lat, lng, label, set_by, ts FROM meet_pin WHERE id = 1')->fetch() ?: null;
        if ($pin) {
            $pin = ['lat' => (float) $pin['lat'], 'lng' => (float) $pin['lng'], 'label' => $pin['label'], 'by' => $pin['set_by'], 'ts' => (int) $pin['ts']];
        }
        return ['people' => $people, 'meet' => $pin, 'now' => time()];
    }

    public function setMeet(float $lat, float $lng, string $label, ?string $by): void
    {
        $this->db->prepare('INSERT OR REPLACE INTO meet_pin (id, lat, lng, label, set_by, ts) VALUES (1, ?, ?, ?, ?, ?)')
            ->execute([$lat, $lng, $label, $by, time()]);
    }

    public function clearMeet(): void
    {
        $this->db->exec('DELETE FROM meet_pin');
    }

    // ------------------------------------------------------------- day plan

    private const PLAN_KINDS = ['ride', 'show', 'booking'];

    /** Save the whole party's day plan. Returns the cleaned plan, or null if it was invalid. */
    public function setPlan(array $plan, ?string $by): ?array
    {
        $clean = $this->sanitizePlan($plan);
        if ($clean === null) {
            return null;
        }
        $this->db->prepare('INSERT OR REPLACE INTO day_plan (id, plan, set_by, ts) VALUES (1, ?, ?, ?)')
            ->execute([json_encode($clean), $by, time()]);
        return $clean;
    }

    /** The plan everyone on the trip currently sees, or null if nobody has set one. */
    public function getPlan(): ?array
    {
        $r = $this->db->query('SELECT plan, set_by, ts FROM day_plan WHERE id = 1')->fetch();
        if (!$r) {
            return null;
        }
        $plan = json_decode($r['plan'], true);
        return is_array($plan) ? $plan + ['by' => $r['set_by'], 'ts' => (int) $r['ts']] : null;
    }

    public function clearPlan(): void
    {
        $this->db->exec('DELETE FROM day_plan');
    }

    private function sanitizePlan(array $plan): ?array
    {
        if (!isset($plan['date']) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $plan['date'])
            || !in_array($plan['park'] ?? null, UserData::AREAS, true)) {
            return null;
        }
        $items = [];
        foreach (array_slice($plan['items'] ?? [], 0, 80) as $it) {
            if (!is_array($it) || !in_array($it['kind'] ?? '', self::PLAN_KINDS, true)) {
                continue;
            }
            $item = [
                'kind'  => $it['kind'],
                'id'    => substr((string) ($it['id'] ?? ''), 0, 80),
                'name'  => substr((string) ($it['name'] ?? ''), 0, 200),
                'start' => (int) ($it['start'] ?? 0),
                'end'   => (int) ($it['end'] ?? 0),
            ];
            if ($it['kind'] === 'ride') {
                $item['wait'] = isset($it['wait']) ? (int) $it['wait'] : null;
                $item['walk'] = isset($it['walk']) ? (int) $it['walk'] : null;
            } else {
                $item['at'] = isset($it['at']) ? (int) $it['at'] : $item['start'];
                if ($it['kind'] === 'booking') {
                    $item['sub'] = substr((string) ($it['sub'] ?? ''), 0, 40);
                }
            }
            $items[] = $item;
        }
        $skipped = array_slice(array_values(array_filter(array_map(
            fn ($s) => is_scalar($s) ? substr((string) $s, 0, 200) : null,
            $plan['skipped'] ?? []
        ))), 0, 40);
        return ['date' => $plan['date'], 'park' => $plan['park'], 'items' => $items, 'skipped' => $skipped];
    }
}
