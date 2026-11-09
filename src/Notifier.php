<?php

declare(strict_types=1);

namespace ParkPulse;

/**
 * Server-side notifications, run by the cron collector every 5 minutes, so they
 * reach phones even when Park Pulse is closed:
 *   • ride alerts (reopens / wait ≤ target / goes down), per phone
 *   • reminders ~15 min before starred shows (party must-do list)
 *   • reminders ~30 min before bookings (restaurants, Premier Access returns…)
 *   • a morning brief on trip days
 * Anything about what's happening in the parks right now only goes out on trip days.
 */
final class Notifier
{
    public function __construct(
        private PushStore $store,
        private WebPush $push,
        private ParkService $parks,
        private Party $party,
        private \PDO $db,
        private array $config,
        private \Closure $weather,  // fn(): array forecast
        private \Closure $transit,  // fn(): array status
    ) {
    }

    /** @param array<string, array> $live park key => ParkService::live() result (fresh this run) */
    public function run(array $live): array
    {
        $subs = $this->store->all();
        $sent = 0;
        if (!$subs) {
            return ['subscriptions' => 0, 'sent' => 0];
        }
        $byId = [];
        foreach ($subs as $s) {
            $byId[(int) $s['id']] = $s;
        }
        $deliver = function (array $sub, array $msg, string $urgency = 'normal') use (&$sent): void {
            try {
                $code = $this->push->send($sub, $msg, 3600, $urgency);
            } catch (\Throwable $e) {
                error_log('[park-pulse] push: ' . $e->getMessage());
                return;
            }
            if ($code === 404 || $code === 410) {
                $this->store->delete((int) $sub['id']); // phone unsubscribed / app removed
            } elseif ($code >= 200 && $code < 300) {
                $this->store->markOk((int) $sub['id']);
                $sent++;
            }
        };

        // Items by id across the parks fetched this run.
        $items = [];
        foreach ($live as $key => $d) {
            foreach ($d['items'] ?? [] as $it) {
                $items[$it['id']] = $it + ['park' => $key];
            }
        }

        $today = (new \DateTimeImmutable('now', new \DateTimeZone($this->config['timezone'])))->format('Y-m-d');
        $onTrip = $today >= $this->config['trip']['start'] && $today <= $this->config['trip']['end'];

        $this->rideAlerts($byId, $items, $deliver, $onTrip);
        if ($onTrip) {
            $this->planWatch($subs, $items, $deliver);
            $this->showReminders($subs, $items, $deliver);
            $this->lastChance($subs, $live, $deliver);
        }
        $this->bookingReminders($subs, $deliver);
        $this->morningBrief($subs, $deliver);
        $this->store->prune();

        return ['subscriptions' => count($subs), 'sent' => $sent];
    }

    /** Off-trip runs send nothing but still record each ride's status, so day one doesn't open with a burst of stale alerts. */
    private function rideAlerts(array $subs, array $items, callable $deliver, bool $onTrip): void
    {
        $update = $this->db->prepare('UPDATE push_alerts SET last_status = ?, last_wait = ?, reopen = ? WHERE id = ?');
        $remove = $this->db->prepare('DELETE FROM push_alerts WHERE id = ?');
        foreach ($this->store->alerts() as $a) {
            $sub = $subs[(int) $a['sub_id']] ?? null;
            $it = $items[$a['entity_id']] ?? null;
            if ($sub === null || $it === null) {
                continue;
            }
            $prev = $a['last_status'];
            $lastWait = $a['last_wait'] === null ? null : (int) $a['last_wait'];
            $status = (string) $it['status'];
            $wait = $it['wait'];
            $reopen = (int) $a['reopen'];
            $on = $onTrip && ($sub['prefs']['alerts'] ?? true) !== false;
            $url = './#ride=' . $a['entity_id'];

            if ($prev !== null && $on) {
                if ($reopen && $prev !== 'OPERATING' && $status === 'OPERATING') {
                    $deliver($sub, ['title' => "{$a['name']} is open", 'body' => $wait !== null ? "Standby {$wait} min" : 'Back up and running', 'tag' => 'reopen-' . $a['entity_id'], 'url' => $url], 'high');
                    $reopen = 0;
                }
                $max = $a['max_wait'] === null ? null : (int) $a['max_wait'];
                if ($max !== null && $status === 'OPERATING' && $wait !== null && $wait <= $max
                    && ($prev !== 'OPERATING' || $lastWait === null || $lastWait > $max)) {
                    $deliver($sub, ['title' => "{$a['name']}: {$wait} min", 'body' => "At or under your {$max} min target", 'tag' => 'wait-' . $a['entity_id'], 'url' => $url], 'high');
                }
                if ((int) $a['down'] && $prev === 'OPERATING' && $status === 'DOWN') {
                    $deliver($sub, ['title' => "{$a['name']} just went down", 'body' => 'Temporarily closed', 'tag' => 'down-' . $a['entity_id'], 'url' => $url]);
                }
            }

            if (!$reopen && $a['max_wait'] === null && !(int) $a['down']) {
                $remove->execute([$a['id']]);
            } else {
                $update->execute([$status, $wait, $reopen, $a['id']]);
            }
        }
    }

