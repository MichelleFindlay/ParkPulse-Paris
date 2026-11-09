<?php

declare(strict_types=1);

namespace ParkPulse;

final class Text
{
    private const FOLD = [
        'à' => 'a', 'â' => 'a', 'ä' => 'a', 'á' => 'a', 'ã' => 'a', 'å' => 'a',
        'ç' => 'c',
        'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e',
        'î' => 'i', 'ï' => 'i', 'í' => 'i', 'ì' => 'i',
        'ñ' => 'n',
        'ô' => 'o', 'ö' => 'o', 'ó' => 'o', 'ò' => 'o', 'õ' => 'o',
        'û' => 'u', 'ü' => 'u', 'ú' => 'u', 'ù' => 'u',
        'ÿ' => 'y', 'œ' => 'oe', 'æ' => 'ae',
        '™' => '', '®' => '', '©' => '', '*' => '',
        '’' => "'", '‘' => "'", '“' => '"', '”' => '"', '–' => '-', '—' => '-',
    ];

    /**
     * Normalise an attraction/park name so the two APIs' spellings line up:
     * "Autopia, presented by Avis" and "Autopia" both become "autopia".
     */
    public static function norm(string $s): string
    {
        $s = function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s);
        $s = strtr($s, self::FOLD);
        $s = (string) preg_replace('/,?\s+presented by\b.*$/u', '', $s);
        $s = (string) preg_replace('/[^a-z0-9]+/', ' ', $s);
        return trim($s);
    }

    /** Tidy a display name from the API (drops the stray trailing "*" some entries carry). */
    public static function displayName(string $s): string
    {
        return trim(rtrim(trim($s), '*'));
    }
}
