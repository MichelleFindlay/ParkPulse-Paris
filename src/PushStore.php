<?php

declare(strict_types=1);

namespace ParkPulse;

/** Push subscriptions (one per phone/browser), their notification prefs and ride alerts. */
final class PushStore
{
    public const DEFAULT_PREFS = ['alerts' => true, 'shows' => true, 'bookings' => true, 'brief' => true, 'lastchance' => true];

    public function __construct(private \PDO $db)
    {
    }

    public function subscribe(string $endpoint, string $p256dh, string $auth, string $device, ?array $user, array $prefs): int
    {
        $prefs = array_intersect_key($prefs + self::DEFAULT_PREFS, self::DEFAULT_PREFS);
        $this->db->prepare(
            'INSERT INTO push_subs (endpoint, p256dh, auth, device, user_sub, user_name, prefs, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth,
               device = excluded.device, user_sub = excluded.user_sub, user_name = excluded.user_name, prefs = excluded.prefs'
        )->execute([$endpoint, $p256dh, $auth, $device, $user['sub'] ?? null, $user['name'] ?? null,
            json_encode(array_map('boolval', $prefs)), time()]);
        return (int) $this->idFor($endpoint);
    }

    public function unsubscribe(string $endpoint): void
    {
        $id = $this->idFor($endpoint);
        if ($id !== null) {
            $this->delete($id);
        }
    }

    public function delete(int $id): void
    {
        $this->db->prepare('DELETE FROM push_alerts WHERE sub_id = ?')->execute([$id]);
        $this->db->prepare('DELETE FROM push_subs WHERE id = ?')->execute([$id]);
    }

    public function idFor(string $endpoint): ?int
    {
        $s = $this->db->prepare('SELECT id FROM push_subs WHERE endpoint = ?');
        $s->execute([$endpoint]);
        $id = $s->fetchColumn();
        return $id === false ? null : (int) $id;
    }

    public function setPrefs(string $endpoint, array $prefs): void
    {
        $prefs = array_intersect_key($prefs + self::DEFAULT_PREFS, self::DEFAULT_PREFS);
        $this->db->prepare('UPDATE push_subs SET prefs = ? WHERE endpoint = ?')
            ->execute([json_encode(array_map('boolval', $prefs)), $endpoint]);
    }

    /**
     * Replace this phone's ride alerts (the app keeps the master copy on the phone).
     * Alerts whose condition is unchanged keep their last-seen status so nothing re-fires.
     *
     * @param list<array{id:string, park:string, name:string, reopen?:bool, down?:bool, maxWait?:?int}> $alerts
     */
    public function setAlerts(string $endpoint, array $alerts): void
    {
        $sub = $this->idFor($endpoint);
        if ($sub === null) {
            return;
        }
        $this->db->beginTransaction();
        try {
            $keep = [];
            $up = $this->db->prepare(
                'INSERT INTO push_alerts (sub_id, entity_id, park_key, name, reopen, down, max_wait)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(sub_id, entity_id) DO UPDATE SET park_key = excluded.park_key, name = excluded.name,
                   reopen = excluded.reopen, down = excluded.down, max_wait = excluded.max_wait'
            );
            foreach (array_slice($alerts, 0, 100) as $a) {
                $id = (string) ($a['id'] ?? '');
                if (!preg_match('/^[A-Za-z0-9_-]{1,80}$/', $id) || !in_array($a['park'] ?? '', ParkService::KEYS, true)) {
                    continue;
                }
                $max = isset($a['maxWait']) && is_numeric($a['maxWait']) ? max(0, min(600, (int) $a['maxWait'])) : null;
                $up->execute([$sub, $id, $a['park'], substr((string) ($a['name'] ?? $id), 0, 200),
                    !empty($a['reopen']) ? 1 : 0, !empty($a['down']) ? 1 : 0, $max]);
                $keep[] = $id;
            }
            $del = $this->db->prepare(
                'DELETE FROM push_alerts WHERE sub_id = ?' . ($keep ? ' AND entity_id NOT IN (' . implode(',', array_fill(0, count($keep), '?')) . ')' : '')
            );
            $del->execute(array_merge([$sub], $keep));
            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }
    }

    /**
     * Push the party's day plan to every phone: [{id, park, name, start(ms)}…] (rides only).
     * The plan itself is shared (see Party::setPlan) — this just gives every subscription
     * its own copy so the notifier can warn each phone if one of today's rides goes down.
     */
    public function broadcastPlan(?array $plan): void
    {
        $clean = null;
        if ($plan && isset($plan['date']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $plan['date'])) {
            $items = [];
            foreach (array_slice($plan['items'] ?? [], 0, 60) as $it) {
                if (isset($it['id'], $it['park']) && preg_match('/^[A-Za-z0-9_-]{1,80}$/', (string) $it['id'])
                    && in_array($it['park'], ParkService::KEYS, true)) {
                    $items[] = ['id' => (string) $it['id'], 'park' => $it['park'], 'name' => substr((string) ($it['name'] ?? ''), 0, 200),
                        'start' => (int) ($it['start'] ?? 0)];
                }
            }
            $clean = json_encode(['date' => $plan['date'], 'items' => $items]);
        }
        $this->db->prepare('UPDATE push_subs SET plan = ?')->execute([$clean]);
    }

    public function status(string $endpoint): ?array
    {
        $s = $this->db->prepare('SELECT id, prefs, last_ok FROM push_subs WHERE endpoint = ?');
        $s->execute([$endpoint]);
        $r = $s->fetch();
        if (!$r) {
            return null;
        }
        $n = $this->db->prepare('SELECT COUNT(*) FROM push_alerts WHERE sub_id = ?');
        $n->execute([$r['id']]);
        return [
            'prefs'  => (json_decode($r['prefs'], true) ?: []) + self::DEFAULT_PREFS,
            'alerts' => (int) $n->fetchColumn(),
            'lastOk' => $r['last_ok'] === null ? null : (int) $r['last_ok'],
        ];
    }

    /** @return list<array> all subscriptions with decoded prefs */
    public function all(): array
    {
        $out = [];
        foreach ($this->db->query('SELECT * FROM push_subs') as $r) {
            $r['prefs'] = (json_decode($r['prefs'], true) ?: []) + self::DEFAULT_PREFS;
            $out[] = $r;
        }
        return $out;
    }

    public function alerts(): array
    {
        return $this->db->query('SELECT * FROM push_alerts')->fetchAll();
    }

    public function markOk(int $subId): void
    {
        $this->db->prepare('UPDATE push_subs SET last_ok = ? WHERE id = ?')->execute([time(), $subId]);
    }

    /** True the first time a key is seen (de-duplicates reminders). */
    public function once(string $key): bool
    {
        $s = $this->db->prepare('INSERT OR IGNORE INTO push_sent (key, ts) VALUES (?, ?)');
        $s->execute([$key, time()]);
        return $s->rowCount() === 1;
    }

    public function prune(): void
    {
        $this->db->prepare('DELETE FROM push_sent WHERE ts < ?')->execute([time() - 4 * 86400]);
    }
}
