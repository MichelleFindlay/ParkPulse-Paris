<?php

declare(strict_types=1);

namespace ParkPulse;

final class Router
{
    /** @var list<array{string, string, callable}> */
    private array $routes = [];

    /** $pattern is a regex body; named groups are passed to the handler as an array. */
    public function add(string $method, string $pattern, callable $handler): self
    {
        $this->routes[] = [$method, '#^' . $pattern . '$#', $handler];
        return $this;
    }

    public function dispatch(string $method, string $path): mixed
    {
        $allowed = [];
        foreach ($this->routes as [$m, $regex, $handler]) {
            if (!preg_match($regex, $path, $match)) {
                continue;
            }
            if ($m !== $method) {
                $allowed[] = $m;
                continue;
            }
            $params = array_filter($match, 'is_string', ARRAY_FILTER_USE_KEY);
            return $handler($params);
        }
        if ($allowed) {
            header('Allow: ' . implode(', ', array_unique($allowed)));
            throw new HttpError(405, 'Method not allowed');
        }
        throw new HttpError(404, 'Not found');
    }
}
