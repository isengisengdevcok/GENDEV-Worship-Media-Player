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
    "show_subtitles_on_projector": True,
    "selected_screen_index": 1,
    "bgm_enabled": True,
    "bgm_volume": 38,
    "bgm_auto_fade_on_video": True,
    "bgm_auto_resume_after_video": True,
    "bgm_simultaneous": False,
    "bgm_playlist_name": "Background Music Ibadah",
    "logo_visible": True,
    "logo_path": "",
    "logo_position": "bottom-right",
    "logo_size": 72,
    "logo_opacity": 0.72,
    "countdown_duration_sec": 300,
    "countdown_label": "Worship Service Starts In",
    "countdown_show_on_projector": False,
    "repeat_mode": "all",
    "shuffle_enabled": False,
    "last_playlist_id": None,
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
        self.conn.execute("PRAGMA foreign_keys = ON;")
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

    def add_folder(self, path: str, auto_scan: bool = True, recursive: bool = True) -> int:
        normalized = str(Path(path).resolve()) if Path(path).exists() else path
        self.conn.execute(
            "INSERT OR IGNORE INTO library_folders (path, auto_scan, recursive) VALUES (?, ?, ?)",
            (normalized, int(auto_scan), int(recursive)),
        )
        self.conn.commit()
        row = self.conn.execute(
            "SELECT id FROM library_folders WHERE path = ?", (normalized,)
        ).fetchone()
        return int(row["id"])

    def list_folders(self) -> list[dict[str, Any]]:
        rows = self.conn.execute("SELECT * FROM library_folders ORDER BY id ASC").fetchall()
        return [dict(r) for r in rows]

    def remove_folder(self, folder_id: int) -> None:
        self.conn.execute("DELETE FROM library_folders WHERE id = ?", (folder_id,))
        self.conn.commit()

    def toggle_folder_auto_scan(self, folder_id: int) -> bool:
        row = self.conn.execute(
            "SELECT auto_scan FROM library_folders WHERE id = ?", (folder_id,)
        ).fetchone()
        if not row:
            return True
        next_val = 0 if int(row["auto_scan"]) == 1 else 1
        self.conn.execute(
            "UPDATE library_folders SET auto_scan = ? WHERE id = ?",
            (next_val, folder_id),
        )
        self.conn.commit()
        return bool(next_val)

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
        p = Path(file_path)
        normalized_path = str(p.resolve()) if p.exists() else file_path
        self.conn.execute(
            """
            INSERT INTO media_items (file_path, name, kind, ext, size_bytes, duration_ms, resolution, thumbnail_path, missing, added_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
            ON CONFLICT(file_path) DO UPDATE SET
                name=excluded.name,
                size_bytes=excluded.size_bytes,
                missing=0
            """,
            (normalized_path, name, kind, ext, size_bytes, duration_ms, resolution, thumbnail_path, now),
        )
        self.conn.commit()
        row = self.conn.execute(
            "SELECT id FROM media_items WHERE file_path = ?", (normalized_path,)
        ).fetchone()
        return int(row["id"])

    def list_media(self) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT * FROM media_items ORDER BY kind DESC, name COLLATE NOCASE ASC"
        ).fetchall()
        return [dict(r) for r in rows]

    def get_media(self, media_id: int) -> dict[str, Any] | None:
        row = self.conn.execute("SELECT * FROM media_items WHERE id = ?", (media_id,)).fetchone()
        return dict(row) if row else None

    def delete_media(self, media_id: int) -> None:
        self.conn.execute("DELETE FROM media_items WHERE id = ?", (media_id,))
        self.conn.commit()

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

    def create_playlist(self, name: str, is_bgm: bool = False) -> int:
        trimmed = name.strip()
        if not trimmed:
            raise ValueError("Playlist name cannot be empty")
        now = time.time()
        cur = self.conn.execute(
            "INSERT INTO playlists (name, is_bgm, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (trimmed, int(is_bgm), now, now),
        )
        self.conn.commit()
        return int(cur.lastrowid)

    def rename_playlist(self, playlist_id: int, new_name: str) -> None:
        trimmed = new_name.strip()
        if not trimmed:
            return
        self.conn.execute(
            "UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?",
            (trimmed, time.time(), playlist_id),
        )
        self.conn.commit()

    def delete_playlist(self, playlist_id: int) -> None:
        count_row = self.conn.execute("SELECT COUNT(*) AS cnt FROM playlists").fetchone()
        if count_row and int(count_row["cnt"]) <= 1:
            return
        self.conn.execute("DELETE FROM playlists WHERE id = ?", (playlist_id,))
        self.conn.commit()

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
        self.conn.execute(
            "UPDATE playlists SET updated_at = ? WHERE id = ?",
            (time.time(), playlist_id),
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

    def export_backup_dict(self) -> dict[str, Any]:
        return {
            "app": "GENDEV Worship Media Player",
            "exported_at": time.time(),
            "settings": self.get_settings(),
            "folders": self.list_folders(),
            "playlists": [
                {
                    "name": pl["name"],
                    "is_bgm": bool(pl["is_bgm"]),
                    "file_paths": [
                        item["file_path"] for item in self.get_playlist_items(int(pl["id"]))
                    ],
                }
                for pl in self.list_playlists()
            ],
        }

    def import_backup_dict(self, payload: dict[str, Any]) -> bool:
        if not isinstance(payload, dict) or "settings" not in payload:
            return False
        settings = payload.get("settings", {})
        if isinstance(settings, dict):
            for k, v in settings.items():
                self.set_setting(str(k), v)
        folders = payload.get("folders", [])
        if isinstance(folders, list):
            for f in folders:
                if isinstance(f, dict) and f.get("path"):
                    self.add_folder(
                        str(f["path"]),
                        auto_scan=bool(f.get("auto_scan", True)),
                        recursive=bool(f.get("recursive", True)),
                    )
        playlists = payload.get("playlists", [])
        if isinstance(playlists, list):
            existing = {pl["name"]: int(pl["id"]) for pl in self.list_playlists()}
            audio_exts = {".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a"}
            for pl in playlists:
                if not isinstance(pl, dict) or not pl.get("name"):
                    continue
                pl_name = str(pl["name"]).strip()
                if not pl_name:
                    continue
                pl_id = existing.get(pl_name)
                if pl_id is None:
                    pl_id = self.create_playlist(pl_name, is_bgm=bool(pl.get("is_bgm", False)))
                    existing[pl_name] = pl_id
                file_paths = pl.get("file_paths", [])
                if isinstance(file_paths, list):
                    ordered_ids: list[int] = []
                    for fp in file_paths:
                        p = Path(str(fp))
                        ext = p.suffix.lower()
                        kind = "audio" if ext in audio_exts else "video"
                        size_bytes = p.stat().st_size if p.is_file() else 0
                        m_id = self.upsert_media(
                            file_path=str(fp),
                            name=p.stem or p.name,
                            kind=kind,
                            ext=ext.lstrip(".").upper() or "MEDIA",
                            size_bytes=size_bytes,
                        )
                        ordered_ids.append(m_id)
                    if ordered_ids:
                        self.replace_playlist_order(pl_id, ordered_ids)
        return True

    def close(self) -> None:
        self.conn.close()
