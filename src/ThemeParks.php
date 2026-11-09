<?php

declare(strict_types=1);

namespace ParkPulse;

/** ThemeParks.wiki v1 client (cached). */
final class ThemeParks
{
    public function __construct(
        private Http $http,
        private Cache $cache,
        private string $base,
        private array $ttl,
    ) {
    }

    public function destinations(): array
    {
        return $this->cache->remember(
            'tp:destinations',
            $this->ttl['destinations'],
            fn () => $this->http->getJson($this->url('/destinations')),
        );
    }

    public function children(string $id): array
    {
        return $this->cache->remember(
            "tp:children:$id",
            $this->ttl['children'],
            fn () => $this->http->getJson($this->url('/entity/' . rawurlencode($id) . '/children')),
        );
    }

    public function live(string $id): array
    {
        return $this->cache->remember(
            "tp:live:$id",
            $this->ttl['live'],
            fn () => $this->http->getJson($this->url('/entity/' . rawurlencode($id) . '/live')),
        );
    }

    public function schedule(string $id, int $year, int $month): array
    {
        return $this->cache->remember(
            $this->scheduleKey($id, $year, $month),
            $this->ttl['schedule'],
            fn () => $this->http->getJson($this->scheduleUrl($id, $year, $month)),
        );
    }

    /**
     * Schedules for many entities (used for shows), fetched in parallel.
     *
     * @param string[] $ids
     * @return array<string, ?array> entity id => cache envelope (null if unavailable)
     */
    public function scheduleMany(array $ids, int $year, int $month): array
    {
        $map = [];
        foreach ($ids as $id) {
            $map[$this->scheduleKey($id, $year, $month)] = $this->scheduleUrl($id, $year, $month);
        }
        $results = $this->cache->rememberMany($map, $this->ttl['show_schedule'], $this->http);

        $out = [];
        foreach ($ids as $id) {
            $out[$id] = $results[$this->scheduleKey($id, $year, $month)] ?? null;
        }
        return $out;
    }

    private function scheduleKey(string $id, int $year, int $month): string
    {
        return sprintf('tp:schedule:%s:%04d-%02d', $id, $year, $month);
    }

    private function scheduleUrl(string $id, int $year, int $month): string
    {
        // The API rejects single-digit months ("/2027/1" is a 400), so always pad.
        return $this->url(sprintf('/entity/%s/schedule/%04d/%02d', rawurlencode($id), $year, $month));
    }

    private function url(string $path): string
    {
        return rtrim($this->base, '/') . $path;
    }
}
