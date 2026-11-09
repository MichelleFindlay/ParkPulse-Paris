<?php

declare(strict_types=1);

namespace ParkPulse;

/**
 * Parser for the common subset of OpenStreetMap's opening_hours syntax:
 *   "24/7", "Mo-Su 10:30-01:00", "Mo-Fr 08:00-23:00; Sa 08:00-24:00",
 *   "Mo-Su 07:00-11:00,18:00-22:30", "Sa,Su 09:00-21:00", "Mo off", "08:30-23:30".
 * Later rules override earlier ones for the days they name (as in OSM). Rules with
 * month/week/date selectors aren't understood and are skipped; if nothing usable is
 * left, parse() returns null and the app shows the raw text instead.
 */
final class OpeningHours
{
    private const DAYS = ['Mo' => 1, 'Tu' => 2, 'We' => 3, 'Th' => 4, 'Fr' => 5, 'Sa' => 6, 'Su' => 7];

    /** @param array<int, list<array{int,int}>> $week ISO weekday => [[openMin, closeMin], …] */
    private function __construct(private array $week)
    {
    }

    public static function parse(?string $text): ?self
    {
        $text = trim((string) $text);
        if ($text === '') {
            return null;
        }
        if ($text === '24/7') {
            return new self(array_fill(1, 7, [[0, 1440]]));
        }

        $week = [];
        $understood = false;
        foreach (preg_split('/\s*;\s*|\s*\|\|\s*/', $text) ?: [] as $rule) {
            $rule = trim($rule);
            if ($rule === '') {
                continue;
            }
            // Optional day selector, then times / off.
            if (!preg_match('/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)(?:\s*,\s*(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)?\s*(.*)$/', $rule, $m)) {
                continue;
            }
            $daySel = trim($m[1] ?? '');
            $rest = trim($m[2]);

            $days = $daySel === '' ? [1, 2, 3, 4, 5, 6, 7] : self::days($daySel);
            if (!$days) {
                continue; // e.g. "PH off" only
            }

            if (preg_match('/^(off|closed)$/i', $rest)) {
                $spans = [];
            } elseif (preg_match('/^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}(\s*,\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})*$/', $rest)) {
                $spans = [];
                foreach (explode(',', $rest) as $range) {
                    [$a, $b] = array_map('trim', explode('-', $range));
                    $open = self::minutes($a);
                    $close = self::minutes($b);
                    if ($close <= $open) {
                        $close += 1440; // past midnight
                    }
                    $spans[] = [$open, $close];
                }
            } else {
                continue; // month/week/date selectors, comments… not supported
            }

            foreach ($days as $d) {
                $week[$d] = $spans;
            }
            $understood = true;
        }

        return $understood ? new self($week) : null;
    }

    /**
     * Opening periods that touch $date (Y-m-d, in $tz), including yesterday's
     * after-midnight tail, as [['type' => 'OPERATING', 'start' => ISO, 'end' => ISO]].
     */
    public function segments(string $date, \DateTimeZone $tz): array
    {
        $day = new \DateTimeImmutable($date . ' 00:00', $tz);
        $out = [];
        foreach ([$day->modify('-1 day'), $day] as $base) {
            $dow = (int) $base->format('N');
            foreach ($this->week[$dow] ?? [] as [$open, $close]) {
                $start = $base->modify("+$open minutes");
                $end = $base->modify("+$close minutes");
                if ($end <= $day) {
                    continue; // yesterday's span that ended before today
                }
                $out[] = ['type' => 'OPERATING', 'start' => $start->format(DATE_ATOM), 'end' => $end->format(DATE_ATOM)];
            }
        }
        return $out;
    }

    /** @return int[] */
    private static function days(string $sel): array
    {
        $out = [];
        foreach (preg_split('/\s*,\s*/', $sel) ?: [] as $part) {
            if ($part === 'PH' || $part === 'SH') {
                continue; // public/school holidays: ignored
            }
            $ends = explode('-', $part);
            $a = self::DAYS[$ends[0]] ?? null;
            $b = self::DAYS[$ends[1] ?? $ends[0]] ?? null;
            if ($a === null || $b === null) {
                continue;
            }
            for ($i = 0, $d = $a; $i < 7; $i++, $d = $d % 7 + 1) {
                $out[$d] = $d;
                if ($d === $b) {
                    break;
                }
            }
        }
        return array_values($out);
    }

    private static function minutes(string $hhmm): int
    {
        [$h, $m] = array_map('intval', explode(':', $hhmm));
        return $h * 60 + $m;
    }
}
