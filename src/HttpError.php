<?php

declare(strict_types=1);

namespace ParkPulse;

/** An error that maps straight to an HTTP status for the JSON API. */
final class HttpError extends \RuntimeException
{
    public function __construct(public readonly int $status, string $message)
    {
        parent::__construct($message, $status);
    }
}
