<?php

declare(strict_types=1);

namespace ParkPulse;

/**
 * Queue-Times.com client (cached). Used as the wait-time fallback and for land names.
 * Queue-Times asks that apps credit them — the UI shows "Powered by Queue-Times.com"
 * whenever its data is on screen.
 */
final class QueueTimes
{
    public function __construct(
        private Http $http,
        private Cache $cache,
        private string $base,
        private array $ttl,
    ) {
    }

    public function parks(): array
    {
        return $this->cache->remember(
            'qt:parks',
            $this->ttl['qt_parks'],
            fn () => $this->http->getJson($this->url('/parks.json')),
        );
    }

    public function queueTimes(int $parkId): array
    {
        return $this->cache->remember(
            "qt:live:$parkId",
            $this->ttl['qt_live'],
            fn () => $this->http->getJson($this->url("/parks/$parkId/queue_times.json")),
        );
    }

    /**
     * Land name per normalised ride name. Cached for a day on its own so the
     * land labels don't cost a Queue-Times call every minute.
     *
     * @return array<string, string>
     */
    public function lands(int $parkId): array
    {
        $env = $this->cache->remember("qt:lands:$parkId", $this->ttl['qt_lands'], function () use ($parkId): array {
            $map = [];
            foreach ($this->rides($this->queueTimes($parkId)['data']) as $ride) {
                if ($ride['land'] !== null) {
                    $map[$ride['norm']] = $ride['land'];
                }
            }
            return $map;
        });
        return $env['data'];
    }

    /**
     * Flatten a queue_times.json payload.
     *
     * @return list<array{id:int, name:string, norm:string, singleRider:bool, open:bool, wait:?int, land:?string, updated:?string}>
     */
    public function rides(array $payload): array
    {
        $out = [];
        $add = function (array $ride, ?string $land) use (&$out): void {
            $name = (string) ($ride['name'] ?? '');
            $norm = Text::norm($name);
            $single = false;
            if (preg_match('/\s+single rider$/', $norm)) {
                $norm = (string) preg_replace('/\s+single rider$/', '', $norm);
                $single = true;
            }
            $out[] = [
                'id'          => (int) ($ride['id'] ?? 0),
                'name'        => $name,
                'norm'        => $norm,
                'singleRider' => $single,
                'open'        => (bool) ($ride['is_open'] ?? false),
                'wait'        => isset($ride['wait_time']) ? (int) $ride['wait_time'] : null,
                'land'        => $land,
                'updated'     => $ride['last_updated'] ?? null,
            ];
        };
        foreach ($payload['lands'] ?? [] as $land) {
            foreach ($land['rides'] ?? [] as $ride) {
                $add($ride, isset($land['name']) ? (string) $land['name'] : null);
            }
        }
        foreach ($payload['rides'] ?? [] as $ride) {
            $add($ride, null);
        }
        return $out;
    }

    private function url(string $path): string
    {
        return rtrim($this->base, '/') . $path;
    }
}
