<?php

declare(strict_types=1);

namespace ParkPulse;

/**
 * SQLite-backed response cache with stale-on-error.
 *
 * Every lookup returns an envelope:
 *   ['data' => array, 'fetchedAt' => int, 'stale' => bool, 'error' => ?string]
 * "stale" means the TTL had passed and the refresh failed, so older data was served.
 */
final class Cache
{
    private const PRUNE_AFTER = 30 * 86400;

    public function __construct(private \PDO $db)
    {
    }

    public function read(string $key): ?array
    {
        $stmt = $this->db->prepare('SELECT body, fetched_at FROM cache WHERE key = ?');
        $stmt->execute([$key]);
        $row = $stmt->fetch();
        if (!$row) {
            return null;
        }
        $data = json_decode($row['body'], true);
        if (!is_array($data)) {
            return null;
        }
        return ['data' => $data, 'fetchedAt' => (int) $row['fetched_at']];
    }

    public function write(string $key, array $data): void
    {
        $stmt = $this->db->prepare('INSERT OR REPLACE INTO cache (key, body, fetched_at) VALUES (?, ?, ?)');
        $stmt->execute([$key, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), time()]);
    }

    /** @param callable(): array $fetch */
    public function remember(string $key, int $ttl, callable $fetch): array
    {
        $hit = $this->read($key);
        if ($hit !== null && time() - $hit['fetchedAt'] < $ttl) {
            return $hit + ['stale' => false, 'error' => null];
        }
        try {
            $data = $fetch();
        } catch (\Throwable $e) {
            if ($hit !== null) {
                return $hit + ['stale' => true, 'error' => $e->getMessage()];
            }
            throw $e;
        }
        $this->write($key, $data);
        return ['data' => $data, 'fetchedAt' => time(), 'stale' => false, 'error' => null];
    }

    /**
     * Like remember() for many URLs at once; misses are fetched in parallel.
     *
     * @param array<string, string> $keyToUrl
     * @return array<string, ?array> envelope per key, or null if never fetched successfully
     */
    public function rememberMany(array $keyToUrl, int $ttl, Http $http): array
    {
        $out = [];
        $hits = [];
        $misses = [];
        foreach ($keyToUrl as $key => $url) {
            $hit = $this->read($key);
            $hits[$key] = $hit;
            if ($hit !== null && time() - $hit['fetchedAt'] < $ttl) {
                $out[$key] = $hit + ['stale' => false, 'error' => null];
            } else {
                $misses[$key] = $url;
            }
        }

        if ($misses) {
            $results = $http->multi($misses);
            $this->db->beginTransaction();
            try {
                foreach ($results as $key => $result) {
                    if ($result instanceof \Throwable) {
                        $out[$key] = $hits[$key] !== null
                            ? $hits[$key] + ['stale' => true, 'error' => $result->getMessage()]
                            : null;
                        continue;
                    }
                    $this->write($key, $result);
                    $out[$key] = ['data' => $result, 'fetchedAt' => time(), 'stale' => false, 'error' => null];
                }
                $this->db->commit();
            } catch (\Throwable $e) {
                $this->db->rollBack();
                throw $e;
            }
        }

        return $out;
    }

    public function forget(string $key): void
    {
        $this->db->prepare('DELETE FROM cache WHERE key = ?')->execute([$key]);
    }

    /** Drop entries nobody has refreshed in a month. Cheap; call occasionally. */
    public function prune(): void
    {
        $stmt = $this->db->prepare('DELETE FROM cache WHERE fetched_at < ?');
        $stmt->execute([time() - self::PRUNE_AFTER]);
    }
}
