<?php

declare(strict_types=1);

namespace ParkPulse;

/**
 * Live RER A info at Marne-la-Vallée–Chessy from Île-de-France Mobilités' PRIM
 * API (SIRI Lite). Needs a free API key; disabled without one.
 */
final class Transit
{
    private const BASE = 'https://prim.iledefrance-mobilites.fr/marketplace';

    public function __construct(private Http $http, private Cache $cache, private array $cfg, private string $apiKey)
    {
    }

    public function enabled(): bool
    {
        return $this->apiKey !== '';
    }

    public function status(): array
    {
        $out = [
            'enabled'    => $this->enabled(),
            'label'      => $this->cfg['label'],
            'departures' => [],
            'messages'   => [],
            'errors'     => [],
            'fetchedAt'  => time(),
        ];
        if (!$this->enabled()) {
            return $out;
        }
        $headers = ['apikey: ' . $this->apiKey];
        $stopRef = 'STIF:StopArea:SP:' . $this->cfg['stop_area'] . ':';
        $lineRef = 'STIF:Line::' . $this->cfg['line'] . ':';

        try {
            $url = self::BASE . '/stop-monitoring?' . http_build_query(['MonitoringRef' => $stopRef]);
            $env = $this->cache->remember('prim:stop:' . $stopRef, 60, fn () => $this->http->getJson($url, $headers));
            $out['departures'] = $this->departures($env['data'], $lineRef);
            $out['fetchedAt'] = $env['fetchedAt'];
        } catch (\Throwable $e) {
            $out['errors'][] = 'Departures: ' . $e->getMessage();
        }

        try {
            $url = self::BASE . '/general-message?' . http_build_query(['LineRef' => $lineRef]);
            $env = $this->cache->remember('prim:msg:' . $lineRef, 300, fn () => $this->http->getJson($url, $headers));
            $out['messages'] = $this->messages($env['data']);
        } catch (\Throwable $e) {
            $out['errors'][] = 'Traffic info: ' . $e->getMessage();
        }

        return $out;
    }

    private function departures(array $siri, string $lineRef): array
    {
        $visits = $siri['Siri']['ServiceDelivery']['StopMonitoringDelivery'][0]['MonitoredStopVisit'] ?? [];
        $out = [];
        foreach ($visits as $v) {
            $j = $v['MonitoredVehicleJourney'] ?? [];
            if (($j['LineRef']['value'] ?? $lineRef) !== $lineRef) {
                continue;
            }
            $call = $j['MonitoredCall'] ?? [];
            $expected = $call['ExpectedDepartureTime'] ?? $call['ExpectedArrivalTime'] ?? null;
            $aimed = $call['AimedDepartureTime'] ?? $call['AimedArrivalTime'] ?? null;
            $time = $expected ?? $aimed;
            if ($time === null || strtotime($time) < time() - 60) {
                continue;
            }
            $delay = ($expected && $aimed) ? (int) round((strtotime($expected) - strtotime($aimed)) / 60) : 0;
            $out[] = [
                'time'        => $time,
                'aimed'       => $aimed,
                'delay'       => $delay,
                'destination' => self::value($j['DestinationName'] ?? null) ?? self::value($call['DestinationDisplay'] ?? null) ?? '',
                'platform'    => self::value($call['ArrivalPlatformName'] ?? null) ?? self::value($call['DeparturePlatformName'] ?? null),
                'status'      => (string) ($call['DepartureStatus'] ?? $call['ArrivalStatus'] ?? ''),
                'code'        => self::value($j['JourneyNote'] ?? null), // RER mission code, e.g. "QIKY"
            ];
        }
        usort($out, fn ($a, $b) => strcmp($a['time'], $b['time']));
        return array_slice($out, 0, 8);
    }

    private function messages(array $siri): array
    {
        $msgs = $siri['Siri']['ServiceDelivery']['GeneralMessageDelivery'][0]['InfoMessage'] ?? [];
        $out = [];
        foreach ($msgs as $m) {
            if (!empty($m['ValidUntilTime']) && strtotime($m['ValidUntilTime']) < time()) {
                continue;
            }
            $text = null;
            foreach ($m['Content']['Message'] ?? [] as $part) {
                $t = self::value($part['MessageText'] ?? null);
                if ($t !== null && ($text === null || strlen($t) > strlen($text))) {
                    $text = $t; // the longest variant is the full message
                }
            }
            if ($text === null) {
                continue;
            }
            $channel = (string) ($m['InfoChannelRef']['value'] ?? '');
            $out[] = [
                'severity' => $channel === 'Perturbation' ? 'disruption' : 'info',
                'text'     => trim(strip_tags($text)),
                'until'    => $m['ValidUntilTime'] ?? null,
            ];
        }
        usort($out, fn ($a, $b) => ($a['severity'] === 'disruption' ? 0 : 1) <=> ($b['severity'] === 'disruption' ? 0 : 1));
        return array_slice($out, 0, 6);
    }

    /** SIRI Lite wraps strings as {"value": "…"} or [{"value": "…"}]. */
    private static function value(mixed $v): ?string
    {
        if (is_string($v)) {
            return $v;
        }
        if (is_array($v)) {
            if (isset($v['value']) && is_string($v['value'])) {
                return $v['value'];
            }
            if (isset($v[0])) {
                return self::value($v[0]);
            }
        }
        return null;
    }
}
