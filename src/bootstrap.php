<?php

declare(strict_types=1);

if (PHP_VERSION_ID < 80200) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    exit('Park Pulse needs PHP 8.2 or newer (running ' . PHP_VERSION . ').');
}

if (!extension_loaded('pdo_sqlite')) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    exit('Park Pulse needs the pdo_sqlite PHP extension.');
}

$root = dirname(__DIR__);

if (is_file($root . '/vendor/autoload.php')) {
    require $root . '/vendor/autoload.php';
} else {
    spl_autoload_register(static function (string $class): void {
        $prefix = 'ParkPulse\\';
        if (!str_starts_with($class, $prefix)) {
            return;
        }
        $file = __DIR__ . '/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
        if (is_file($file)) {
            require $file;
        }
    });
}

$config = require $root . (is_file($root . '/config.php') ? '/config.php' : '/config.example.php');
if (is_file($root . '/config.local.php')) {
    $local = require $root . '/config.local.php';
    if (is_array($local)) {
        $config = array_replace_recursive($config, $local);
    }
}

date_default_timezone_set($config['timezone']);

return $config;
