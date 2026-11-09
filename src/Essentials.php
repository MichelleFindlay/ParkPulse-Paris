<?php

declare(strict_types=1);

namespace ParkPulse;

/**
 * Practical points for the map from OpenStreetMap: toilets (with baby-changing and
 * wheelchair flags), drinking water, first aid, defibrillators, cash machines, luggage
 * lockers, rain shelters + covered walkways, benches/picnic tables, smoking areas and
 * viewpoints — plus restaurants' diet tags (vegetarian, vegan, halal, gluten-free…).
 * Cached for two weeks; stale copy served if Overpass is down.
 */
final class Essentials
{
    private const TTL = 14 * 86400;

    public function __construct(private Http $http, private Cache $cache, private array $endpoints, private array $bbox)
    {
    }

    public function fetch(): array
    {
        $b = vsprintf('%F,%F,%F,%F', array_map('floatval', $this->bbox));
        $query = '[out:json][timeout:60];('
            . "nwr[\"amenity\"~\"^(toilets|drinking_water|water_point|atm|bureau_de_change|luggage_locker|locker|first_aid|baby_care)$\"]($b);"
            . "nwr[\"emergency\"~\"^(first_aid|first_aid_kit|defibrillator)$\"]($b);"
            . "nwr[\"healthcare\"]($b);"
            . "nwr[\"amenity\"~\"^(shelter|bench|smoking_area)$\"]($b);"
            . "nwr[\"leisure\"=\"picnic_table\"]($b);"
            . "nwr[\"tourism\"=\"viewpoint\"]($b);"
            . "way[\"highway\"][\"covered\"=\"yes\"]($b);"
            . "nwr[\"amenity\"~\"^(restaurant|fast_food|cafe|ice_cream|bar|pub)$\"][~\"^diet:\"~\".\"]($b);"
            . ');out center tags;';

        $env = $this->cache->remember('essentials:' . sha1($query), self::TTL, function () use ($query): array {
            $errors = [];
            foreach ($this->endpoints as $url) {
                try {
                    $d = $this->http->postForm($url, ['data' => $query], [], 60);
                    if (!isset($d['elements']) || !is_array($d['elements'])) {
                        throw new UpstreamException('no elements in reply');
                    }
                    return ['items' => $this->build($d['elements']), 'diets' => $this->diets($d['elements'])];
                } catch (\Throwable $ex) {
                    $errors[] = $ex->getMessage();
                }
            }
            throw new UpstreamException('Overpass unavailable (' . implode('; ', $errors) . ')');
        });
        return ['items' => $env['data']['items'], 'diets' => $env['data']['diets'] ?? [], 'fetchedAt' => $env['fetchedAt'], 'stale' => $env['stale']];
    }

    private function build(array $elements): array
    {
        $out = [];
        foreach ($elements as $el) {
            $t = $el['tags'] ?? [];
            $lat = $el['lat'] ?? $el['center']['lat'] ?? null;
            $lng = $el['lon'] ?? $el['center']['lon'] ?? null;
            if ($lat === null || $lng === null || in_array($t['access'] ?? '', ['private', 'no'], true)) {
                continue;
            }
            $a = $t['amenity'] ?? '';
            if (in_array($a, ['restaurant', 'fast_food', 'cafe', 'ice_cream', 'bar', 'pub'], true)) {
                continue; // diet info only (see diets())
            }
            $type = match (true) {
                $a === 'shelter' || (($t['covered'] ?? '') === 'yes' && isset($t['highway'])) => 'shelter',
                $a === 'bench' || ($t['leisure'] ?? '') === 'picnic_table' => 'seat',
                $a === 'smoking_area' => 'smoking',
                ($t['tourism'] ?? '') === 'viewpoint' => 'viewpoint',
                $a === 'toilets' => 'toilets',
                $a === 'drinking_water' || $a === 'water_point' => 'water',
                $a === 'atm' || $a === 'bureau_de_change' => 'cash',
                $a === 'luggage_locker' || $a === 'locker' => 'lockers',
                $a === 'baby_care' => 'baby',
                ($t['emergency'] ?? '') === 'defibrillator' => 'aed',
                $a === 'first_aid' || in_array($t['emergency'] ?? '', ['first_aid', 'first_aid_kit'], true) || isset($t['healthcare']) => 'firstaid',
                default => null,
            };
            if ($type === null) {
                continue;
            }
            $out[] = [
                'id'         => 'ess-' . substr((string) ($el['type'] ?? 'n'), 0, 1) . ($el['id'] ?? 0),
                'type'       => $type,
                'name'       => trim((string) ($t['name:en'] ?? $t['name'] ?? $t['operator'] ?? '')) ?: null,
                'lat'        => (float) $lat,
                'lng'        => (float) $lng,
                'baby'       => ($t['changing_table'] ?? '') === 'yes' || $type === 'baby',
                'wheelchair' => ($t['wheelchair'] ?? '') === 'yes',
                'fee'        => ($t['fee'] ?? '') === 'yes',
                'hours'      => $t['opening_hours'] ?? null,
                'walkway'    => isset($t['highway']) && ($t['covered'] ?? '') === 'yes',
            ];
        }
        return $out;
    }

    /** Restaurants' diet tags: [{osmId, name, lat, lng, diet: {vegetarian: 'yes'|'only'|…}}]. */
    private function diets(array $elements): array
    {
        $out = [];
        foreach ($elements as $el) {
            $t = $el['tags'] ?? [];
            if (!in_array($t['amenity'] ?? '', ['restaurant', 'fast_food', 'cafe', 'ice_cream', 'bar', 'pub'], true)) {
                continue;
            }
            $diet = [];
            foreach ($t as $k => $v) {
                if (str_starts_with($k, 'diet:') && in_array($v, ['yes', 'only', 'limited'], true)) {
                    $diet[substr($k, 5)] = $v;
                }
            }
            $lat = $el['lat'] ?? $el['center']['lat'] ?? null;
            $lng = $el['lon'] ?? $el['center']['lon'] ?? null;
            if (!$diet || $lat === null) {
                continue;
            }
            $out[] = [
                'osmId' => 'osm-' . substr((string) ($el['type'] ?? 'n'), 0, 1) . ($el['id'] ?? 0),
                'name'  => trim((string) ($t['name:en'] ?? $t['name'] ?? '')),
                'lat'   => (float) $lat,
                'lng'   => (float) $lng,
                'diet'  => $diet,
            ];
        }
        return $out;
    }
}
