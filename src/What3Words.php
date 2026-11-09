<?php

declare(strict_types=1);

namespace ParkPulse;

/**
 * what3words: coordinates → ///three.word.address, on demand only.
 * Needs a paid API key (the free plan has no convert-to-3wa). Results are NOT stored
 * server-side (the what3words licence restricts storing addresses with coordinates);
 * the app keeps them in memory for the session only.
 */
final class What3Words
{
    private const API = 'https://api.what3words.com/v3/convert-to-3wa';

    public function __construct(private Http $http, private string $key, private string $language = 'en')
    {
    }

    public function enabled(): bool
    {
        return $this->key !== '';
    }

    /** @return array{words:string, map:string, nearest:?string} */
    public function toWords(float $lat, float $lng): array
    {
        $url = self::API . '?' . http_build_query([
            'coordinates' => sprintf('%.6F,%.6F', $lat, $lng),
            'language'    => $this->language,
            'key'         => $this->key,
        ]);
        $d = $this->http->getJson($url);
        if (empty($d['words'])) {
            $err = $d['error']['message'] ?? 'no address returned';
            throw new UpstreamException('what3words: ' . $err);
        }
        return [
            'words'   => (string) $d['words'],
            'map'     => (string) ($d['map'] ?? ('https://w3w.co/' . $d['words'])),
            'nearest' => isset($d['nearestPlace']) ? (string) $d['nearestPlace'] : null,
        ];
    }
}
