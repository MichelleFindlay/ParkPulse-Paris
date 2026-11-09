<?php

declare(strict_types=1);

/*
 * Park Pulse data collector. Run every 5 minutes so wait history, downtime and the
 * crowd meter keep building even when nobody has the app open:
 *
 *   cPanel → Cron Jobs → every 5 minutes:
 *   php /home/USER/path/to/park-pulse/bin/collect.php >/dev/null 2>&1
 *
 * (Use the full PHP 8.2+ path your host lists, e.g. /usr/local/bin/ea-php82.)
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$config = require dirname(__DIR__) . '/src/bootstrap.php';

$app = new ParkPulse\App($config);
echo json_encode($app->collect(), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), PHP_EOL;
