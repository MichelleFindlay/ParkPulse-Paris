<?php

declare(strict_types=1);

namespace ParkPulse;

/** Open-Meteo forecast for the resort (free, no key). */
final class Weather
{
    private const TTL = 1200;

    /** WMO weather code → [label, emoji]. */
    private const CODES = [
        0 => ['Clear', '☀️'], 1 => ['Mostly clear', '🌤️'], 2 => ['Partly cloudy', '⛅'], 3 => ['Overcast', '☁️'],
        45 => ['Fog', '🌫️'], 48 => ['Freezing fog', '🌫️'],
        51 => ['Light drizzle', '🌦️'], 53 => ['Drizzle', '🌦️'], 55 => ['Heavy drizzle', '🌧️'],
        56 => ['Freezing drizzle', '🌧️'], 57 => ['Freezing drizzle', '🌧️'],
        61 => ['Light rain', '🌦️'], 63 => ['Rain', '🌧️'], 65 => ['Heavy rain', '🌧️'],
        66 => ['Freezing rain', '🌧️'], 67 => ['Freezing rain', '🌧️'],
        71 => ['Light snow', '🌨️'], 73 => ['Snow', '🌨️'], 75 => ['Heavy snow', '❄️'], 77 => ['Snow grains', '🌨️'],
        80 => ['Light showers', '🌦️'], 81 => ['Showers', '🌧️'], 82 => ['Violent showers', '⛈️'],
        85 => ['Snow showers', '🌨️'], 86 => ['Heavy snow showers', '❄️'],
        95 => ['Thunderstorm', '⛈️'], 96 => ['Thunderstorm, hail', '⛈️'], 99 => ['Thunderstorm, hail', '⛈️'],
    ];

    public function __construct(
        private Http $http,
        private Cache $cache,
        private string $timezone,
        private float $lat,
        private float $lng,
    ) {
    }

    public function forecast(): array
    {
        $url = 'https://api.open-meteo.com/v1/forecast?' . http_build_query([
            'latitude'      => round($this->lat, 4),
            'longitude'     => round($this->lng, 4),
            'current'       => 'temperature_2m,apparent_temperature,weather_code,precipitation,wind_speed_10m,wind_gusts_10m',
            'hourly'        => 'temperature_2m,precipitation_probability,precipitation,weather_code,wind_gusts_10m',
            'daily'         => 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset,wind_gusts_10m_max',
            'timezone'      => $this->timezone,
            'forecast_days' => 16,
        ]);
        $env = $this->cache->remember('weather:' . sha1($url), self::TTL, fn () => $this->http->getJson($url));
        $d = $env['data'];

        $c = $d['current'] ?? [];
        $current = isset($c['temperature_2m']) ? [
            'temp'   => round((float) $c['temperature_2m']),
            'feels'  => isset($c['apparent_temperature']) ? round((float) $c['apparent_temperature']) : null,
            'precip' => (float) ($c['precipitation'] ?? 0),
            'wind'   => (int) round((float) ($c['wind_speed_10m'] ?? 0)),
            'gusts'  => (int) round((float) ($c['wind_gusts_10m'] ?? 0)),
        ] + $this->code((int) ($c['weather_code'] ?? -1)) : null;

        // Next 24 hours from the current hour (Open-Meteo times are park-local, no offset).
        $hourly = [];
        $h = $d['hourly'] ?? [];
        $nowHour = (new \DateTimeImmutable('now', new \DateTimeZone($this->timezone)))->format('Y-m-d\TH:00');
        foreach ($h['time'] ?? [] as $i => $t) {
            if ($t < $nowHour || count($hourly) >= 24) {
                continue;
            }
            $hourly[] = [
                'time'   => $t,
                'temp'   => round((float) ($h['temperature_2m'][$i] ?? 0)),
                'pop'    => isset($h['precipitation_probability'][$i]) ? (int) $h['precipitation_probability'][$i] : null,
                'precip' => (float) ($h['precipitation'][$i] ?? 0),
                'gusts'  => (int) round((float) ($h['wind_gusts_10m'][$i] ?? 0)),
            ] + $this->code((int) ($h['weather_code'][$i] ?? -1));
        }

        $daily = [];
        $dd = $d['daily'] ?? [];
        foreach ($dd['time'] ?? [] as $i => $date) {
            $daily[$date] = [
                'date'    => $date,
                'max'     => round((float) ($dd['temperature_2m_max'][$i] ?? 0)),
                'min'     => round((float) ($dd['temperature_2m_min'][$i] ?? 0)),
                'pop'     => isset($dd['precipitation_probability_max'][$i]) ? (int) $dd['precipitation_probability_max'][$i] : null,
                'precip'  => (float) ($dd['precipitation_sum'][$i] ?? 0),
                'sunrise' => $dd['sunrise'][$i] ?? null,
                'sunset'  => $dd['sunset'][$i] ?? null,
                'gusts'   => (int) round((float) ($dd['wind_gusts_10m_max'][$i] ?? 0)),
            ] + $this->code((int) ($dd['weather_code'][$i] ?? -1));
        }

        return [
            'current'   => $current,
            'hourly'    => $hourly,
            'daily'     => $daily,
            'alerts'    => $this->alerts($current, $hourly),
            'fetchedAt' => $env['fetchedAt'],
            'stale'     => $env['stale'],
        ];
    }

    /** Short practical heads-ups for the next few hours. */
    private function alerts(?array $current, array $hourly): array
    {
        $out = [];
        $next = array_slice($hourly, 0, 4);
        foreach ($next as $h) {
            if (($h['pop'] ?? 0) >= 60 && $h['precip'] >= 0.3) {
                $out[] = ['kind' => 'rain', 'text' => 'Rain likely around ' . substr($h['time'], 11, 5) . ' — good time for indoor rides and shows.'];
                break;
            }
        }
        $gusts = max(array_merge([$current['gusts'] ?? 0], array_column($next, 'gusts')));
        if ($gusts >= 50) {
            $out[] = ['kind' => 'wind', 'text' => "Gusts up to $gusts km/h — tall outdoor rides and fireworks can pause in strong wind."];
        }
        foreach ($next as $h) {
            if ($h['code'] >= 95) {
                $out[] = ['kind' => 'storm', 'text' => 'Thunderstorms possible — outdoor rides close during lightning.'];
                break;
            }
        }
        if ($current !== null && $current['temp'] <= 2) {
            $out[] = ['kind' => 'cold', 'text' => 'Near freezing — layers, gloves and hot chocolate.'];
        }
        return $out;
    }

    private function code(int $code): array
    {
        [$label, $icon] = self::CODES[$code] ?? ['—', '🌡️'];
        return ['code' => $code, 'label' => $label, 'icon' => $icon];
    }
}
