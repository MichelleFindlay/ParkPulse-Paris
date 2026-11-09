<?php

declare(strict_types=1);

namespace ParkPulse;

/**
 * Walking network for in-app navigation, built from OpenStreetMap paths (Overpass).
 * Backstage ways (access=private/no/…) are dropped, only the largest connected
 * network is kept, and the result is a compact graph the phone routes on itself:
 *   nodes: [[lat, lng], …]   edges: [a, b, metres, kind]  (kind 0 path · 1 steps · 2 service road)
 * Cached for two weeks (stale copy served if Overpass is down).
 */
final class WalkGraph
{
    private const TTL = 14 * 86400;
    private const BLOCKED = ['private', 'no', 'emergency', 'permit', 'delivery', 'agricultural'];

    public function __construct(private Http $http, private Cache $cache, private array $endpoints, private array $bbox)
    {
    }

    public function graph(): array
    {
        [$s, $w, $n, $e] = array_map('floatval', $this->bbox);
        $query = sprintf(
            '[out:json][timeout:60];way["highway"~"^(footway|path|pedestrian|steps|living_street|service|corridor|track|residential|unclassified)$"](%F,%F,%F,%F);out tags geom;',
            $s, $w, $n, $e
        );
        $env = $this->cache->remember('walkgraph:' . sha1($query), self::TTL, function () use ($query): array {
            $errors = [];
            foreach ($this->endpoints as $url) {
                try {
                    $d = $this->http->postForm($url, ['data' => $query], [], 90);
                    if (!isset($d['elements']) || !is_array($d['elements'])) {
                        throw new UpstreamException('no elements in reply');
                    }
                    return $this->build($d['elements']);
                } catch (\Throwable $ex) {
                    $errors[] = $ex->getMessage();
                }
            }
            throw new UpstreamException('Overpass unavailable (' . implode('; ', $errors) . ')');
        });
        return $env['data'] + ['fetchedAt' => $env['fetchedAt'], 'stale' => $env['stale']];
    }

    private function build(array $ways): array
    {
        $index = [];
        $nodes = [];
        $edges = [];
        $adj = [];
        $id = function (array $p) use (&$index, &$nodes): int {
            $k = sprintf('%.6F,%.6F', $p['lat'], $p['lon']);
            if (!isset($index[$k])) {
                $index[$k] = count($nodes);
                $nodes[] = [round((float) $p['lat'], 6), round((float) $p['lon'], 6)];
            }
            return $index[$k];
        };
        foreach ($ways as $way) {
            $t = $way['tags'] ?? [];
            if (in_array($t['access'] ?? '', self::BLOCKED, true) || in_array($t['foot'] ?? '', ['no', 'private'], true)) {
                continue;
            }
            $kind = match ($t['highway'] ?? '') {
                'steps' => 1,
                'service', 'unclassified', 'residential', 'track' => 2,
                default => 0,
            };
            $geom = $way['geometry'] ?? [];
            for ($i = 1, $c = count($geom); $i < $c; $i++) {
                $a = $id($geom[$i - 1]);
                $b = $id($geom[$i]);
                if ($a === $b) {
                    continue;
                }
                $len = ParkService::metres($nodes[$a][0], $nodes[$a][1], $nodes[$b][0], $nodes[$b][1]);
                $edges[] = [$a, $b, round($len, 1), $kind];
                $adj[$a][] = $b;
                $adj[$b][] = $a;
            }
        }

        // Keep only the largest connected network (drops isolated backstage fragments).
        $comp = [];
        $best = -1;
        $bestSize = 0;
        foreach (array_keys($adj) as $start) {
            if (isset($comp[$start])) {
                continue;
            }
            $label = $start;
            $stack = [$start];
            $comp[$start] = $label;
            $size = 0;
            while ($stack) {
                $u = array_pop($stack);
                $size++;
                foreach ($adj[$u] as $v) {
                    if (!isset($comp[$v])) {
                        $comp[$v] = $label;
                        $stack[] = $v;
                    }
                }
            }
            if ($size > $bestSize) {
                $bestSize = $size;
                $best = $label;
            }
        }
        $remap = [];
        $outNodes = [];
        foreach ($nodes as $i => $p) {
            if (($comp[$i] ?? null) === $best) {
                $remap[$i] = count($outNodes);
                $outNodes[] = $p;
            }
        }
        $outEdges = [];
        foreach ($edges as [$a, $b, $len, $kind]) {
            if (isset($remap[$a], $remap[$b])) {
                $outEdges[] = [$remap[$a], $remap[$b], $len, $kind];
            }
        }
        return ['v' => 1, 'nodes' => $outNodes, 'edges' => $outEdges];
    }
}
