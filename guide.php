<?php

declare(strict_types=1);

/*
 * Park Pulse guide content (hotels, dining, park info, access, transport, events).
 * Researched 2 Nov 2026 — see 'sources'. Written in our own words; facts change, so
 * each section says where it came from. Edit freely over FTP.
 */
return [
    'checked' => '2026-11-02',

    // ---------------------------------------------------------------- hotels
    'hotels' => [
        ['id' => 'disneyland-hotel', 'name' => 'Disneyland Hotel', 'stars' => 5, 'price' => 5, 'theme' => 'Royal fairy-tale palace at the park gates',
         'walk' => 2, 'transport' => 'At the Disneyland Park entrance', 'pool' => 'Indoor Crystal Pool, kids’ pool, hot tub', 'mealPlan' => 'Premium',
         'goodFor' => ['luxury', 'little-kids', 'characters'], 'emt' => true, 'car' => false,
         'notes' => 'Character dining (Royal Banquet) and fine dining (La Table de Lumière) inside.'],
        ['id' => 'hotel-new-york', 'name' => 'Disney Hotel New York – The Art of Marvel', 'stars' => 4, 'price' => 4, 'theme' => 'Marvel art gallery, Manhattan style',
         'walk' => 10, 'transport' => '≈10 min walk; free shuttle', 'pool' => 'Metro Pool (indoor/outdoor) + kids’ pool', 'mealPlan' => 'Plus',
         'goodFor' => ['marvel', 'adults', 'older-kids'], 'emt' => true, 'car' => false,
         'notes' => 'Closest 4★ to Disney Village; Downtown and Manhattan restaurants, Skyline Bar.'],
        ['id' => 'newport-bay', 'name' => 'Disney Newport Bay Club', 'stars' => 4, 'price' => 3, 'theme' => 'New England seaside yacht club',
         'walk' => 15, 'transport' => '10–15 min walk around the lake; free shuttle', 'pool' => 'Large indoor pool + seasonal outdoor pool', 'mealPlan' => 'Plus',
         'goodFor' => ['families', 'pool'], 'emt' => true, 'car' => false,
         'notes' => 'Big, calm and good value for a 4★. Cape Cod buffet, Yacht Club, Captain’s Quarters bar.'],
        ['id' => 'sequoia-lodge', 'name' => 'Disney Sequoia Lodge', 'stars' => 3, 'price' => 2, 'theme' => 'National-park mountain lodge',
         'walk' => 15, 'transport' => '≈15 min walk; free shuttle', 'pool' => 'Indoor pool with slide', 'mealPlan' => 'Plus',
         'goodFor' => ['families', 'pool', 'value'], 'emt' => true, 'car' => false,
         'notes' => 'Cheapest Disney hotel with a pool. Hotel & room refurbishment ongoing into 2027.'],
        ['id' => 'cheyenne', 'name' => 'Disney Hotel Cheyenne', 'stars' => 3, 'price' => 2, 'theme' => 'Wild West town with Toy Story (Woody) rooms',
         'walk' => 20, 'transport' => '15–20 min walk; free shuttle', 'pool' => null, 'mealPlan' => 'Plus',
         'goodFor' => ['little-kids', 'value', 'themed-rooms'], 'emt' => true, 'car' => false,
         'notes' => 'Kids love the Toy Story rooms; no pool. Chuck Wagon Café buffet, Red Garter Saloon.'],
        ['id' => 'santa-fe', 'name' => 'Disney Hotel Santa Fe', 'stars' => 2, 'price' => 1, 'theme' => 'Route 66 with Cars theming',
         'walk' => 20, 'transport' => '≈20 min walk; free shuttle', 'pool' => null, 'mealPlan' => 'Standard',
         'goodFor' => ['budget', 'little-kids'], 'emt' => true, 'car' => false,
         'notes' => 'Cheapest on-site option. La Cantina buffet, Rio Grande Bar.'],
        ['id' => 'davy-crockett', 'name' => 'Disney Davy Crockett Ranch', 'stars' => 3, 'price' => 2, 'theme' => 'Cabins in the woods',
         'walk' => null, 'transport' => '≈15 min drive — a car is needed, no Disney shuttle', 'pool' => 'Blue Springs Pool (indoor, heated, waterfalls)', 'mealPlan' => 'Standard',
         'goodFor' => ['big-groups', 'car', 'self-catering', 'value'], 'emt' => true, 'car' => true,
         'notes' => 'Cabins for up to 6 with a kitchenette; parking at your cabin.'],
    ],
    'partners' => [
        ['name' => 'Hôtel l’Elysée Val d’Europe', 'stars' => 4, 'where' => 'Serris', 'shuttle' => 'Free · South bus station', 'notes' => 'RER A Val d’Europe stop ~50 m away.'],
        ['name' => 'Staycity Aparthotels Paris Marne-la-Vallée', 'stars' => 4, 'where' => 'Bailly-Romainvilliers', 'shuttle' => 'Free · North bus station', 'notes' => 'Apartments with kitchens — good for bigger groups.'],
        ['name' => 'Ki Space Hotel & Spa', 'stars' => 4, 'where' => 'Serris', 'shuttle' => 'Free · North bus station (15–20 min)', 'notes' => 'Newer partner (opened 2025), a bit further out.'],
        ['name' => 'Aparthotel Adagio Val d’Europe', 'stars' => 3, 'where' => 'Serris', 'shuttle' => 'Free · South bus station', 'notes' => 'Apartments with kitchens.'],
        ['name' => 'All Suites Appart Hotel Val d’Europe', 'stars' => 3, 'where' => 'Val d’Europe', 'shuttle' => 'Free shuttle', 'notes' => 'New partner in 2026.'],
        ['name' => 'Explorers Hotel', 'stars' => 3, 'where' => 'Magny-le-Hongre', 'shuttle' => 'Free · North bus station', 'notes' => 'Pirate-themed, family rooms, indoor water play.'],
        ['name' => 'Campanile Val de France', 'stars' => 3, 'where' => 'Magny-le-Hongre', 'shuttle' => 'Free · North bus station', 'notes' => 'Budget.'],
        ['name' => 'B&B Hotel Disneyland', 'stars' => 2, 'where' => 'Magny-le-Hongre', 'shuttle' => 'Free · North bus station', 'notes' => 'Budget.'],
        ['name' => 'Center Parcs Villages Nature Paris', 'stars' => null, 'where' => '15 min by car', 'shuttle' => 'No shuttle — car needed', 'notes' => 'Holiday cottages + Aqualagon water park.'],
    ],
    'partnersNote' => 'Dream Castle and Grand Magic hotels run their own shuttles, but recent guides disagree on whether they are still official partners — check disneylandparis.com before booking.',
    'benefits' => [
        'Extra Magic Time: selected rides 1 hour before general opening (usually 8:00 for a 9:00 opening).',
        'Theme-park tickets and your room key (MagicPass) in one, plus Disney Hotel Easy Pass at the park gates.',
        'Restaurant bookings as soon as your holiday is confirmed (non-hotel guests: 2 months ahead).',
        'Free shopping delivery from the parks to your hotel shop.',
        'Free shuttle buses to the parks (all hotels except Davy Crockett Ranch).',
        'Half-board / full-board meal plans are only sold with Disney hotel stays.',
        'Accessibility cards can be issued at hotel reception at check-in.',
    ],
    'emt' => [
        'Who: Disney hotel guests, Les Villages Nature guests and Disneyland Pass Gold holders.',
        'When: 1 hour before general opening, most days — check the times on the Crowd calendar.',
        'Disneyland Park: enter Fantasyland/Discoveryland via the roped paths at Central Plaza.',
        'Not every ride runs; the list changes with refurbishments — see Rope drop on the Trip tab.',
    ],
    'roomRequests' => [
        'high' => 'a high floor', 'low' => 'a low floor / near the lift', 'quiet' => 'a quiet room away from the lifts',
        'view' => 'a view of the lake or park if possible', 'connecting' => 'connecting or adjoining rooms', 'near' => 'rooms close to each other',
        'accessible' => 'an accessible room', 'cot' => 'a baby cot', 'twin' => 'two separate beds', 'celebration' => 'we are celebrating a special occasion',
    ],
    'hotelsUrl' => 'https://www.disneylandparis.com/en-gb/hotels/',

    // ---------------------------------------------------------------- dining
    'dining' => [
        'bookingUrl' => 'https://www.disneylandparis.com/en-gb/dining/advance-table-booking',
        'phone' => '+33 1 60 30 40 50',
        'rules' => [
            'Anyone can book up to 2 months ahead in the Disneyland Paris app or website; Disney hotel guests from the moment their holiday is booked.',
            'New dates appear to open at midnight Paris time.',
            'Cancelling is free for most restaurants; prepaid meals (e.g. character dining) are the exception.',
            'No luck online? Call the number below, ask at the restaurant on the day, or at your hotel’s reception.',
        ],
        // Table-service / buffet restaurants that normally take reservations (matched by name).
        'bookable' => [
            'Auberge de Cendrillon', "Walt's – an American restaurant", "Captain Jack's", 'Silver Spur Steakhouse', 'Agrabah Café Restaurant',
            'Bistrot Chez Rémy', 'The Regal View Restaurant', 'PYM Kitchen', 'Royal Banquet', 'La Table de Lumière', 'Downtown Restaurant',
            'Manhattan Restaurant', 'Cape Cod', 'Yacht Club', "Hunter's Grill", 'Chuck Wagon Café', 'La Cantina', 'The Steakhouse',
            'Rainforest Cafe', 'Rosalie', 'Casa Giulia',
        ],
        'plans' => [
            'You pay for meals before you travel; the plan covers everyone on the booking for every night of the stay.',
            'Half board = breakfast + one meal; full board = breakfast, lunch and dinner. Breakfast is at your own hotel.',
            'Your hotel sets the level: Standard (Santa Fe, Davy Crockett Ranch) · Plus (Cheyenne, Sequoia Lodge, Newport Bay Club, Hotel New York) · Premium (Disneyland Hotel).',
            'Extra Plus (full board, every hotel except the Disneyland Hotel) adds one character meal per stay plus selected snacks and drinks.',
            'No paper vouchers any more: meals are loaded on your MagicPass room key — show it and order the plan menu.',
            'Indicative 2025 prices per adult per night: Standard ≈ £51, Plus ≈ £60, Premium ≈ £116, Extra Plus ≈ £135 (children roughly half; under-3s free).',
            'From April 2027 the plans are replaced by new tiers: Essential, Extra, Signature and Royal.',
        ],
    ],

    // ---------------------------------------------------------------- park info
    'refurbs' => [
        ['Les Voyages de Pinocchio', '2026-11-02', '2026-11-13', 'Refurbishment (one source says until 14 Nov)'],
        ['Disneyland Railroad – Main Street Station', '2026-11-02', '2026-11-06', 'Station closed; the train still runs'],
        ['Disneyland Railroad – Frontierland Depot', '2026-10-12', '2026-11-20', 'Station closed'],
        ['Disneyland Railroad – Discoveryland Station', '2026-11-07', null, 'Station closed (end date TBA)'],
        ['Phantom Manor', '2026-11-16', '2026-11-27', 'Refurbishment'],
        ["Crush's Coaster", '2026-09-07', '2027-07-02', 'Major refurbishment (ride system and track)'],
        ['Pirate Galleon', null, null, 'Long-term closure, no reopening date'],
        ['Plaza Gardens Restaurant', '2026-04-01', null, 'Closed until 2027'],
        ['A Celebration in Arendelle (show)', '2026-11-07', '2027-04-02', 'Seasonal break'],
        ['Mickey and the Magician (theatre)', '2027-01-10', null, 'Theatre refurbishment — no show in 2027'],
        ['Disney Sequoia Lodge', null, null, 'Hotel & room refurbishment into 2027 (stays open)'],
        ['Main Street Horse-Drawn Streetcars', '2026-10-01', null, 'Closed permanently'],
    ],
    'riderSwitch' => [
        'For groups where a child is too small (or someone doesn’t want to ride): tell the Cast Member at the entrance.',
        'One adult queues and rides while the other waits with the child; then they swap without queuing again.',
        'Offered on rides with a height limit — e.g. Big Thunder Mountain, Hyperspace Mountain, Indiana Jones, Star Tours, Avengers, Tower of Terror, RC Racer.',
    ],
    'access' => [
        'Two free cards: the Priority Card (recognised disability) and the Easy Access Card (one of ~30 long-term conditions, with a return time — not a skip-the-line).',
        'Priority Card proof: e.g. a French CMI marked “invalidité” or “priorité”, a European disability/parking card, an MDPH/MDA decision. A CMI with only the parking mention isn’t enough.',
        'Priority Card covers the holder + up to 4 companions on rides, + 2 for shows/parades. Easy Access: up to 4 companions, rides only.',
        'Easy Access needs a medical certificate and ID; all companions must be present when the card is issued.',
        'Temporary injuries (e.g. a broken leg) don’t qualify.',
        'Disney hotel guests can get either card at reception on check-in; otherwise at City Hall (Disneyland Park) or Studio Services (Adventure World).',
        'Neither card gives immediate access to attractions, shows or character meets.',
    ],
    'accessUrl' => 'https://brochure.disneylandparis.com/DGAV/EN/common/data/catalogue.pdf',

    // ---------------------------------------------------------- skip the line
    'skip' => [
        'one' => [
            'Pay for one attraction and get a return window; you can use it once.',
            'Price changes by day and ride (≈ €5–23 in 2026) but stays the same all day — the price in the app at checkout is what you pay.',
            'Sold in the Disneyland Paris app (tickets linked). Popular rides can sell out, or return times drift to late afternoon.',
        ],
        'ultimate' => [
            'One day, one priority entry on every eligible ride (18 across both parks) — no time slots, scan once per ride whenever you like.',
            'You can’t pick rides: it’s the whole list once each, per person. Orbitron is One-only.',
            'Roughly €90–230 per person depending on the day; limited numbers, buy in the app or website (and on the day if not sold out).',
            'Worth it on very busy days if you’ll ride most headliners; on quiet days (like your trip dates) usually not.',
        ],
        'single' => [
            'Single rider lines fill empty seats — free, often much faster than standby.',
            'Your group rides separately (you may end up on the same train, but don’t count on it).',
            'Children must meet the height limit and be old enough to ride alone (check with the Cast Member).',
            'Not always faster: on low-capacity rides the single rider line can be nearly as long as standby.',
            'Offered on (sources vary; Park Pulse shows live which rides have one): Hyperspace Mountain, Indiana Jones, Ratatouille, RC Racer, Toy Soldiers, Spider-Man, Avengers (sometimes) — Crush’s Coaster is closed until July 2027.',
        ],
        'virtual' => [
            'Some experiences have no physical queue — you book a free time slot in the Disneyland Paris app and come back then.',
            'A Royal Encounter with Elsa and Anna (Arendelle Castle, World of Frozen) is virtual-queue only: app → Characters → A Royal Encounter → choose a slot. Your tickets must be linked.',
            'Slots go quickly — join as soon as you’re inside the park; more may be released later in the day. A Cast Member at the castle entrance can also help.',
            'The app notifies you when it’s time to return. Other popular character meets can switch to a virtual queue on busy days — check the app.',
        ],
        'sources' => [
            ['Sortiraparis — Premier Access prices', 'https://www.sortiraparis.com/en/what-to-visit-in-paris/walks/articles/351578-disney-premier-access-at-disneyland-paris-prices-and-how-the-skip-the-line-passes-work'],
            ['mickeyfromthe.uk — Premier Access guide', 'https://mickeyfromthe.uk/article/premier-access-at-disneyland-paris-guide'],
            ['julieears.com — Premier Access: worth it?', 'https://julieears.com/en/guides/disneyland-paris-premier-access/'],
            ['DLP Guide — single riders', 'https://www.dlpguide.com/planning/services/single-riders/'],
            ['dein-dlrp.de — single rider line', 'https://www.dein-dlrp.de/en/disneyland-paris-holiday/services/single-rider-line.html'],
            ['Disneyland Paris — A Royal Encounter with Elsa and Anna', 'https://www.disneylandparis.com/en-int/entertainment/disney-adventure-world/rencontre-royale'],
            ['dein-dlrp.de — Royal Encounter virtual queue', 'https://www.dein-dlrp.de/en/disneyland-resort-paris/disney-adventure-world/world-of-frozen/a-royal-encounter-with-elsa-and-anna.html'],
        ],
    ],

    // ---------------------------------------------------------------- transport
    'transport' => [
        ['icon' => '🚄', 'title' => 'From London (Eurostar)', 'lines' => [
            'There is no direct London ⇄ Disneyland Eurostar — it was withdrawn in June 2023 and hasn’t returned.',
            'Fastest: Eurostar to Lille Europe, then TGV to Marne-la-Vallée–Chessy (from ≈2 h 55). Book London St Pancras → “Disneyland Paris (Marne-la-Vallée–Chessy)” with 1 change so the connection is protected.',
            'Or Eurostar to Paris Gare du Nord, then RER (≈1 h more).',
            'Marne-la-Vallée–Chessy station is right opposite the park gates.',
        ]],
        ['icon' => '🚆', 'title' => 'From Paris (RER A)', 'lines' => [
            'RER A towards “Marne-la-Vallée–Chessy” (not Torcy/Boissy) — 35–45 min from central Paris, every 10–15 min.',
            'Since the 2026 fare reform one metro/RER/train ticket is €2.55 for any distance, Disneyland included (airports excepted).',
            'Live RER A departures/disruptions: Trip tab (when a PRIM key is set).',
        ]],
        ['icon' => '🚌', 'title' => 'From the airports (Magical Shuttle)', 'lines' => [
            'Coaches from Paris-CDG and Orly to the Disney hotels: about 1 h.',
            '€24 adult, €11 child (under 12), under-3s free, per trip; luggage included.',
            'No cash on board since 19 Oct 2026 — pay by card, online, or cash at a Paris Region info centre first.',
        ]],
        ['icon' => '🚐', 'title' => 'Around the resort', 'lines' => [
            'Free Disney shuttles from every Disney hotel except Davy Crockett Ranch (≈10 min).',
            'Partner hotels use the North or South bus station.',
        ]],
    ],

    // ---------------------------------------------------------------- events
    'events' => [
        ['Disney Halloween Festival', '2026-09-26', '2026-11-01', 'Villains, seasonal décor and shows in Disneyland Park.'],
        ['Disney Enchanted Christmas', '2026-11-07', '2027-01-06', 'Mickey’s Dazzling Christmas Parade, Santa until 24 Dec, first Christmas with World of Frozen.'],
        ['New Year’s Eve', '2026-12-31', '2026-12-31', 'Celebrations included with park tickets.'],
        ['Lunar New Year', null, null, 'Usually late January–February (Lunar New Year 2027 is 6 Feb) — Disney dates TBA.'],
        ['Disneyland Paris 35th anniversary', '2027-04-12', '2027-04-12', 'Birthday celebrations; a longer season hasn’t been confirmed.'],
        ['Disneyland Paris Pride', null, null, 'Separately ticketed evening, usually in June — 2027 date TBA.'],
        ['Disney Halloween Festival 2027', null, null, 'October 2027 — dates TBA.'],
    ],

    'sources' => [
        ['Disney Park Nerds — hotels ranked', 'https://disneyparknerds.com/disneyland-paris-hotels-ranked/'],
        ['DLP Tips — hotels comparison 2026', 'https://dlptips.com/disneyland-paris-hotels-comparison-onsite-vs-offsite-prices-perks/'],
        ['julieears.com — hotel shuttles 2026', 'https://www.en.julieears.com/disney-hotel-shuttle/'],
        ['Disney Holidays — partner hotels', 'https://www.disneyholidays.co.uk/disneyland-paris/partner-hotels-and-selected-hotels/'],
        ['DLP Tips — meal plans 2026', 'https://dlptips.com/dining-2/dlp-meal-plans/'],
        ['julieears.com — meal plans', 'https://julieears.com/en/planning/disneyland-paris-meal-plans/'],
        ['Disneyland Paris — book a table', 'https://www.disneylandparis.com/en-gb/dining/advance-table-booking'],
        ['Disneyland Paris FAQ — table reservations', 'https://www.disneylandparis.com/en-int/faq/dining/reservations'],
        ['Sortiraparis — closures November 2026', 'https://www.sortiraparis.com/en/what-to-visit-in-paris/walks/articles/323364-disneyland-paris-which-rides-are-closed-in-november-2026'],
        ['WDWNT — refurbishments and closures', 'https://wdwnt.com/refurbishments-and-closures/'],
        ['DLP Tips — closures 2026–27', 'https://dlptips.com/planning-tips/dlp-closures-refurbs/'],
        ['DLP Tips — disability passes', 'https://dlptips.com/planning-tips/disabilities/'],
        ['julieears.com — Priority Card', 'https://julieears.com/en/guides/disneyland-paris-priority-card/'],
        ['Eurostar Help — Disneyland Paris', 'https://help.eurostar.com/faq/uk-en/question/Travelling-to-from-Disneyland-Paris'],
        ['julieears.com — RER A Paris → Disneyland', 'https://julieears.com/us/transport/rer-a-paris-to-disneyland-paris/'],
        ['mickeyfromthe.uk — Magical Shuttle no cash', 'https://mickeyfromthe.uk/news/disneyland-paris-magical-shuttle-stops-accepting-cash-on-board'],
        ['julieears.com — Magical Shuttle 2026', 'https://www.en.julieears.com/magical-shuttle-disneyland-paris/'],
        ['Laughing Place — Disneyland Paris 2027 look-ahead', 'https://www.laughingplace.com/disney-parks/disneyland-paris-2027-look-ahead/'],
    ],
];
