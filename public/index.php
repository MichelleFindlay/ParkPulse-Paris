<?php

declare(strict_types=1);

// When used as the router for `php -S` (php -S localhost:8000 -t public public/index.php),
// let the built-in server deliver real files itself.
if (PHP_SAPI === 'cli-server') {
    $file = realpath(__DIR__ . (string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH));
    if ($file !== false && is_file($file) && str_starts_with($file, __DIR__ . DIRECTORY_SEPARATOR) && $file !== __FILE__) {
        return false;
    }
}

$config = require dirname(__DIR__) . '/src/bootstrap.php';

try {
    $app = new ParkPulse\App($config);
} catch (Throwable $e) {
    // Usually an unwritable data/ directory on a fresh host.
    error_log('[park-pulse] ' . $e);
    ParkPulse\App::isolationHeaders();
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    exit('Park Pulse could not start: ' . $e->getMessage());
}

$app->run();
