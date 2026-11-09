<?php

declare(strict_types=1);

/*
 * Opening hours researched on the web for places with no live feed and no (or
 * outdated) OpenStreetMap hours. These override OSM and are shown with their source
 * and check date. Edit over FTP as things change.
 *
 * Fields:
 *   match    name to match (loose: "Rosalie" matches "Rosalie (brasserie)")
 *   hours    OpenStreetMap opening_hours syntax, e.g. "Mo-Th 11:30-23:30; Fr,Sa 11:30-24:00"
 *            or "off" for closed
 *   note     optional short note shown on the card
 *   source   where it came from; url = link; checked = date looked up
 *   weak     true when the only source is a fan guide/old listing
 *
 * "dlpstats.com" figures are Disney's own published hours for Monday 2 Nov 2026 as
 * mirrored by dlpstats.com; they are used as the typical daily hours for the trip.
 */
return [
    // ------------------------------------------------------- Disney Village
    ['match' => 'The Steakhouse', 'hours' => 'Mo-Su 12:00-23:00',
     'source' => 'dlpstats.com (Disney hours)', 'url' => 'https://www.dlpstats.com/dlp/restaurants', 'checked' => '2026-11-02'],
    ['match' => "Billy Bob's", 'hours' => 'Mo-Su 17:00-01:00',
     'note' => 'Billy Bob\'s Buffet / La Grange upstairs: 18:00–23:00.',
     'source' => 'dlpstats.com (Disney hours)', 'url' => 'https://www.dlpstats.com/dlp/restaurants', 'checked' => '2026-11-02'],
    ['match' => 'Sports Bar', 'hours' => 'Mo-Su 08:00-24:00',
     'source' => 'dlpstats.com (Disney hours)', 'url' => 'https://www.dlpstats.com/dlp/restaurants', 'checked' => '2026-11-02'],
    ['match' => "Annette's Diner", 'hours' => 'off',
     'note' => 'Closed for renovation since 5 Jan 2026 — reopening Q1 2027.',
     'source' => 'dlpstats.com (Maintenance) + seasonalentertainmentsource.com', 'url' => 'https://seasonalentertainmentsource.com/disney-village-south-block-rainforest-cafe-closing/', 'checked' => '2026-11-02'],
    ['match' => 'Rainforest Cafe', 'hours' => 'Su-Fr 11:00-23:00; Sa 11:00-24:00',
     'note' => 'Closing for good in late 2026 (reportedly around November, no official date) — check it’s still open.',
     'source' => 'radiodisneyclub.fr / journaldugeek.com', 'url' => 'https://www.journaldugeek.com/2026/08/27/a-disney-village-le-rainforest-cafe-saccorde-deux-mois-avant-la-fermeture/', 'checked' => '2026-11-02', 'weak' => true],
    ['match' => 'Vapiano', 'hours' => 'Mo-Th 11:30-23:30; Fr,Sa 11:30-24:00; Su 11:30-22:30',
     'note' => 'Interior refurbishment in phases from late 2026; stays open.',
     'source' => 'vapiano.fr (official)', 'url' => 'https://www.vapiano.fr/en/restaurant/vapiano-disney-village/', 'checked' => '2026-11-02'],
    ['match' => 'Rosalie', 'hours' => 'Mo-Fr 08:00-23:00; Sa 08:00-23:30; Su 08:00-23:00',
     'note' => 'Table service from 11:30; breakfast & takeaway counter from 08:00.',
     'source' => 'Paris je t’aime (tourist office) / brasserierosalie.com', 'url' => 'https://parisjetaime.com/eng/restaurant/brasserie-rosalie-p4199', 'checked' => '2026-11-02'],
    ['match' => 'The Royal Pub', 'hours' => 'Mo-Su 11:30-23:00',
     'note' => 'Happy hour 17:30–19:00.',
     'source' => 'Tripadvisor / DLP Tips', 'url' => 'https://dlptips.com/dining-2/disney-village-restaurants/the-royal-pub-disneyland-paris/', 'checked' => '2026-11-02', 'weak' => true],
    ['match' => "Buffalo Bill's", 'hours' => 'off',
     'note' => 'Show on hold since late 2020.',
     'source' => 'julieears.com Disney Village guide (updated 23 Oct 2026)', 'url' => 'https://julieears.com/us/guides/disney-village/', 'checked' => '2026-11-02'],
    ['match' => 'Gaumont', 'hours' => 'Mo-Su 10:30-22:30',
     'note' => 'Typical first–last showings; becoming Pathé Disney Village (open during works). See pathe.fr for showtimes.',
     'source' => 'pathe.fr / radiodisneyclub.fr', 'url' => 'https://www.pathe.fr/cinemas/cinema-gaumont-disney-village', 'checked' => '2026-11-02', 'weak' => true],
    ['match' => 'World of Disney', 'hours' => 'Su-Fr 09:00-23:00; Sa 09:00-24:00',
     'source' => 'pariseaglecab.com guide', 'url' => 'https://www.pariseaglecab.com/blog/the-wonders-of-disney-village-paris/', 'checked' => '2026-11-02', 'weak' => true],

    // ----------------------------------------------------------- Disney hotels
    ['match' => 'Manhattan Restaurant', 'hours' => 'Mo-Su 18:00-22:30',
     'source' => 'dlpstats.com (Disney hours)', 'url' => 'https://www.dlpstats.com/dlp/restaurants', 'checked' => '2026-11-02'],
    ['match' => 'Downtown Restaurant', 'hours' => 'Mo-Su 18:00-23:00',
     'note' => 'Also serves breakfast (hotel guests).',
     'source' => 'dlpstats.com (Disney hours)', 'url' => 'https://www.dlpstats.com/dlp/restaurants', 'checked' => '2026-11-02'],
    ['match' => 'Bleecker Street Lounge', 'hours' => 'Mo-Su 08:00-15:00',
     'source' => 'dlpstats.com (Disney hours)', 'url' => 'https://www.dlpstats.com/dlp/restaurants', 'checked' => '2026-11-02'],
    ['match' => 'Skyline Bar', 'hours' => 'Mo-Su 15:00-01:00',
     'source' => 'dlpstats.com (Disney hours)', 'url' => 'https://www.dlpstats.com/dlp/restaurants', 'checked' => '2026-11-02'],
    ['match' => 'Cape Cod', 'hours' => 'Mo-Su 18:00-22:30',
     'note' => 'Buffet. Breakfast for hotel guests.',
     'source' => 'dlpstats.com (Disney hours)', 'url' => 'https://www.dlpstats.com/dlp/restaurants', 'checked' => '2026-11-02'],
    ['match' => "Captain's Quarters", 'hours' => 'Mo-Su 13:00-01:00',
     'source' => 'dlpstats.com (Disney hours)', 'url' => 'https://www.dlpstats.com/dlp/restaurants', 'checked' => '2026-11-02'],
    ['match' => 'Yacht Club', 'hours' => 'off', 'note' => 'Listed as under maintenance.',
     'source' => 'dlpstats.com (Disney hours)', 'url' => 'https://www.dlpstats.com/dlp/restaurants', 'checked' => '2026-11-02'],
    ['match' => "Hunter's Grill", 'hours' => 'Mo-Su 18:00-22:30', 'note' => 'Buffet. Breakfast for hotel guests.',
     'source' => 'dlpstats.com (Disney hours)', 'url' => 'https://www.dlpstats.com/dlp/restaurants', 'checked' => '2026-11-02'],
    ['match' => 'Beaver Creek Tavern', 'hours' => 'off', 'note' => 'Listed as under maintenance.',
     'source' => 'dlpstats.com (Disney hours)', 'url' => 'https://www.dlpstats.com/dlp/restaurants', 'checked' => '2026-11-02'],
    ['match' => 'Redwood Bar and Lounge', 'hours' => 'Mo-Su 16:00-01:00',
     'source' => 'dlpstats.com (Disney hours)', 'url' => 'https://www.dlpstats.com/dlp/restaurants', 'checked' => '2026-11-02'],
    ['match' => 'Chuck Wagon Café', 'hours' => 'Mo-Su 18:00-22:30', 'note' => 'Buffet. Breakfast for hotel guests.',
     'source' => 'dlpstats.com (Disney hours)', 'url' => 'https://www.dlpstats.com/dlp/restaurants', 'checked' => '2026-11-02'],
    ['match' => 'Red Garter Saloon', 'hours' => 'Mo-Su 17:00-24:00',
     'source' => 'dlpstats.com (Disney hours)', 'url' => 'https://www.dlpstats.com/dlp/restaurants', 'checked' => '2026-11-02'],
    ['match' => 'La Cantina', 'hours' => 'Mo-Su 18:00-22:30', 'note' => 'Buffet. Breakfast for hotel guests.',
     'source' => 'dlpstats.com (Disney hours)', 'url' => 'https://www.dlpstats.com/dlp/restaurants', 'checked' => '2026-11-02'],
    ['match' => 'Rio Grande Bar', 'hours' => 'Mo-Su 17:30-24:00',
     'source' => 'dlpstats.com (Disney hours)', 'url' => 'https://www.dlpstats.com/dlp/restaurants', 'checked' => '2026-11-02'],
    ['match' => 'Royal Banquet', 'hours' => 'Mo-Su 12:30-22:30', 'note' => 'Character dining buffet.',
     'source' => 'dlpstats.com (Disney hours)', 'url' => 'https://www.dlpstats.com/dlp/restaurants', 'checked' => '2026-11-02'],
    ['match' => 'La Table de Lumière', 'hours' => 'Mo-Su 18:00-22:30',
     'source' => 'dlpstats.com (Disney hours)', 'url' => 'https://www.dlpstats.com/dlp/restaurants', 'checked' => '2026-11-02'],
];
