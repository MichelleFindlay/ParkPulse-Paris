<?php

declare(strict_types=1);

/*
 * Disney Village (and anything else outside the two parks).
 *
 * Neither ThemeParks.wiki nor Queue-Times covers Disney Village. The app merges this
 * hand-written list with OpenStreetMap: OSM supplies locations, opening hours and
 * venues missing here (plus the Disney hotels' restaurants and bars). Use this file
 * for descriptions and booking tips, and set 'hours' only to OVERRIDE what OSM says
 * (daily, park-local time). Without any hours the app never claims a place is open.
 *
 * Fields:
 *   id       unique, letters/digits/dashes, must start with "village-" (used for ★)
 *   name     display name
 *   section  heading it's grouped under
 *   kind     short label (Table service, Quick service, Bar, Show, Shop…)
 *   about    one line
 *   book     true if booking ahead is recommended
 *   hours    null, or ['open' => 'HH:MM', 'close' => 'HH:MM'] (close may pass midnight)
 *
 * Compiled from general knowledge in 2026 — check the official Disneyland Paris app
 * before the trip. Updated 2 Nov 2026 from web research: King Ludwig's Castle (now
 * The Royal Pub) removed, Café Mickey is now Rosalie, the Disney Store is now Disney
 * Wonders, Casa Giulia replaces Planet Hollywood. Hours live in opening-hours.php.
 */
return [
    // ------------------------------------------------------------ dining
    ['id' => 'village-annettes-diner', 'name' => "Annette's Diner", 'section' => 'Restaurants',
     'kind' => 'Table service', 'about' => '1950s American diner — closed for renovation until early 2027.',
     'book' => true, 'hours' => null],
    ['id' => 'village-the-steakhouse', 'name' => 'The Steakhouse', 'section' => 'Restaurants',
     'kind' => 'Table service', 'about' => 'Grill house — steaks and classic brasserie dishes.',
     'book' => true, 'hours' => null],
    ['id' => 'village-rosalie', 'name' => 'Rosalie (brasserie)', 'section' => 'Restaurants',
     'kind' => 'Brasserie', 'about' => 'Parisian brasserie (ex-Café Mickey): breakfast, lunch, dinner; takeaway counter.',
     'book' => true, 'hours' => null],
    ['id' => 'village-casa-giulia', 'name' => 'Casa Giulia', 'section' => 'Restaurants',
     'kind' => 'Italian', 'about' => 'New Italian restaurant on the old Planet Hollywood site — opening "by the end of 2026", may not be open yet.',
     'book' => true, 'hours' => null],
    ['id' => 'village-rainforest-cafe', 'name' => 'Rainforest Cafe', 'section' => 'Restaurants',
     'kind' => 'Table service', 'about' => 'American menu amid jungle theming — closing for good in late 2026.',
     'book' => true, 'hours' => null],
    ['id' => 'village-buffalo-bills', 'name' => "Buffalo Bill's Wild West Show… with Mickey & Friends!", 'section' => 'Restaurants',
     'kind' => 'Dinner show', 'about' => 'Wild West arena dinner show — on hold since late 2020.',
     'book' => false, 'hours' => null],
    ['id' => 'village-vapiano', 'name' => 'Vapiano', 'section' => 'Quick bites',
     'kind' => 'Counter service', 'about' => 'Fresh pasta, pizza and salads cooked to order.',
     'book' => false, 'hours' => null],
    ['id' => 'village-five-guys', 'name' => 'Five Guys', 'section' => 'Quick bites',
     'kind' => 'Quick service', 'about' => 'Burgers, fries and shakes.',
     'book' => false, 'hours' => null],
    ['id' => 'village-earl-of-sandwich', 'name' => 'Earl of Sandwich', 'section' => 'Quick bites',
     'kind' => 'Quick service', 'about' => 'Hot sandwiches, salads and breakfast.',
     'book' => false, 'hours' => null],
    ['id' => 'village-mcdonalds', 'name' => "McDonald's", 'section' => 'Quick bites',
     'kind' => 'Quick service', 'about' => 'The usual — often the latest-open option.',
     'book' => false, 'hours' => null],
    ['id' => 'village-starbucks', 'name' => 'Starbucks', 'section' => 'Quick bites',
     'kind' => 'Coffee', 'about' => 'Coffee and pastries.',
     'book' => false, 'hours' => null],

    // -------------------------------------------------------------- bars
    ['id' => 'village-billy-bobs', 'name' => "Billy Bob's Country Western Saloon", 'section' => 'Bars',
     'kind' => 'Bar', 'about' => 'Western saloon with drinks, snacks and live country music.',
     'book' => false, 'hours' => null],
    ['id' => 'village-royal-pub', 'name' => 'The Royal Pub', 'section' => 'Bars',
     'kind' => 'Pub', 'about' => 'British-style pub with food (replaced King Ludwig’s Castle in 2023).',
     'book' => false, 'hours' => null],
    ['id' => 'village-sports-bar', 'name' => 'Sports Bar', 'section' => 'Bars',
     'kind' => 'Bar', 'about' => 'Beers and live sport on big screens.',
     'book' => false, 'hours' => null],

    // ---------------------------------------------------- entertainment
    ['id' => 'village-gaumont', 'name' => 'Gaumont Disney Village cinema', 'section' => 'Entertainment',
     'kind' => 'Cinema', 'about' => '15 screens incl. IMAX and 4DX; some films in English (VO). Becoming Pathé in 2027.',
     'book' => false, 'hours' => null],

    // ------------------------------------------------------------- shops
    ['id' => 'village-world-of-disney', 'name' => 'World of Disney', 'section' => 'Shops',
     'kind' => 'Shop', 'about' => 'The biggest Disney shop on the resort.',
     'book' => false, 'hours' => null],
    ['id' => 'village-disney-wonders', 'name' => 'Disney Wonders', 'section' => 'Shops',
     'kind' => 'Shop', 'about' => 'Big themed Disney/Pixar/Marvel/Star Wars store, opened 22 Sep 2026 (ex-Disney Store).',
     'book' => false, 'hours' => null],
    ['id' => 'village-lego-store', 'name' => 'The LEGO Store', 'section' => 'Shops',
     'kind' => 'Shop', 'about' => 'LEGO sets and pick-a-brick wall.',
     'book' => false, 'hours' => null],
    ['id' => 'village-pele-soccer', 'name' => 'Pelé Soccer', 'section' => 'Shops',
     'kind' => 'Shop', 'about' => 'Football shop, opened May 2026.',
     'book' => false, 'hours' => null],

    // --------------------------------------- Disneyland Hotel (not on OSM)
    ['id' => 'village-royal-banquet', 'name' => 'Royal Banquet', 'section' => '🏨 Disneyland Hotel',
     'kind' => 'Character buffet', 'about' => 'Buffet with Disney characters.',
     'book' => true, 'hours' => null],
    ['id' => 'village-table-de-lumiere', 'name' => 'La Table de Lumière', 'section' => '🏨 Disneyland Hotel',
     'kind' => 'Fine dining', 'about' => 'Beauty and the Beast–themed table-service restaurant.',
     'book' => true, 'hours' => null],
];
