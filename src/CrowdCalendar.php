<?php

declare(strict_types=1);

namespace ParkPulse;

/**
 * Predicted crowd level (1–10) per park per day from crowd-calendar.php, park hours
 * and events — plus the level actually measured from Park Pulse's wait history for
 * days that have data. Every prediction lists the reasons that went into it.
 */
final class CrowdCalendar
{
    public const LABELS = [1 => 'Very quiet', 2 => 'Very quiet', 3 => 'Quiet', 4 => 'Quiet', 5 => 'Moderate', 6 => 'Moderate',
        7 => 'Busy', 8 => 'Busy', 9 => 'Very busy', 10 => 'Very busy'];

    public function __construct(private ParkService $parks, private \PDO $db, private \DateTimeZone $tz)
    {
    }

    public function range(string $from, int $days): array
    {
        $file = dirname(__DIR__) . '/crowd-calendar.php';
        $cfg = is_file($file) ? require $file : [];
        $start = new \DateTimeImmutable($from, $this->tz);
        $dates = [];
        for ($i = 0; $i < $days; $i++) {
            $dates[] = $start->modify("+$i day")->format('Y-m-d');
        }

        $hours = [];
        foreach ($this->parks->parks()['parks'] as $key => $p) {
            $hours[$key] = $this->parks->hoursRange($key, $dates);
        }
        $measured = $this->measured($dates);

        $out = [];
        foreach ($dates as $date) {
            $d = new \DateTimeImmutable($date, $this->tz);
            $base = (float) ($cfg['weekday'][(int) $d->format('N')] ?? 1.5) + (float) ($cfg['month'][(int) $d->format('n')] ?? 1.0);
            $reasons = [];
            $score = $base;
            foreach ($cfg['holidays'] ?? [] as [$a, $b, $w, $label]) {
                if ($date >= $a && $date <= $b) {
                    $score += $w;
                    $reasons[] = $label;
                }
            }
            foreach ($cfg['public'] ?? [] as [$day, $w, $label]) {
                if ($date === $day) {
                    $score += $w;
                    $reasons[] = $label;
                }
                // "Pont": a Monday/Friday next to a Tuesday/Thursday public holiday.
                $pd = new \DateTimeImmutable($day, $this->tz);
                $dow = (int) $pd->format('N');
                if (($dow === 2 && $date === $pd->modify('-1 day')->format('Y-m-d')) || ($dow === 4 && $date === $pd->modify('+1 day')->format('Y-m-d'))) {
                    $score += 1.0;
                    $reasons[] = 'Long-weekend bridge day';
                }
            }
            $events = [];
            foreach ($cfg['events'] ?? [] as [$a, $b, $w, $label]) {
                if ($date >= $a && $date <= $b) {
                    $score += $w;
                    $events[] = $label;
                }
            }
            if ((int) $d->format('N') >= 6) {
                $reasons[] = 'Weekend';
            }

            $parks = [];
            foreach ($hours as $key => $byDate) {
                $segs = $byDate[$date] ?? [];
                $op = null;
                $emh = null;
                foreach ($segs as $s) {
                    if ($s['type'] === 'OPERATING') {
                        $op = $s;
                    } elseif ($s['type'] === 'EXTRA_HOURS') {
                        $emh = $s;
                    }
                }
                $parkScore = $score;
                $why = [];
                if ($op) {
                    $len = (strtotime((string) $op['close']) - strtotime((string) $op['open'])) / 3600;
                    $adj = max(-1.0, min(1.5, ($len - 11) * 0.5));
                    if (abs($adj) >= 0.25) {
                        $why[] = $adj > 0 ? 'Long opening hours' : 'Short opening hours';
                    }
                    $parkScore += $adj;
                }
                $level = (int) max(1, min(10, round($parkScore * 1.1)));
                $m = $measured[$key][$date] ?? null;
                $parks[$key] = [
                    'level'    => $level,
                    'label'    => self::LABELS[$level],
                    'open'     => $op['open'] ?? null,
                    'close'    => $op['close'] ?? null,
                    'emh'      => $emh['open'] ?? null,
                    'why'      => $why,
                    'measured' => $m,
                ];
            }

            $out[] = ['date' => $date, 'parks' => $parks, 'reasons' => $reasons, 'events' => $events];
        }

        return ['from' => $from, 'days' => $out, 'today' => (new \DateTimeImmutable('now', $this->tz))->format('Y-m-d')];
    }

    /** Level actually seen: mean standby of open rides across the day → 1–10. */
    private function measured(array $dates): array
    {
        if (!$dates) {
            return [];
        }
        $stmt = $this->db->prepare(
            "SELECT park_key, day, AVG(wait) AS a, COUNT(*) AS n FROM wait_history
             WHERE status = 'OPERATING' AND wait IS NOT NULL AND day BETWEEN ? AND ?
             GROUP BY park_key, day"
        );
        $stmt->execute([$dates[0], $dates[count($dates) - 1]]);
        $out = [];
        foreach ($stmt as $r) {
            if ((int) $r['n'] < 100) {
                continue; // a few snapshots don't describe a whole day
            }
            $avg = (float) $r['a'];
            $level = (int) max(1, min(10, round($avg / 6)));
            $out[$r['park_key']][$r['day']] = ['level' => $level, 'label' => self::LABELS[$level], 'avgWait' => (int) round($avg)];
        }
        return $out;
    }
}
