<?php

declare(strict_types=1);

namespace ParkPulse;

/** Tiny JSON-over-HTTP client. Uses curl (parallel) when available, streams otherwise. */
final class Http
{
    private const PARALLEL = 8;

    public function __construct(private string $userAgent, private int $timeout = 8)
    {
    }

    /** @param list<string> $headers extra "Name: value" request headers */
    public function getJson(string $url, array $headers = []): array
    {
        if ($headers) {
            return $this->single('GET', $url, null, $headers);
        }
        $result = $this->multi(['only' => $url])['only'];
        if ($result instanceof \Throwable) {
            throw $result;
        }
        return $result;
    }

    /**
     * POST application/x-www-form-urlencoded and decode the JSON reply (OIDC token endpoint).
     *
     * @param array<string, string> $fields
     * @param list<string> $headers
     */
    public function postForm(string $url, array $fields, array $headers = [], ?int $timeout = null): array
    {
        $headers[] = 'Content-Type: application/x-www-form-urlencoded';
        return $this->single('POST', $url, http_build_query($fields, '', '&', PHP_QUERY_RFC1738), $headers, $timeout);
    }

    /**
     * Fetch several URLs. Failures come back as exceptions in the result, never thrown.
     *
     * @param array<array-key, string> $urls
     * @return array<array-key, array|UpstreamException>
     */
    public function multi(array $urls): array
    {
        $out = [];
        if (!function_exists('curl_multi_init')) {
            foreach ($urls as $k => $url) {
                $out[$k] = $this->streamRequest('GET', $url, null, []);
            }
            return $out;
        }

        foreach (array_chunk($urls, self::PARALLEL, true) as $chunk) {
            $mh = curl_multi_init();
            $handles = [];
            foreach ($chunk as $k => $url) {
                $ch = $this->curlHandle('GET', $url, null, []);
                curl_multi_add_handle($mh, $ch);
                $handles[$k] = $ch;
            }

            do {
                $status = curl_multi_exec($mh, $running);
                if ($running) {
                    curl_multi_select($mh, 1.0);
                }
            } while ($running && $status === CURLM_OK);

            foreach ($handles as $k => $ch) {
                $body = curl_multi_getcontent($ch);
                $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
                $err  = curl_error($ch);
                curl_multi_remove_handle($mh, $ch);
                $out[$k] = $this->decode($chunk[$k], is_string($body) ? $body : '', $code, $err);
            }
            curl_multi_close($mh);
        }

        return $out;
    }

    /** @param list<string> $headers */
    private function single(string $method, string $url, ?string $body, array $headers, ?int $timeout = null): array
    {
        if (function_exists('curl_init')) {
            $ch = $this->curlHandle($method, $url, $body, $headers, $timeout);
            $resp = curl_exec($ch);
            $result = $this->decode(
                $url,
                is_string($resp) ? $resp : '',
                (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE),
                curl_error($ch),
            );
        } else {
            $result = $this->streamRequest($method, $url, $body, $headers, $timeout);
        }
        if ($result instanceof \Throwable) {
            throw $result;
        }
        return $result;
    }

    /**
     * @param list<string> $headers
     * @return \CurlHandle
     */
    private function curlHandle(string $method, string $url, ?string $body, array $headers, ?int $timeout = null)
    {
        $ch = curl_init($url);
        $opts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => $method === 'GET',
            CURLOPT_MAXREDIRS      => 3,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT        => $timeout ?? $this->timeout,
            CURLOPT_USERAGENT      => $this->userAgent,
            CURLOPT_HTTPHEADER     => array_merge(['Accept: application/json'], $headers),
            CURLOPT_ENCODING       => '',
        ];
        if ($method === 'POST') {
            $opts[CURLOPT_POST] = true;
            $opts[CURLOPT_POSTFIELDS] = $body ?? '';
        }
        curl_setopt_array($ch, $opts);
        return $ch;
    }

    /** @param list<string> $headers */
    private function streamRequest(string $method, string $url, ?string $body, array $headers, ?int $timeout = null): array|UpstreamException
    {
        $headerLines = array_merge(['Accept: application/json', "User-Agent: {$this->userAgent}"], $headers);
        $http = [
            'method'        => $method,
            'timeout'       => $timeout ?? $this->timeout,
            'ignore_errors' => true,
            'header'        => implode("\r\n", $headerLines) . "\r\n",
        ];
        if ($body !== null) {
            $http['content'] = $body;
        }
        $resp = @file_get_contents($url, false, stream_context_create(['http' => $http]));
        $responseHeaders = function_exists('http_get_last_response_headers')
            ? (http_get_last_response_headers() ?? [])
            : ($http_response_header ?? []);
        $code = 0;
        foreach ($responseHeaders as $line) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m)) {
                $code = (int) $m[1]; // last status line wins (after redirects)
            }
        }
        return $this->decode($url, $resp === false ? '' : $resp, $code, $resp === false ? 'request failed' : '');
    }

    private function decode(string $url, string $body, int $code, string $err): array|UpstreamException
    {
        $host = parse_url($url, PHP_URL_HOST) ?: $url;
        if ($err !== '') {
            return new UpstreamException("$host: $err");
        }
        $data = json_decode($body, true);
        if ($code < 200 || $code >= 300) {
            // OAuth endpoints explain failures in {"error": ..., "error_description": ...}.
            $why = '';
            if (is_array($data)) {
                $err = $data['error'] ?? '';
                // OAuth style {"error": "x", "error_description": "y"} or nested {"error": {"code", "message"}}.
                $why = is_array($err)
                    ? trim((string) ($err['code'] ?? '') . ' ' . (string) ($err['message'] ?? ''))
                    : trim((string) $err . ' ' . (string) ($data['error_description'] ?? ''));
            }
            return new UpstreamException("$host: HTTP $code" . ($why !== '' ? " ($why)" : ''));
        }
        if (!is_array($data)) {
            return new UpstreamException("$host: invalid JSON");
        }
        return $data;
    }
}
