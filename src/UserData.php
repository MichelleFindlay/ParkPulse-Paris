<?php

declare(strict_types=1);

namespace ParkPulse;

/**
 * Must-do list and ride log, shared by the whole party. With OIDC each ride
 * entry records who logged it, so the Mine tab can show "just me" or everyone.
 */
final class UserData
{
    public const QUEUE_TYPES = ['STANDBY', 'SINGLE_RIDER', 'PREMIER_ACCESS', 'OTHER'];
    public const AREAS = ['dlp', 'studios', 'village'];
    public const PLACE_KINDS = ['food', 'shop', 'browse'];
    public const CHARACTER_KINDS = ['met', 'seen'];

    public function __construct(private \PDO $db, private \DateTimeZone $tz)
    {
    }

    public function me(?array $user): array
    {
        $favs = $this->db->query(
            'SELECT entity_id AS id, park_key AS park, name, created_at AS createdAt FROM favourites ORDER BY park_key, name'
        )->fetchAll();

        $log = [];
        foreach ($this->db->query('SELECT * FROM ride_log ORDER BY ridden_at DESC, id DESC') as $r) {
            $log[] = [
                'id'        => (int) $r['id'],
                'entityId'  => $r['entity_id'],
                'park'      => $r['park_key'],
                'name'      => $r['name'],
                'riddenAt'  => (int) $r['ridden_at'],
                'day'       => (new \DateTimeImmutable('@' . $r['ridden_at']))->setTimezone($this->tz)->format('Y-m-d'),
                'wait'      => $r['wait_minutes'] === null ? null : (int) $r['wait_minutes'],
                'posted'    => $r['posted_wait'] === null ? null : (int) $r['posted_wait'],
                'queueType' => $r['queue_type'],
                'note'      => $r['note'],
                'by'        => $r['user_name'],
                'mine'      => $user !== null && $r['user_sub'] === $user['sub'],
            ];
        }

        $shows = [];
        foreach ($this->db->query('SELECT * FROM show_log ORDER BY watched_at DESC, id DESC') as $r) {
            $shows[] = [
                'id'        => (int) $r['id'],
                'entityId'  => $r['entity_id'],
                'park'      => $r['park_key'],
                'name'      => $r['name'],
                'watchedAt' => (int) $r['watched_at'],
                'day'       => (new \DateTimeImmutable('@' . $r['watched_at']))->setTimezone($this->tz)->format('Y-m-d'),
                'note'      => $r['note'],
                'by'        => $r['user_name'],
                'mine'      => $user !== null && $r['user_sub'] === $user['sub'],
            ];
        }

        $places = [];
        foreach ($this->db->query('SELECT * FROM place_log ORDER BY visited_at DESC, id DESC') as $r) {
            $places[] = [
                'id'        => (int) $r['id'],
                'kind'      => $r['kind'],
                'entityId'  => $r['entity_id'],
                'park'      => $r['park_key'],
                'name'      => $r['name'],
                'visitedAt' => (int) $r['visited_at'],
                'day'       => (new \DateTimeImmutable('@' . $r['visited_at']))->setTimezone($this->tz)->format('Y-m-d'),
                'note'      => $r['note'],
                'amountCents' => $r['amount_cents'] === null ? null : (int) $r['amount_cents'],
                'by'        => $r['user_name'],
                'mine'      => $user !== null && $r['user_sub'] === $user['sub'],
            ];
        }

        $characters = [];
        foreach ($this->db->query(
            'SELECT l.*, EXISTS (SELECT 1 FROM character_photos p WHERE p.log_id = l.id) AS has_photo
             FROM character_log l ORDER BY l.met_at DESC, l.id DESC'
        ) as $r) {
            $characters[] = [
                'id'    => (int) $r['id'],
                'name'  => $r['name'],
                'kind'  => $r['kind'],
                'metAt' => (int) $r['met_at'],
                'day'   => (new \DateTimeImmutable('@' . $r['met_at']))->setTimezone($this->tz)->format('Y-m-d'),
                'note'  => $r['note'],
                'photo' => (bool) $r['has_photo'],
                'by'    => $r['user_name'],
                'mine'  => $user !== null && $r['user_sub'] === $user['sub'],
            ];
        }

        return ['favourites' => $favs, 'log' => $log, 'shows' => $shows, 'places' => $places, 'characters' => $characters, 'characterList' => self::characterList(), 'user' => $user ? ['name' => $user['name'], 'email' => $user['email'], 'emoji' => $user['emoji'] ?? null, 'avatar' => $user['avatar'] ?? null, 'profileId' => $user['profileId'] ?? null] : null];
    }

