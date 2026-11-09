<?php

declare(strict_types=1);

namespace ParkPulse;

/**
 * Finds Disney's official menu PDFs. They live at
 *   https://media.disneylandparis.com/d4th/{en-gb|fr-fr}/images/{externalId}_{name-slug}.pdf
 * where externalId is the same code ThemeParks.wiki gives each restaurant (e.g. P2TR02).
 * We try a few slug variants with HEAD requests (media.disneylandparis.com's robots.txt
 * allows everything) and cache the answers — including "none found" — for a week.
 */
final class MenuFinder
{
    private const BASE = 'https://media.disneylandparis.com/d4th/%s/images/%s_%s.pdf';
    private const TTL = 7 * 86400;
    private const PARALLEL = 8;

    public function __construct(private Cache $cache, private string $userAgent)
    {
    }

    /**
     * @param list<array{id:string, ext:string, name:string}> $restaurants
     * @return array<string, ?string> entity id => menu URL (or null)
     */
    public function find(array $restaurants): array
    {
        $key = 'menus:' . sha1(json_encode(array_map(fn ($r) => $r['ext'] . $r['name'], $restaurants)));
        return $this->cache->remember($key, self::TTL, function () use ($restaurants): array {
            $out = [];
            // Round-robin through each restaurant's candidates, stopping at the first hit.
            $pending = [];
            foreach ($restaurants as $r) {
                if (!preg_match('/^[A-Z0-9]{4,10}$/', $r['ext'])) {
                    $out[$r['id']] = null;
                    continue;
                }
                $pending[$r['id']] = $this->candidates($r['ext'], $r['name']);
                $out[$r['id']] = null;
            }
            while ($pending) {
                $batch = [];
                foreach ($pending as $id => $list) {
                    $batch[$id] = array_shift($pending[$id]);
                    if (!$pending[$id]) {
                        unset($pending[$id]);
                    }
                }
                foreach ($this->headMany($batch) as $id => $ok) {
                    if ($ok) {
                        $out[$id] = $batch[$id];
                        unset($pending[$id]);
                    }
                }
            }
            return $out;
        })['data'];
    }

    /** @return list<string> candidate PDF URLs, most likely first */
    private function candidates(string $ext, string $name): array
    {
        $slugs = [];
        foreach ([$name, preg_split('/\s+[-–—]\s+/u', $name)[0]] as $part) {
            $b = self::slug($part);
            $slugs[] = $b;
            foreach (['the-', 'le-', 'la-', 'l-', 'les-'] as $pre) {
                if (str_starts_with($b, $pre)) {
                    $slugs[] = substr($b, strlen($pre));
                }
            }
            $slugs[] = str_ends_with($b, '-restaurant') ? substr($b, 0, -11) : $b . '-restaurant';
        }
        $urls = [];
        foreach (['en-gb', 'fr-fr'] as $lang) {
            foreach (array_unique(array_filter($slugs)) as $s) {
                $urls[] = sprintf(self::BASE, $lang, $ext, $s);
            }
        }
        return $urls;
    }

    private static function slug(string $s): string
    {
        $s = strtr(function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s), [
            'à' => 'a', 'â' => 'a', 'ä' => 'a', 'á' => 'a', 'ç' => 'c', 'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e',
            'î' => 'i', 'ï' => 'i', 'í' => 'i', 'ô' => 'o', 'ö' => 'o', 'ó' => 'o', 'û' => 'u', 'ü' => 'u', 'ù' => 'u', 'ú' => 'u',
            'ñ' => 'n', 'œ' => 'oe', '’' => '', "'" => '', '&' => 'and', '®' => '', '™' => '',
        ]);
        return trim((string) preg_replace('/[^a-z0-9]+/', '-', $s), '-');
    }

    /**
     * @param array<string, string> $urls key => url
     * @return array<string, bool> key => exists (200 + PDF)
     */
    private function headMany(array $urls): array
    {
        $out = [];
        foreach (array_chunk($urls, self::PARALLEL, true) as $chunk) {
            if (!function_exists('curl_multi_init')) {
                foreach ($chunk as $k => $u) {
                    $h = @get_headers($u, true, stream_context_create(['http' => ['method' => 'HEAD', 'timeout' => 10, 'header' => "User-Agent: {$this->userAgent}\r\n"]]));
                    $out[$k] = is_array($h) && str_contains((string) ($h[0] ?? ''), ' 200') && str_contains(strtolower(json_encode($h['Content-Type'] ?? '')), 'pdf');
                }
                continue;
            }
            $mh = curl_multi_init();
            $hs = [];
            foreach ($chunk as $k => $u) {
                $ch = curl_init($u);
                curl_setopt_array($ch, [
                    CURLOPT_NOBODY => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => false,
                    CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 10, CURLOPT_USERAGENT => $this->userAgent,
                ]);
                curl_multi_add_handle($mh, $ch);
                $hs[$k] = $ch;
            }
            do {
                $st = curl_multi_exec($mh, $running);
                if ($running) {
                    curl_multi_select($mh, 1.0);
                }
            } while ($running && $st === CURLM_OK);
            foreach ($hs as $k => $ch) {
                $out[$k] = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE) === 200
                    && str_contains(strtolower((string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE)), 'pdf');
                curl_multi_remove_handle($mh, $ch);
            }
            curl_multi_close($mh);
        }
        return $out;
    }
}
