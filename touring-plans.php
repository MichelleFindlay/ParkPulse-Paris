<?php

declare(strict_types=1);

/*
 * Ready-made touring plans and rope-drop strategies for Disneyland Paris.
 *
 * A touring plan here is a *starting selection*: the rides (matched loosely by name)
 * and shows a group type usually wants, in priority order, plus tips. "Plan my day"
 * then orders them with live/predicted waits, walking distance, show times and your
 * bookings — so the same template adapts to each day.
 *
 * Written 2 Nov 2026 from Park Pulse's ride facts (heights from 2026 lists) and
 * rope-drop/EMT guidance from dlptips.com, dlpguide.com and ropedropplanner.com.
 * Suggestions, not official advice — edit freely.
 */
return [
    'groups' => [
        'small-kids' => ['label' => 'Small kids', 'icon' => '🧸', 'about' => 'Under ~1 m: dark rides, gentle spinners, character time, an early-evening parade. Build in a midday break.'],
        'older-kids' => ['label' => 'Older kids', 'icon' => '🎢', 'about' => '1.20 m+: the coasters first, then the classics.'],
        'adults'     => ['label' => 'Adults', 'icon' => '🥂', 'about' => 'Headliners at rope drop, dark rides mid-day, a sit-down meal and the night show.'],
        'seniors'    => ['label' => 'Seniors', 'icon' => '🌿', 'about' => 'Low-intensity, seated rides and shows with short walks; avoid the afternoon peak.'],
        'mixed'      => ['label' => 'Mixed group', 'icon' => '👨‍👩‍👧‍👦', 'about' => 'Something for everyone; use Rider Switch on coasters so adults with little ones don’t queue twice.'],
    ],

    'plans' => [
        'dlp' => [
            'small-kids' => [
                'rides' => ["Peter Pan's Flight", 'Dumbo the Flying Elephant', 'Les Voyages de Pinocchio', 'Le Carrousel de Lancelot', "Mad Hatter's Tea Cups",
                    "it's a small world", 'Casey Jr.', 'Le Pays des Contes de Fées', 'Pirates of the Caribbean', 'Buzz Lightyear Laser Blast',
                    'Autopia', 'Orbitron', 'Thunder Mesa Riverboat', 'Disneyland Railroad', "Alice's Curious Labyrinth", "Pirates' Beach"],
                'shows' => ['Disney Stars on Parade', 'Meet Mickey Mouse', 'Princess Pavilion'],
                'tips'  => ['Peter Pan’s Flight first — its queue grows fastest all day.', 'Autopia needs 81 cm (1.32 m to drive alone).', 'Parade spots on Main Street fill ~30 min before.'],
            ],
            'older-kids' => [
                'rides' => ['Star Wars Hyperspace Mountain', 'Big Thunder Mountain', 'Indiana Jones', 'Star Tours', "Peter Pan's Flight", 'Buzz Lightyear Laser Blast',
                    'Pirates of the Caribbean', 'Phantom Manor', 'Autopia', 'Orbitron', 'Adventure Isle', 'Les Mystères du Nautilus', "it's a small world"],
                'shows' => ['Disney Tales of Magic', 'Disney Stars on Parade'],
                'tips'  => ['Indiana Jones needs 1.40 m, Hyperspace Mountain 1.20 m, Big Thunder & Star Tours 1.02 m.', 'Single rider lines on Hyperspace and Indy save lots of time if the group can split.'],
            ],
            'adults' => [
                'rides' => ['Big Thunder Mountain', 'Star Wars Hyperspace Mountain', "Peter Pan's Flight", 'Phantom Manor', 'Pirates of the Caribbean', 'Indiana Jones',
                    'Star Tours', 'Buzz Lightyear Laser Blast', "it's a small world", "Mickey's PhilharMagic", 'Les Mystères du Nautilus', 'Thunder Mesa Riverboat'],
                'shows' => ['Disney Tales of Magic'],
                'tips'  => ['Phantom Manor and Pirates are best mid-afternoon (long, indoor, high capacity).', 'The night show draws a crowd on Main Street — watch from the side of the castle hub.'],
            ],
            'seniors' => [
                'rides' => ['Pirates of the Caribbean', 'Phantom Manor', "it's a small world", "Peter Pan's Flight", 'Disneyland Railroad', 'Thunder Mesa Riverboat',
                    "Mickey's PhilharMagic", 'Les Mystères du Nautilus', 'Buzz Lightyear Laser Blast', 'La Galerie de la Belle au Bois Dormant', "Le Passage Enchanté d'Aladdin"],
                'shows' => ['Disney Stars on Parade', 'Disney Tales of Magic'],
                'tips'  => ['The Railroad doubles as transport between lands.', 'Wheelchairs and scooters can be rented at the entrance.'],
            ],
            'mixed' => [
                'rides' => ["Peter Pan's Flight", 'Big Thunder Mountain', 'Star Wars Hyperspace Mountain', 'Buzz Lightyear Laser Blast', 'Pirates of the Caribbean',
                    'Phantom Manor', "it's a small world", 'Dumbo the Flying Elephant', 'Star Tours', 'Autopia', "Mickey's PhilharMagic", 'Thunder Mesa Riverboat'],
                'shows' => ['Disney Stars on Parade', 'Disney Tales of Magic'],
                'tips'  => ['Ask for Rider Switch at Big Thunder, Hyperspace, Star Tours and Indy.', 'Split up: thrill-seekers do Hyperspace while little ones do Buzz next door.'],
            ],
        ],
        'studios' => [
            'small-kids' => [
                'rides' => ['Frozen Ever After', 'Ratatouille', 'Slinky Dog Zigzag Spin', 'Les Tapis Volants', 'Cars Quatre Roues Rallye', 'Toy Soldiers Parachute Drop',
                    'Cars ROAD TRIP', 'Raiponce Tangled Spin', 'Spider-Man W.E.B. Adventure'],
                'shows' => ['Mickey and the Magician', 'TOGETHER: a Pixar Musical Adventure', 'Animation Academy', 'Meet Mickey'],
                'tips'  => ['Frozen Ever After the moment you’re in — its queue spikes even during EMT.', 'Toy Soldiers needs 81 cm.'],
            ],
            'older-kids' => [
                'rides' => ['Frozen Ever After', 'Avengers Assemble', "Crush's Coaster", 'The Twilight Zone Tower of Terror', 'RC Racer', 'Spider-Man W.E.B. Adventure',
                    'Ratatouille', 'Toy Soldiers Parachute Drop', 'Raiponce Tangled Spin'],
                'shows' => ['Mickey and the Magician'],
                'tips'  => ["Crush's Coaster is closed until July 2027 (refurbishment) — the planner skips it automatically.", 'Avengers & RC Racer need 1.20 m, Tower 1.02 m.'],
            ],
            'adults' => [
                'rides' => ["Crush's Coaster", 'Frozen Ever After', 'Avengers Assemble', 'The Twilight Zone Tower of Terror', 'Ratatouille', 'Spider-Man W.E.B. Adventure',
                    'RC Racer', 'Raiponce Tangled Spin'],
                'shows' => ['Mickey and the Magician', 'Disney Cascade of Lights'],
                'tips'  => ['Single rider on Avengers, Ratatouille and Frozen saves the most time.'],
            ],
            'seniors' => [
                'rides' => ['Ratatouille', 'Frozen Ever After', 'Spider-Man W.E.B. Adventure', 'Cars ROAD TRIP', 'Les Tapis Volants', 'Raiponce Tangled Spin'],
                'shows' => ['Mickey and the Magician', 'TOGETHER: a Pixar Musical Adventure', 'Animation Academy', 'Disney Cascade of Lights'],
                'tips'  => ['Shows here are seated and indoors — great for a rest.'],
            ],
            'mixed' => [
                'rides' => ['Frozen Ever After', "Crush's Coaster", 'Ratatouille', 'Avengers Assemble', 'The Twilight Zone Tower of Terror', 'Spider-Man W.E.B. Adventure',
                    'Toy Soldiers Parachute Drop', 'Slinky Dog Zigzag Spin', 'Cars ROAD TRIP'],
                'shows' => ['Mickey and the Magician', 'Disney Cascade of Lights'],
                'tips'  => ['Rider Switch at Avengers, Tower of Terror and RC Racer.'],
            ],
        ],
    ],

    // Rope drop: what to do in the first hour. EMT = Extra Magic Time (Disney hotel
    // guests & some annual passes, usually 1 h before opening).
    'ropeDrop' => [
        'dlp' => [
            'emt'    => ['Phantom Manor', 'Thunder Mesa Riverboat', 'Big Thunder Mountain', "Peter Pan's Flight", 'Dumbo the Flying Elephant', 'Les Voyages de Pinocchio',
                'Le Carrousel de Lancelot', "Mad Hatter's Tea Cups", 'Buzz Lightyear Laser Blast', 'Star Wars Hyperspace Mountain', 'Orbitron', 'Star Tours'],
            'first'  => ["Peter Pan's Flight", 'Star Wars Hyperspace Mountain', 'Big Thunder Mountain', 'Buzz Lightyear Laser Blast'],
            'tips'   => [
                'Be at security by 8:00–8:15 for EMT (or ~30 min before general opening).',
                'EMT guests enter Fantasyland/Discoveryland via the roped-off paths at Central Plaza.',
                'Peter Pan’s Flight builds the fastest standby line in the park — do it first or late evening.',
                'Hyperspace Mountain is often under 5 min in the first half hour of EMT.',
                'After the first hour, Pirates/Frontierland stay quieter until late morning.',
            ],
        ],
        'studios' => [
            'emt'    => ['Cars Quatre Roues Rallye', 'Les Tapis Volants', 'Ratatouille', 'Toy Soldiers Parachute Drop'],
            'first'  => ['Frozen Ever After', 'Avengers Assemble', 'Ratatouille', 'The Twilight Zone Tower of Terror'],
            'tips'   => [
                'Frozen Ever After is the #1 priority — check the app whether it runs during EMT that day.',
                "Crush's Coaster is closed for a major refurbishment from 7 Sep 2026 until about 2 Jul 2027.",
                'Pick one park for rope drop and stick to it; walking between parks first thing wastes the quiet window.',
            ],
        ],
        'sources' => [
            ['DLP Tips — Extra Magic Time 2026', 'https://dlptips.com/planning-tips/extra-magic-hours/'],
            ['DLP Guide — Extra Magic Time', 'https://dlpguide.com/planning/services/extra-magic-time/'],
            ['Rope Drop Planner — DLP', 'https://ropedropplanner.com/dlp/rope-drop'],
        ],
    ],
];