    /** Real-time plan check: warn when one of the next planned rides stops running. */
    private function planWatch(array $subs, array $items, callable $deliver): void
    {
        $today = (new \DateTimeImmutable('now', new \DateTimeZone($this->config['timezone'])))->format('Y-m-d');
        $nowMs = time() * 1000;
        foreach ($subs as $sub) {
            $plan = json_decode((string) ($sub['plan'] ?? ''), true);
            if (!is_array($plan) || ($plan['date'] ?? '') !== $today || !($sub['prefs']['alerts'] ?? true)) {
                continue;
            }
            $upcoming = array_values(array_filter($plan['items'] ?? [], fn ($i) => $i['start'] > $nowMs - 15 * 60000));
            foreach (array_slice($upcoming, 0, 2) as $i) {
                $it = $items[$i['id']] ?? null;
                if ($it !== null && in_array($it['status'], ['DOWN', 'CLOSED'], true)
                    && $this->store->once("plan:{$today}:{$sub['id']}:{$i['id']}")) {
                    $deliver($sub, [
                        'title' => "{$it['name']} isn’t running",
                        'body'  => 'It’s next in your plan — open Park Pulse to re-plan around it.',
                        'tag'   => 'plan-' . $i['id'],
                        'url'   => './#tab=now&replan=1',
                    ], 'high');
                }
            }
        }
    }

    private function showReminders(array $subs, array $items, callable $deliver): void
    {
        $favs = $this->db->query('SELECT entity_id FROM favourites')->fetchAll(\PDO::FETCH_COLUMN);
        $now = time();
        foreach ($favs as $id) {
            $it = $items[$id] ?? null;
            if ($it === null || $it['type'] !== 'SHOW') {
                continue;
            }
            foreach ($it['showtimes'] ?? [] as $st) {
                $start = strtotime((string) $st['start']);
                $mins = (int) round(($start - $now) / 60);
                if ($mins < 5 || $mins > 20) {
                    continue;
                }
                $at = (new \DateTimeImmutable('@' . $start))->setTimezone(new \DateTimeZone($this->config['timezone']))->format('H:i');
                foreach ($subs as $sub) {
                    if (($sub['prefs']['shows'] ?? true) && $this->store->once("show:{$id}:{$start}:{$sub['id']}")) {
                        $deliver($sub, ['title' => "{$it['name']} at {$at}", 'body' => "Starts in {$mins} min", 'tag' => "show-{$id}-{$start}", 'url' => './#tab=shows']);
                    }
                }
            }
        }
    }

    private function bookingReminders(array $subs, callable $deliver): void
    {
        $tz = new \DateTimeZone($this->config['timezone']);
        $labels = ['RESTAURANT' => 'Table booked', 'PREMIER_ACCESS' => 'Premier Access return', 'SHOW' => 'Show booked', 'OTHER' => 'Reminder'];
        foreach ($this->party->upcomingBookings(35 * 60) as $b) {
            $at = (new \DateTimeImmutable('@' . $b['at']))->setTimezone($tz)->format('H:i');
            $mins = (int) round(($b['at'] - time()) / 60);
            foreach ($subs as $sub) {
                if (($sub['prefs']['bookings'] ?? true) && $this->store->once("booking:{$b['id']}:{$sub['id']}")) {
                    $deliver($sub, [
                        'title' => ($labels[$b['kind']] ?? 'Booking') . " · {$at}",
                        'body'  => "{$b['name']} in {$mins} min" . ($b['note'] !== '' ? " — {$b['note']}" : ''),
                        'tag'   => 'booking-' . $b['id'],
                        'url'   => './#tab=trip',
                    ], 'high');
                }
            }
        }
    }

