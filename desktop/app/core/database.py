from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any


DEFAULT_SETTINGS: dict[str, Any] = {
    "accent_theme": "indigo",
    "mode": "portable",
    "auto_scan_on_startup": True,
    "restore_last_playlist": True,
    "master_volume": 90,
    "fade_out_duration": 5,
    "fade_in_duration": 3,
    "fade_start_volume": 0,
    "fade_end_volume": 0,
    "post_fade_action": "pause",
    "auto_fade_at_end": True,
    "auto_fade_end_seconds": 5,
    "crossfade_enabled": True,
    "crossfade_duration": 3,
    "preserve_aspect_ratio": True,
    "bgm_enabled": True,
    "bgm_volume": 38,
    "bgm_auto_fade_on_video": True,
    "bgm_auto_resume_after_video": True,
    "bgm_simultaneous": False,
    "logo_visible": True,
    "logo_position": "bottom-right",
    "logo_size": 72,
    "logo_opacity": 0.72,
}

DEFAULT_PLAYLIST_NAMES = [
    "Ibadah Minggu",
    "Pujian dan Penyembahan",
    "Natal",
    "Paskah",
    "Pemuda",
    "Pengumuman Gereja",
    "Video Dokumentasi",
]


class WorshipDatabase:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        cur = self.conn.cursor()
        cur.executescript(
            """
            PRAGMA journal_mode=WAL;

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS library_folders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT UNIQUE NOT NULL,
                auto_scan INTEGER NOT NULL DEFAULT 1,
                recursive INTEGER NOT NULL DEFAULT 1,
                last_scanned REAL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS media_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                kind TEXT NOT NULL,
                ext TEXT NOT NULL,
                size_bytes INTEGER NOT NULL DEFAULT 0,
                duration_ms INTEGER NOT NULL DEFAULT 0,
                resolution TEXT DEFAULT '',
                thumbnail_path TEXT DEFAULT '',
                missing INTEGER NOT NULL DEFAULT 0,
                added_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS playlists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                is_bgm INTEGER NOT NULL DEFAULT 0,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS playlist_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                playlist_id INTEGER NOT NULL,
                media_id INTEGER NOT NULL,
                position INTEGER NOT NULL,
                FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
                FOREIGN KEY (media_id) REFERENCES media_items(id) ON DELETE CASCADE
            );
            """
        )
        self.conn.commit()
        self._seed_defaults()

    def _seed_defaults(self) -> None:
        cur = self.conn.cursor()
        for k, v in DEFAULT_SETTINGS.items():
            cur.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
                (k, json.dumps(v)),
            )

        now = time.time()
        for name in DEFAULT_PLAYLIST_NAMES:
            cur.execute(
                "INSERT OR IGNORE INTO playlists (name, is_bgm, created_at, updated_at) VALUES (?, 0, ?, ?)",
                (name, now, now),
            )
        cur.execute(
            "INSERT OR IGNORE INTO playlists (name, is_bgm, created_at, updated_at) VALUES ('Background Music Ibadah', 1, ?, ?)",
            (now, now),
        )
        self.conn.commit()

    def get_settings(self) -> dict[str, Any]:
        rows = self.conn.execute("SELECT key, value FROM settings").fetchall()
        merged = dict(DEFAULT_SETTINGS)
        for row in rows:
            merged[row["key"]] = json.loads(row["value"])
        return merged

    def set_setting(self, key: str, value: Any) -> None:
        self.conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            (key, json.dumps(value)),
        )
        self.conn.commit()

    def add_folder(self, path: str, auto_scan: bool = True, recursive: bool = True) -> None:
        self.conn.execute(
            "INSERT OR IGNORE INTO library_folders (path, auto_scan, recursive) VALUES (?, ?, ?)",
            (path, int(auto_scan), int(recursive)),
        )
        self.conn.commit()

    def list_folders(self) -> list[dict[str, Any]]:
        rows = self.conn.execute("SELECT * FROM library_folders ORDER BY id ASC").fetchall()
        return [dict(r) for r in rows]

    def upsert_media(
        self,
        file_path: str,
        name: str,
        kind: str,
        ext: str,
        size_bytes: int,
        duration_ms: int = 0,
        resolution: str = "",
        thumbnail_path: str = "",
    ) -> int:
        now = time.time()
        self.conn.execute(
            """
            INSERT INTO media_items (file_path, name, kind, ext, size_bytes, duration_ms, resolution, thumbnail_path, missing, added_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
            ON CONFLICT(file_path) DO UPDATE SET
                name=excluded.name,
                size_bytes=excluded.size_bytes,
                missing=0
            """,
            (file_path, name, kind, ext, size_bytes, duration_ms, resolution, thumbnail_path, now),
        )
        self.conn.commit()
        row = self.conn.execute(
            "SELECT id FROM media_items WHERE file_path = ?", (file_path,)
        ).fetchone()
        return int(row["id"])

    def verify_all_media_existence(self) -> int:
        """Checks every indexed file on disk without deleting playlist references."""
        rows = self.conn.execute("SELECT id, file_path FROM media_items").fetchall()
        missing_count = 0
        for row in rows:
            exists = Path(row["file_path"]).exists()
            self.conn.execute(
                "UPDATE media_items SET missing = ? WHERE id = ?",
                (0 if exists else 1, row["id"]),
            )
            if not exists:
                missing_count += 1
        self.conn.commit()
        return missing_count

    def relocate_missing_media(self, media_id: int, new_path: str) -> None:
        p = Path(new_path)
        self.conn.execute(
            "UPDATE media_items SET file_path = ?, name = ?, missing = 0 WHERE id = ?",
            (str(p.resolve()), p.stem, media_id),
        )
        self.conn.commit()

    def list_playlists(self) -> list[dict[str, Any]]:
        rows = self.conn.execute("SELECT * FROM playlists ORDER BY id ASC").fetchall()
        return [dict(r) for r in rows]

    def add_to_playlist(self, playlist_id: int, media_id: int) -> None:
        row = self.conn.execute(
            "SELECT COALESCE(MAX(position), -1) AS max_pos FROM playlist_items WHERE playlist_id = ?",
            (playlist_id,),
        ).fetchone()
        next_pos = int(row["max_pos"]) + 1
        self.conn.execute(
            "INSERT INTO playlist_items (playlist_id, media_id, position) VALUES (?, ?, ?)",
            (playlist_id, media_id, next_pos),
        )
        self.conn.commit()

    def get_playlist_items(self, playlist_id: int) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            """
            SELECT pi.id AS entry_id, pi.position, m.*
            FROM playlist_items pi
            JOIN media_items m ON m.id = pi.media_id
            WHERE pi.playlist_id = ?
            ORDER BY pi.position ASC
            """,
            (playlist_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def replace_playlist_order(self, playlist_id: int, media_ids: list[int]) -> None:
        self.conn.execute("DELETE FROM playlist_items WHERE playlist_id = ?", (playlist_id,))
        for pos, media_id in enumerate(media_ids):
            self.conn.execute(
                "INSERT INTO playlist_items (playlist_id, media_id, position) VALUES (?, ?, ?)",
                (playlist_id, media_id, pos),
            )
        self.conn.execute(
            "UPDATE playlists SET updated_at = ? WHERE id = ?",
            (time.time(), playlist_id),
        )
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()
