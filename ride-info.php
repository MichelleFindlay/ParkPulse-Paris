<?php

declare(strict_types=1);

/*
 * Static ride facts used by the rain plan, the day planner and ride cards.
 * Matched to live ride names loosely (like opening-hours.php). Edit over FTP.
 *
 *   where   'indoor' (queue + ride under cover), 'covered' (roofed but open-sided),
 *           'outdoor'
 *   height  minimum height in cm, or null
 *   thrill  1 gentle · 2 moderate · 3 intense
 *   mins    typical ride duration in minutes (used by the planner)
 *
 * Optional, used only by Trip Wrapped (approximate, from general knowledge — correct freely):
 *   drop        biggest drop in metres      speed  top speed in km/h
 *   inversions  times upside down           wet    on water: boats (the resort has no flume or rapids)
 *   dark        an indoor dark ride
 *
 * Heights: 2026 lists from thebettervacation.com, ropedropplanner.com and dlptips.com
 * (checked 2 Nov 2026). Indoor/outdoor is from general knowledge — double-check
 * anything you plan around.
 */
return [
    // ------------------------------------------------------- Disneyland Park
    ['match' => 'Big Thunder Mountain', 'where' => 'outdoor', 'height' => 102, 'thrill' => 3, 'mins' => 4, 'drop' => 20, 'speed' => 56],
    ['match' => 'Indiana Jones', 'where' => 'outdoor', 'height' => 140, 'thrill' => 3, 'mins' => 2, 'drop' => 18, 'speed' => 58, 'inversions' => 1],
    ['match' => 'Star Wars Hyperspace Mountain', 'where' => 'indoor', 'height' => 120, 'thrill' => 3, 'mins' => 3, 'drop' => 24, 'speed' => 76, 'inversions' => 3, 'dark' => true],
    ['match' => 'Star Tours', 'where' => 'indoor', 'height' => 102, 'thrill' => 2, 'mins' => 5],
    ['match' => 'Autopia', 'where' => 'outdoor', 'height' => 81, 'thrill' => 1, 'mins' => 5],
    ['match' => 'Pirates of the Caribbean', 'where' => 'indoor', 'height' => null, 'thrill' => 1, 'mins' => 10, 'drop' => 3, 'speed' => 10, 'wet' => true, 'dark' => true],
    ['match' => 'Phantom Manor', 'where' => 'indoor', 'height' => null, 'thrill' => 1, 'mins' => 7, 'dark' => true],
    ['match' => "it's a small world", 'where' => 'indoor', 'height' => null, 'thrill' => 1, 'mins' => 10, 'wet' => true, 'dark' => true],
    ['match' => "Peter Pan's Flight", 'where' => 'indoor', 'height' => null, 'thrill' => 1, 'mins' => 3, 'dark' => true],
    ['match' => 'Buzz Lightyear Laser Blast', 'where' => 'indoor', 'height' => null, 'thrill' => 1, 'mins' => 5, 'dark' => true],
    ['match' => 'Les Mystères du Nautilus', 'where' => 'indoor', 'height' => null, 'thrill' => 1, 'mins' => 8],
    ['match' => "Mickey's PhilharMagic", 'where' => 'indoor', 'height' => null, 'thrill' => 1, 'mins' => 12],
    ['match' => 'Blanche-Neige et les Sept Nains', 'where' => 'indoor', 'height' => null, 'thrill' => 1, 'mins' => 3, 'dark' => true],
    ['match' => 'Les Voyages de Pinocchio', 'where' => 'indoor', 'height' => null, 'thrill' => 1, 'mins' => 3, 'dark' => true],
    ['match' => 'La Tanière du Dragon', 'where' => 'indoor', 'height' => null, 'thrill' => 1, 'mins' => 3],
    ['match' => 'La Galerie de la Belle au Bois Dormant', 'where' => 'indoor', 'height' => null, 'thrill' => 1, 'mins' => 5],
    ['match' => "Le Passage Enchanté d'Aladdin", 'where' => 'indoor', 'height' => null, 'thrill' => 1, 'mins' => 5],
    ['match' => 'Dumbo the Flying Elephant', 'where' => 'outdoor', 'height' => null, 'thrill' => 1, 'mins' => 2],
    ['match' => 'Orbitron', 'where' => 'outdoor', 'height' => null, 'thrill' => 1, 'mins' => 2],
    ['match' => "Mad Hatter's Tea Cups", 'where' => 'covered', 'height' => null, 'thrill' => 1, 'mins' => 2],
    ['match' => 'Le Carrousel de Lancelot', 'where' => 'covered', 'height' => null, 'thrill' => 1, 'mins' => 3],
    ['match' => 'Casey Jr.', 'where' => 'outdoor', 'height' => null, 'thrill' => 1, 'mins' => 3, 'speed' => 25],
    ['match' => 'Le Pays des Contes de Fées', 'where' => 'outdoor', 'height' => null, 'thrill' => 1, 'mins' => 7, 'wet' => true],
    ['match' => "Alice's Curious Labyrinth", 'where' => 'outdoor', 'height' => null, 'thrill' => 1, 'mins' => 15],
    ['match' => 'Thunder Mesa Riverboat', 'where' => 'outdoor', 'height' => null, 'thrill' => 1, 'mins' => 15, 'wet' => true],
    ['match' => 'Disneyland Railroad', 'where' => 'outdoor', 'height' => null, 'thrill' => 1, 'mins' => 20],
    ['match' => 'Adventure Isle', 'where' => 'outdoor', 'height' => null, 'thrill' => 1, 'mins' => 20],
    ['match' => 'La Cabane des Robinson', 'where' => 'outdoor', 'height' => null, 'thrill' => 1, 'mins' => 10],
    ['match' => "Pirates' Beach", 'where' => 'outdoor', 'height' => null, 'thrill' => 1, 'mins' => 15],
    ['match' => 'Rustler Roundup', 'where' => 'covered', 'height' => null, 'thrill' => 1, 'mins' => 5],

    // ---------------------------------------- Disney Adventure World (Studios)
    ['match' => 'Avengers Assemble', 'where' => 'indoor', 'height' => 120, 'thrill' => 3, 'mins' => 2, 'drop' => 24, 'speed' => 92, 'inversions' => 3, 'dark' => true],
    ['match' => 'Spider-Man W.E.B. Adventure', 'where' => 'indoor', 'height' => null, 'thrill' => 1, 'mins' => 5, 'dark' => true],
    ['match' => "Crush's Coaster", 'where' => 'indoor', 'height' => 107, 'thrill' => 3, 'mins' => 3, 'drop' => 11, 'speed' => 60, 'dark' => true],
    ['match' => 'The Twilight Zone Tower of Terror', 'where' => 'indoor', 'height' => 102, 'thrill' => 3, 'mins' => 4, 'drop' => 40, 'speed' => 60],
    ['match' => 'RC Racer', 'where' => 'outdoor', 'height' => 120, 'thrill' => 3, 'mins' => 1, 'drop' => 25, 'speed' => 70],
    ['match' => 'Toy Soldiers Parachute Drop', 'where' => 'outdoor', 'height' => 81, 'thrill' => 2, 'mins' => 2, 'drop' => 25, 'speed' => 40],
    ['match' => 'Slinky Dog Zigzag Spin', 'where' => 'outdoor', 'height' => null, 'thrill' => 1, 'mins' => 2],
    ['match' => 'Ratatouille', 'where' => 'indoor', 'height' => null, 'thrill' => 2, 'mins' => 5, 'speed' => 15, 'dark' => true],
    ['match' => 'Frozen Ever After', 'where' => 'indoor', 'height' => null, 'thrill' => 2, 'mins' => 6, 'drop' => 5, 'speed' => 15, 'wet' => true, 'dark' => true],
    ['match' => 'Raiponce Tangled Spin', 'where' => 'outdoor', 'height' => null, 'thrill' => 1, 'mins' => 2],
    ['match' => 'Les Tapis Volants', 'where' => 'outdoor', 'height' => null, 'thrill' => 1, 'mins' => 2],
    ['match' => 'Cars ROAD TRIP', 'where' => 'outdoor', 'height' => null, 'thrill' => 1, 'mins' => 10],
    ['match' => 'Cars Quatre Roues Rallye', 'where' => 'outdoor', 'height' => null, 'thrill' => 1, 'mins' => 2],
];