    /**
     * ~45 min before a park closes: must-dos in that park you haven't ridden today
     * (per signed-in user when OIDC is used, otherwise for the whole party).
     */
    private function lastChance(array $subs, array $live, callable $deliver): void
    {
        $tz = new \DateTimeZone($this->config['timezone']);
        $today = (new \DateTimeImmutable('now', $tz))->format('Y-m-d');
        $favs = array_flip($this->db->query('SELECT entity_id FROM favourites')->fetchAll(\PDO::FETCH_COLUMN));
        if (!$favs) {
            return;
        }
        $midnight = (new \DateTimeImmutable('today', $tz))->getTimestamp();
        foreach ($live as $key => $d) {
            $close = null;
            foreach ($d['hours'] ?? [] as $s) {
                if (($s['type'] ?? '') === 'OPERATING' && !empty($s['close'])) {
                    $close = strtotime((string) $s['close']);
                }
            }
            if ($close === null) {
                continue;
            }
            $mins = ($close - time()) / 60;
            if ($mins < 35 || $mins > 55) {
                continue;
            }
            $rides = array_values(array_filter($d['items'] ?? [], fn ($it) => $it['type'] === 'ATTRACTION'
                && isset($favs[$it['id']]) && $it['status'] === 'OPERATING'));
            if (!$rides) {
                continue;
            }
            $at = (new \DateTimeImmutable('@' . $close))->setTimezone($tz)->format('H:i');
            $parkName = $this->parks->park($key)['short'];
            foreach ($subs as $sub) {
                if (($sub['prefs']['lastchance'] ?? true) === false) {
                    continue;
                }
                $sql = 'SELECT DISTINCT entity_id FROM ride_log WHERE ridden_at >= ?' . ($sub['user_sub'] ? ' AND user_sub = ?' : '');
                $st = $this->db->prepare($sql);
                $st->execute($sub['user_sub'] ? [$midnight, $sub['user_sub']] : [$midnight]);
                $done = array_flip($st->fetchAll(\PDO::FETCH_COLUMN));
                $left = array_filter($rides, fn ($it) => !isset($done[$it['id']]));
                if (!$left || !$this->store->once("lastchance:{$today}:{$key}:{$sub['id']}")) {
                    continue;
                }
                usort($left, fn ($a, $b) => ($a['wait'] ?? 99) <=> ($b['wait'] ?? 99));
                $list = implode(', ', array_map(fn ($it) => $it['name'] . ($it['wait'] !== null ? " ({$it['wait']} min)" : ''), array_slice($left, 0, 4)));
                $deliver($sub, [
                    'title' => "Last chance at {$parkName} — closes {$at}",
                    'body'  => 'Not ridden yet: ' . $list . (count($left) > 4 ? ' +' . (count($left) - 4) . ' more' : ''),
                    'tag'   => "lastchance-{$key}-{$today}",
                    'url'   => './#tab=now',
                ], 'high');
            }
        }
    }

    private function morningBrief(array $subs, callable $deliver): void
    {
        $tz = new \DateTimeZone($this->config['timezone']);
        $now = new \DateTimeImmutable('now', $tz);
        $date = $now->format('Y-m-d');
        $briefAt = new \DateTimeImmutable($date . ' ' . ($this->config['brief_time'] ?? '08:00'), $tz);
        $trip = $this->config['trip'];
        $from = (new \DateTimeImmutable($trip['start'], $tz))->modify('-1 day')->format('Y-m-d');
        if ($date < $from || $date > $trip['end'] || $now < $briefAt || $now > $briefAt->modify('+3 hours')) {
            return;
        }
        $wanted = array_filter($subs, fn ($s) => ($s['prefs']['brief'] ?? true) && !$this->alreadySent("brief:{$date}:{$s['id']}"));
        if (!$wanted) {
            return;
        }

        $lines = [];
        foreach ($this->parks->parks()['parks'] as $key => $p) {
            $segs = $this->parks->dayHours($key, $date);
            $op = null;
            $emh = null;
            foreach ($segs as $s) {
                if ($s['type'] === 'OPERATING') {
                    $op = $s;
                } elseif ($s['type'] === 'EXTRA_HOURS') {
                    $emh = $s;
                }
            }
            $fmt = fn ($iso) => (new \DateTimeImmutable((string) $iso))->setTimezone($tz)->format('H:i');
            if ($op) {
                $lines[] = $p['short'] . ' ' . $fmt($op['open']) . '–' . $fmt($op['close']) . ($emh ? ' (EMH ' . $fmt($emh['open']) . ')' : '');
            }
        }
        try {
            $w = ($this->weather)();
            if ($w['current'] ?? null) {
                $rain = null;
                foreach (array_slice($w['hourly'] ?? [], 0, 14) as $h) {
                    if (($h['pop'] ?? 0) >= 50) {
                        $rain = substr($h['time'], 11, 5);
                        break;
                    }
                }
                $d = $w['daily'][$date] ?? null;
                $lines[] = $w['current']['icon'] . ' ' . ($d ? "{$d['max']}°/{$d['min']}°" : $w['current']['temp'] . '°') . ($rain ? " · rain from {$rain}" : ' · dry');
            }
        } catch (\Throwable) {
        }
        try {
            $t = ($this->transit)();
            if ($t['enabled'] ?? false) {
                $dis = array_filter($t['messages'] ?? [], fn ($m) => $m['severity'] === 'disruption');
                $lines[] = $dis ? '🚆 RER A disrupted' : '🚆 RER A running normally';
            }
        } catch (\Throwable) {
        }
        $bookings = array_filter($this->party->bookings(), fn ($b) => $b['day'] === $date);
        if ($bookings) {
            $lines[] = count($bookings) . ' booking' . (count($bookings) === 1 ? '' : 's') . ' today — first at '
                . (new \DateTimeImmutable('@' . min(array_column($bookings, 'at'))))->setTimezone($tz)->format('H:i');
        }

        foreach ($wanted as $sub) {
            if ($this->store->once("brief:{$date}:{$sub['id']}")) {
                $deliver($sub, ['title' => 'Good morning — today at the parks', 'body' => implode("\n", $lines) ?: 'Have a magical day!', 'tag' => 'brief-' . $date, 'url' => './#tab=trip']);
            }
        }
    }

    private function alreadySent(string $key): bool
    {
        $s = $this->db->prepare('SELECT 1 FROM push_sent WHERE key = ?');
        $s->execute([$key]);
        return (bool) $s->fetchColumn();
    }
}