    public function setFavourite(string $id, string $park, string $name, bool $on): void
    {
        if ($on) {
            $this->db->prepare(
                'INSERT INTO favourites (entity_id, park_key, name, created_at) VALUES (?, ?, ?, ?)
                 ON CONFLICT(entity_id) DO UPDATE SET name = excluded.name, park_key = excluded.park_key'
            )->execute([$id, $park, $name, time()]);
        } else {
            $this->db->prepare('DELETE FROM favourites WHERE entity_id = ?')->execute([$id]);
        }
    }

    public function addLog(string $id, string $park, string $name, ?int $wait, ?int $posted, string $queueType, string $note, int $at, ?array $user): int
    {
        $this->db->prepare(
            'INSERT INTO ride_log (entity_id, park_key, name, ridden_at, wait_minutes, posted_wait, queue_type, note, user_sub, user_name)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([$id, $park, $name, $at, $wait, $posted, $queueType, $note, $user['sub'] ?? null, $user['name'] ?? null]);
        return (int) $this->db->lastInsertId();
    }

    public function addWatched(string $id, string $park, string $name, string $note, int $at, ?array $user): void
    {
        $this->db->prepare(
            'INSERT INTO show_log (entity_id, park_key, name, watched_at, note, user_sub, user_name) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )->execute([$id, $park, $name, $at, $note, $user['sub'] ?? null, $user['name'] ?? null]);
    }

    public function deleteWatched(int $id): bool
    {
        $stmt = $this->db->prepare('DELETE FROM show_log WHERE id = ?');
        $stmt->execute([$id]);
        return $stmt->rowCount() > 0;
    }

    public function addPlace(string $kind, string $id, string $park, string $name, string $note, ?int $amountCents, int $at, ?array $user): void
    {
        $this->db->prepare(
            'INSERT INTO place_log (kind, entity_id, park_key, name, visited_at, note, amount_cents, user_sub, user_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([$kind, $id, $park, $name, $at, $note, $amountCents, $user['sub'] ?? null, $user['name'] ?? null]);
    }

    /** @param string|null $photo raw JPEG */
    public function addCharacter(string $name, string $kind, string $note, ?string $photo, int $at, ?array $user): void
    {
        $this->db->beginTransaction();
        try {
            $this->db->prepare('INSERT INTO character_log (name, kind, met_at, note, user_sub, user_name) VALUES (?, ?, ?, ?, ?, ?)')
                ->execute([$name, $kind, $at, $note, $user['sub'] ?? null, $user['name'] ?? null]);
            if ($photo !== null) {
                $id = (int) $this->db->lastInsertId();
                $s = $this->db->prepare('INSERT INTO character_photos (log_id, image) VALUES (?, ?)');
                $s->bindValue(1, $id, \PDO::PARAM_INT);
                $s->bindValue(2, $photo, \PDO::PARAM_LOB);
                $s->execute();
            }
            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }
    }

    public function characterPhoto(int $id): ?string
    {
        $s = $this->db->prepare('SELECT image FROM character_photos WHERE log_id = ?');
        $s->execute([$id]);
        $image = $s->fetchColumn();
        return is_string($image) ? $image : null;
    }

    public function deleteCharacter(int $id): bool
    {
        $this->db->prepare('DELETE FROM character_photos WHERE log_id = ?')->execute([$id]);
        $stmt = $this->db->prepare('DELETE FROM character_log WHERE id = ?');
        $stmt->execute([$id]);
        return $stmt->rowCount() > 0;
    }

    /** The starting checklist from characters.php. */
    private static function characterList(): array
    {
        $file = dirname(__DIR__) . '/characters.php';
        $list = is_file($file) ? require $file : [];
        return is_array($list) ? $list : [];
    }

    public function deletePlace(int $id): bool
    {
        $stmt = $this->db->prepare('DELETE FROM place_log WHERE id = ?');
        $stmt->execute([$id]);
        return $stmt->rowCount() > 0;
    }

    public function deleteLog(int $id): bool
    {
        $stmt = $this->db->prepare('DELETE FROM ride_log WHERE id = ?');
        $stmt->execute([$id]);
        return $stmt->rowCount() > 0;
    }
}
