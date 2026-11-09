<?php

declare(strict_types=1);

namespace ParkPulse;

final class Db
{
    private const MIGRATIONS = [
        1 => [
            'CREATE TABLE IF NOT EXISTS cache (
                key        TEXT PRIMARY KEY,
                body       TEXT NOT NULL,
                fetched_at INTEGER NOT NULL
            )',
            'CREATE TABLE IF NOT EXISTS meta (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )',
            'CREATE TABLE IF NOT EXISTS wait_history (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                park_key  TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                ts        INTEGER NOT NULL,
                day       TEXT NOT NULL,
                hour      INTEGER NOT NULL,
                status    TEXT NOT NULL,
                wait      INTEGER
            )',
            'CREATE INDEX IF NOT EXISTS wait_history_entity ON wait_history (entity_id, ts)',
            'CREATE INDEX IF NOT EXISTS wait_history_park ON wait_history (park_key, ts)',
            'CREATE TABLE IF NOT EXISTS favourites (
                entity_id  TEXT PRIMARY KEY,
                park_key   TEXT NOT NULL,
                name       TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )',
            'CREATE TABLE IF NOT EXISTS ride_log (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_id    TEXT NOT NULL,
                park_key     TEXT NOT NULL,
                name         TEXT NOT NULL,
                ridden_at    INTEGER NOT NULL,
                wait_minutes INTEGER,
                queue_type   TEXT NOT NULL DEFAULT \'STANDBY\',
                note         TEXT NOT NULL DEFAULT \'\'
            )',
            'CREATE INDEX IF NOT EXISTS ride_log_time ON ride_log (ridden_at)',
        ],
        // OIDC: remember who logged each ride.
        2 => [
            'ALTER TABLE ride_log ADD COLUMN user_sub TEXT',
            'ALTER TABLE ride_log ADD COLUMN user_name TEXT',
        ],
        // Downtime tracking: current status per ride + every status change.
        3 => [
            'CREATE TABLE IF NOT EXISTS entity_state (
                entity_id TEXT PRIMARY KEY,
                park_key  TEXT NOT NULL,
                status    TEXT NOT NULL,
                since     INTEGER,
                updated   INTEGER NOT NULL
            )',
            'CREATE TABLE IF NOT EXISTS status_events (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                park_key    TEXT NOT NULL,
                entity_id   TEXT NOT NULL,
                ts          INTEGER NOT NULL,
                from_status TEXT NOT NULL,
                to_status   TEXT NOT NULL
            )',
            'CREATE INDEX IF NOT EXISTS status_events_park ON status_events (park_key, ts)',
        ],
        // Push notifications, bookings, party locations, Premier Access history.
        4 => [
            'CREATE TABLE IF NOT EXISTS push_subs (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                endpoint   TEXT NOT NULL UNIQUE,
                p256dh     TEXT NOT NULL,
                auth       TEXT NOT NULL,
                device     TEXT NOT NULL,
                user_sub   TEXT,
                user_name  TEXT,
                prefs      TEXT NOT NULL DEFAULT \'{}\',
                created_at INTEGER NOT NULL,
                last_ok    INTEGER
            )',
            'CREATE TABLE IF NOT EXISTS push_alerts (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                sub_id      INTEGER NOT NULL,
                entity_id   TEXT NOT NULL,
                park_key    TEXT NOT NULL,
                name        TEXT NOT NULL,
                reopen      INTEGER NOT NULL DEFAULT 0,
                down        INTEGER NOT NULL DEFAULT 0,
                max_wait    INTEGER,
                last_status TEXT,
                last_wait   INTEGER,
                UNIQUE (sub_id, entity_id)
            )',
            'CREATE TABLE IF NOT EXISTS push_sent (
                key TEXT PRIMARY KEY,
                ts  INTEGER NOT NULL
            )',
            'CREATE TABLE IF NOT EXISTS bookings (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                kind       TEXT NOT NULL,
                name       TEXT NOT NULL,
                entity_id  TEXT,
                park_key   TEXT,
                at         INTEGER NOT NULL,
                ends_at    INTEGER,
                note       TEXT NOT NULL DEFAULT \'\',
                created_by TEXT,
                created_at INTEGER NOT NULL
            )',
            'CREATE INDEX IF NOT EXISTS bookings_at ON bookings (at)',
            'CREATE TABLE IF NOT EXISTS party_locations (
                device  TEXT PRIMARY KEY,
                name    TEXT NOT NULL,
                lat     REAL NOT NULL,
                lng     REAL NOT NULL,
                acc     REAL,
                ts      INTEGER NOT NULL
            )',
            'CREATE TABLE IF NOT EXISTS meet_pin (
                id    INTEGER PRIMARY KEY CHECK (id = 1),
                lat   REAL NOT NULL,
                lng   REAL NOT NULL,
                label  TEXT NOT NULL,
                set_by TEXT,
                ts    INTEGER NOT NULL
            )',
            'CREATE TABLE IF NOT EXISTS pa_history (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_id    TEXT NOT NULL,
                ts           INTEGER NOT NULL,
                day          TEXT NOT NULL,
                state        TEXT,
                return_start INTEGER
            )',
            'CREATE INDEX IF NOT EXISTS pa_history_entity ON pa_history (entity_id, ts)',
        ],
        // Today's saved day plan per phone (server warns if a planned ride goes down).
        5 => [
            'ALTER TABLE push_subs ADD COLUMN plan TEXT',
        ],
        // Party ratings for restaurants (one per phone per place).
        6 => [
            'CREATE TABLE IF NOT EXISTS ratings (
                entity_id TEXT NOT NULL,
                device    TEXT NOT NULL,
                name      TEXT NOT NULL,
                stars     INTEGER NOT NULL,
                note      TEXT NOT NULL DEFAULT \'\',
                by_name   TEXT,
                ts        INTEGER NOT NULL,
                PRIMARY KEY (entity_id, device)
            )',
        ],
        // PIN mode: named profiles so each person has an identity (like SSO users).
        7 => [
            'CREATE TABLE IF NOT EXISTS profiles (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT NOT NULL COLLATE NOCASE UNIQUE,
                emoji      TEXT NOT NULL DEFAULT \'🙂\',
                created_at INTEGER NOT NULL,
                last_seen  INTEGER
            )',
        ],
        // Profile picture / emoji for each signed-in person (SSO subject or "pin:<profile id>").
        8 => [
            'CREATE TABLE IF NOT EXISTS avatars (
                sub     TEXT PRIMARY KEY,
                emoji   TEXT,
                image   TEXT,
                updated INTEGER NOT NULL
            )',
        ],
        // The day plan is shared by the whole party (one plan, everyone sees it), not just
        // the phone that built it. push_subs.plan (migration 5) stays — it's the per-phone
        // copy the notifier reads to warn that phone about its own upcoming rides.
        9 => [
            'CREATE TABLE IF NOT EXISTS day_plan (
                id     INTEGER PRIMARY KEY CHECK (id = 1),
                plan   TEXT NOT NULL,
                set_by TEXT,
                ts     INTEGER NOT NULL
            )',
        ],
        // Shows people watched. Separate from ride_log so they never count as rides.
        10 => [
            'CREATE TABLE IF NOT EXISTS show_log (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_id  TEXT NOT NULL,
                park_key   TEXT NOT NULL,
                name       TEXT NOT NULL,
                watched_at INTEGER NOT NULL,
                note       TEXT NOT NULL DEFAULT \'\',
                user_sub   TEXT,
                user_name  TEXT
            )',
            'CREATE INDEX IF NOT EXISTS show_log_time ON show_log (watched_at)',
        ],
        // Trips to the resort. `snapshot` holds what Wrapped can't rebuild once a visit is long over.
        11 => [
            'CREATE TABLE IF NOT EXISTS visits (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT NOT NULL DEFAULT \'\',
                start_date TEXT NOT NULL,
                end_date   TEXT NOT NULL,
                snapshot   TEXT,
                created_by TEXT,
                created_at INTEGER NOT NULL
            )',
        ],
        // Everything the parks have listed, and the days each show ran (upstream forgets them).
        12 => [
            'CREATE TABLE IF NOT EXISTS catalog (
                entity_id  TEXT PRIMARY KEY,
                park_key   TEXT NOT NULL,
                type       TEXT NOT NULL,
                name       TEXT NOT NULL,
                first_seen TEXT NOT NULL,
                last_seen  TEXT NOT NULL,
                baseline   INTEGER NOT NULL DEFAULT 0,
                status     TEXT NOT NULL DEFAULT \'active\'
            )',
            'CREATE TABLE IF NOT EXISTS show_days (
                entity_id TEXT NOT NULL,
                day       TEXT NOT NULL,
                times     TEXT NOT NULL,
                PRIMARY KEY (entity_id, day)
            )',
            'CREATE INDEX IF NOT EXISTS show_days_day ON show_days (day)',
        ],
        // Where people ate and shopped. Separate from ride_log so they never count as rides.
        13 => [
            'CREATE TABLE IF NOT EXISTS place_log (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                kind       TEXT NOT NULL,
                entity_id  TEXT NOT NULL,
                park_key   TEXT NOT NULL,
                name       TEXT NOT NULL,
                visited_at INTEGER NOT NULL,
                note       TEXT NOT NULL DEFAULT \'\',
                user_sub   TEXT,
                user_name  TEXT
            )',
            'CREATE INDEX IF NOT EXISTS place_log_time ON place_log (visited_at)',
        ],
        // Queue timer (what the sign said), spend tracker, character collection.
        // Photos sit apart so reading the log never loads them.
        14 => [
            'ALTER TABLE ride_log ADD COLUMN posted_wait INTEGER',
            'ALTER TABLE place_log ADD COLUMN amount_cents INTEGER',
            'ALTER TABLE visits ADD COLUMN budget_cents INTEGER',
            'CREATE TABLE IF NOT EXISTS character_log (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                name      TEXT NOT NULL,
                met_at    INTEGER NOT NULL,
                note      TEXT NOT NULL DEFAULT \'\',
                user_sub  TEXT,
                user_name TEXT
            )',
            'CREATE INDEX IF NOT EXISTS character_log_time ON character_log (met_at)',
            'CREATE TABLE IF NOT EXISTS character_photos (
                log_id INTEGER PRIMARY KEY,
                image  BLOB NOT NULL
            )',
        ],
        // Characters can be seen from a distance as well as met.
        15 => [
            'ALTER TABLE character_log ADD COLUMN kind TEXT NOT NULL DEFAULT \'met\'',
        ],
    ];

    public static function connect(string $path): \PDO
    {
        $dir = dirname($path);
        if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new \RuntimeException("Cannot create data directory: $dir");
        }
        if (!is_writable($dir)) {
            throw new \RuntimeException("Data directory is not writable: $dir");
        }

        $pdo = new \PDO('sqlite:' . $path, null, null, [
            \PDO::ATTR_ERRMODE            => \PDO::ERRMODE_EXCEPTION,
            \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
        ]);
        $pdo->exec('PRAGMA busy_timeout = 5000');
        try {
            // WAL lets the auto-refresh reads run alongside writes. Some shared hosts
            // (network filesystems) refuse it; the default journal works fine too.
            $pdo->exec('PRAGMA journal_mode = WAL');
        } catch (\PDOException) {
        }

        self::migrate($pdo);

        return $pdo;
    }

    private static function migrate(\PDO $pdo): void
    {
        $version = (int) $pdo->query('PRAGMA user_version')->fetchColumn();
        foreach (self::MIGRATIONS as $target => $statements) {
            if ($target <= $version) {
                continue;
            }
            $pdo->beginTransaction();
            try {
                foreach ($statements as $sql) {
                    $pdo->exec($sql);
                }
                $pdo->exec('PRAGMA user_version = ' . (int) $target);
                $pdo->commit();
            } catch (\Throwable $e) {
                $pdo->rollBack();
                throw $e;
            }
        }
    }
}
