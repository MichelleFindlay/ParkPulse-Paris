<?php

declare(strict_types=1);

/*
 * Inputs for the crowd calendar. The prediction is a simple, transparent model:
 *   weekday base + month baseline + school holidays + public holidays + events
 *   + park-hours signal (Disney opens longer when it expects crowds)
 * and, for days already visited, the level measured from Park Pulse's own
 * wait history is shown next to it. Edit freely; every date is inclusive.
 *
 * Sources (checked 2 Nov 2026): French calendar — onisep.fr / letudiant.fr;
 * Belgium — schoolvakanties.nl, belgieschoolvakanties.be; Netherlands — Rijksoverheid
 * advisory dates; Halloween — disneylandparis.com; Christmas — sortiraparis.com,
 * disneytouristblog.com. UK half-term is the common English date (varies by council).
 */
return [
    // weekday (ISO 1=Mon … 7=Sun) base demand
    'weekday' => [1 => 1.5, 2 => 1.0, 3 => 1.5, 4 => 1.0, 5 => 1.75, 6 => 3.0, 7 => 2.25],

    // month baseline (1–12)
    'month' => [1 => 0.5, 2 => 1.5, 3 => 1.0, 4 => 2.0, 5 => 2.0, 6 => 1.5, 7 => 2.5, 8 => 3.0, 9 => 0.75, 10 => 1.5, 11 => 0.5, 12 => 2.0],

    // [from, to, weight, label]
    'holidays' => [
        ['2026-10-17', '2026-11-01', 2.5, 'French school holidays (Toussaint, all zones)'],
        ['2026-12-19', '2027-01-03', 3.0, 'French school holidays (Christmas, all zones)'],
        ['2027-02-06', '2027-02-21', 1.5, 'French winter holidays — zone C (Paris region)'],
        ['2027-02-13', '2027-02-28', 1.0, 'French winter holidays — zone A'],
        ['2027-02-20', '2027-03-07', 1.0, 'French winter holidays — zone B'],
        ['2026-10-19', '2026-11-01', 0.75, 'Belgian holidays (Wallonia & Brussels FR schools)'],
        ['2026-11-02', '2026-11-08', 0.75, 'Belgian holidays (Flanders)'],
        ['2026-10-10', '2026-10-18', 0.5, 'Dutch autumn holidays (north)'],
        ['2026-10-17', '2026-10-25', 0.5, 'Dutch autumn holidays (middle & south)'],
        ['2026-10-24', '2026-11-01', 0.75, 'UK half-term (most English councils)'],
    ],

    // [date, weight, label] — public holidays (France, plus Belgium where shared)
    'public' => [
        ['2026-11-01', 2.0, 'All Saints’ Day (FR/BE)'],
        ['2026-11-11', 2.0, 'Armistice Day (FR/BE)'],
        ['2026-12-25', 1.0, 'Christmas Day'],
        ['2027-01-01', 1.0, 'New Year’s Day'],
    ],

    // [from, to, weight, label] — seasons and special nights
    'events' => [
        ['2026-09-26', '2026-11-01', 0.5, 'Disney Halloween Festival'],
        ['2026-10-31', '2026-10-31', 1.5, 'Halloween night (extended hours)'],
        ['2026-11-07', '2027-01-06', 0.75, 'Disney Enchanted Christmas'],
        ['2026-11-07', '2026-11-08', 0.5, 'Christmas season opening weekend'],
        ['2026-12-31', '2026-12-31', 2.0, 'New Year’s Eve'],
    ],
];
