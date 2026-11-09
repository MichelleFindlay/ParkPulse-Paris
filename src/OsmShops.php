<?php

declare(strict_types=1);

namespace ParkPulse;

/**
 * Places around the resort from OpenStreetMap (Overpass API, free, no key), in one
 * query: shops (parks + Village), food/drink/cinema venues and the Disney hotels.
 * OSM is also the only opening-hours source for Disney Village and the hotels.
 * Overpass is frequently overloaded, so results are cached for a week and the last
 * good copy is served for as long as needed.
 */
final class OsmShops
{
    private const TTL = 7 * 86400;

    /** OSM shop=* value → friendly label. */
    private const KINDS = [
        'gift' => 'Gifts & souvenirs', 'toys' => 'Toys', 'clothes' => 'Clothing', 'confectionery' => 'Sweets',
        'jewelry' => 'Jewellery', 'photo' => 'Photos', 'beverages' => 'Drinks', 'convenience' => 'Snacks & essentials',
        'books' => 'Books', 'art' => 'Art', 'bag' => 'Bags', 'hat' => 'Hats', 'chocolate' => 'Chocolate',
        'pastry' => 'Pastries', 'bakery' => 'Bakery', 'newsagent' => 'Newsagent', 'tobacco' => 'Tobacco',
        'perfumery' => 'Perfume', 'cosmetics' => 'Cosmetics', 'collector' => 'Collectibles', 'mall' => 'Shopping',
        'sports' => 'Sport', 'variety_store' => 'Variety', 'department_store' => 'Department store',
        'electronics' => 'Electronics', 'video_games' => 'Games', 'shoes' => 'Shoes', 'yes' => 'Shop',
        'ticket' => 'Tickets & services', 'kiosk' => 'Kiosk', 'houseware' => 'Homeware', 'travel_agency' => 'Travel',
    ];

    /** OSM amenity=* value → [section, kind label]. */
    private const VENUES = [
        'restaurant' => ['Restaurants', 'Restaurant'],
        'fast_food'  => ['Quick bites', 'Quick service'],
        'cafe'       => ['Quick bites', 'Café'],
        'ice_cream'  => ['Quick bites', 'Ice cream'],
        'bar'        => ['Bars', 'Bar'],
        'pub'        => ['Bars', 'Pub'],
        'nightclub'  => ['Bars', 'Nightclub'],
        'cinema'     => ['Entertainment', 'Cinema'],
    ];

    /** @param string[] $endpoints Overpass interpreter URLs, tried in order */
    public function __construct(
        private Http $http,
        private Cache $cache,
        private array $endpoints,
        private array $shopsBbox,
        private array $venuesBbox,
    ) {
    }

    /**
     * @return array{items: list<array>, venues: list<array>, hotels: list<array>,
     *               fetchedAt: int, stale: bool, error: ?string}
     */
    public function fetch(): array
    {
        $box = static fn (array $b): string => vsprintf('%F,%F,%F,%F', array_map('floatval', $b));
        $amenities = implode('|', array_keys(self::VENUES));
        $query = '[out:json][timeout:25];('
            . 'nwr["shop"](' . $box($this->shopsBbox) . ');'
            . 'nwr["amenity"~"^(' . $amenities . ')$"](' . $box($this->venuesBbox) . ');'
            . 'nwr["tourism"="hotel"](' . $box($this->venuesBbox) . ');'
            . ');out center tags;';

        $env = $this->cache->remember('osm:places:' . sha1($query), self::TTL, function () use ($query): array {
            $errors = [];
            foreach ($this->endpoints as $url) {
                try {
                    $d = $this->http->postForm($url, ['data' => $query], [], 40);
                    if (!isset($d['elements']) || !is_array($d['elements'])) {
                        throw new UpstreamException('no elements in reply');
                    }
                    return ['elements' => $d['elements']];
                } catch (\Throwable $ex) {
                    $errors[] = $ex->getMessage();
                }
            }
            throw new UpstreamException('Overpass unavailable (' . implode('; ', $errors) . ')');
        });

        $shops = [];
        $venues = [];
        $hotels = [];
        foreach ($env['data']['elements'] as $el) {
            $t = $el['tags'] ?? [];
            $name = trim((string) ($t['name:en'] ?? $t['name'] ?? ''));
            $lat = $el['lat'] ?? $el['center']['lat'] ?? null;
            $lng = $el['lon'] ?? $el['center']['lon'] ?? null;
            if ($name === '' || $lat === null || $lng === null) {
                continue;
            }
            $base = [
                'id'        => 'osm-' . substr((string) ($el['type'] ?? 'n'), 0, 1) . ($el['id'] ?? 0),
                'name'      => $name,
                'hoursText' => isset($t['opening_hours']) ? (string) $t['opening_hours'] : null,
                'location'  => ['lat' => (float) $lat, 'lng' => (float) $lng],
            ];
            if (isset($t['shop'])) {
                $shop = (string) $t['shop'];
                $shops[] = $base + ['type' => 'SHOP', 'kind' => self::KINDS[$shop] ?? ucfirst(str_replace('_', ' ', $shop))];
            } elseif (isset($t['amenity'], self::VENUES[$t['amenity']])) {
                [$section, $kind] = self::VENUES[$t['amenity']];
                $cuisine = isset($t['cuisine']) ? ucfirst(str_replace(['_', ';'], [' ', ', '], (string) $t['cuisine'])) : null;
                $venues[] = $base + ['type' => 'VILLAGE', 'section' => $section, 'kind' => $kind, 'about' => $cuisine];
            } elseif (($t['tourism'] ?? '') === 'hotel' && str_contains(strtolower($name), 'disney')) {
                $hotels[] = ['name' => trim(str_replace(['®', '™'], '', $name)), 'location' => $base['location']];
            }
        }

        return [
            'items'     => $shops,
            'venues'    => $venues,
            'hotels'    => $hotels,
            'fetchedAt' => $env['fetchedAt'],
            'stale'     => $env['stale'],
            'error'     => $env['error'],
        ];
    }
}
