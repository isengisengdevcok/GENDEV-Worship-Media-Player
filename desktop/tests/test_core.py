from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from desktop.app.core.database import WorshipDatabase
from desktop.app.core.fade_controller import FadeCurve
from desktop.app.core.paths import resolve_app_paths
from desktop.app.core.srt_parser import parse_srt


class TestGendevCore(unittest.TestCase):
    def test_portable_directory_structure(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            paths = resolve_app_paths(mode="portable", custom_root=Path(tmp) / "GENDEV")
            for expected in (
                paths.config,
                paths.playlists,
                paths.media_library,
                paths.cache,
                paths.thumbnails,
                paths.logs,
                paths.backups,
            ):
                self.assertTrue(expected.exists(), f"Missing directory {expected}")

    def test_database_playlists_and_missing_file_preservation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            db = WorshipDatabase(tmp_path / "Config" / "gendev.db")
            playlists = db.list_playlists()
            names = {p["name"] for p in playlists}
            self.assertIn("Ibadah Minggu", names)
            self.assertIn("Pujian dan Penyembahan", names)

            sample_file = tmp_path / "sermon_intro.mp4"
            sample_file.write_bytes(b"mock-video-header")
            media_id = db.upsert_media(
                file_path=str(sample_file),
                name="sermon_intro",
                kind="video",
                ext="MP4",
                size_bytes=sample_file.stat().st_size,
            )
            ibadah_id = next(p["id"] for p in playlists if p["name"] == "Ibadah Minggu")
            db.add_to_playlist(ibadah_id, media_id)

            # Simulate external USB removal
            sample_file.unlink()
            missing_count = db.verify_all_media_existence()
            self.assertEqual(missing_count, 1)

            # Ensure playlist reference is NOT deleted
            items = db.get_playlist_items(ibadah_id)
            self.assertEqual(len(items), 1)
            self.assertEqual(items[0]["missing"], 1)

            # Relocate file
            relocated = tmp_path / "relocated_intro.mp4"
            relocated.write_bytes(b"mock-video-header")
            db.relocate_missing_media(media_id, str(relocated))
            self.assertEqual(db.verify_all_media_existence(), 0)

            # Test drag-and-drop playlist reorder persistence
            second_file = tmp_path / "closing_song.mp4"
            second_file.write_bytes(b"mock-video-2")
            media_id_2 = db.upsert_media(
                file_path=str(second_file),
                name="closing_song",
                kind="video",
                ext="MP4",
                size_bytes=second_file.stat().st_size,
            )
            db.add_to_playlist(ibadah_id, media_id_2)
            db.replace_playlist_order(ibadah_id, [media_id_2, media_id])
            reordered = db.get_playlist_items(ibadah_id)
            self.assertEqual([r["id"] for r in reordered], [media_id_2, media_id])
            db.close()

    def test_fade_curve_progression(self) -> None:
        curve = FadeCurve(start_vol=90, end_vol=0, duration_sec=5.0)
        self.assertEqual(curve.volume_at(0.0), 90)
        self.assertEqual(curve.volume_at(2.5), 45)
        self.assertEqual(curve.volume_at(5.0), 0)
        self.assertEqual(curve.volume_at(10.0), 0)

    def test_srt_parser(self) -> None:
        sample = (
            "1\n00:00:01,000 --> 00:00:04,500\nSelamat Datang\n\n"
            "2\n00:00:05,000 --> 00:00:08,000\nTuhan Memberkati\n"
        )
        cues = parse_srt(sample)
        self.assertEqual(len(cues), 2)
        self.assertEqual(cues[0].text, "Selamat Datang")
        self.assertAlmostEqual(cues[1].start_sec, 5.0)


if __name__ == "__main__":
    unittest.main()
