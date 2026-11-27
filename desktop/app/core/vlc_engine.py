from __future__ import annotations

import os
import sys
from pathlib import Path
from PySide6.QtCore import QObject, QTimer, Signal

from .fade_controller import FadeCurve


def _configure_bundled_vlc() -> None:
    """Point python-vlc to bundled LibVLC directory when packaged with PyInstaller."""
    if getattr(sys, "frozen", False):
        base = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
        vlc_dir = base / "vlc"
        if vlc_dir.exists():
            os.environ["PYTHON_VLC_MODULE_PATH"] = str(vlc_dir)
            os.environ["PYTHON_VLC_LIB_PATH"] = str(vlc_dir / "libvlc.dll")
            if hasattr(os, "add_dll_directory"):
                os.add_dll_directory(str(vlc_dir))


_configure_bundled_vlc()

try:
    import vlc  # type: ignore
except Exception:
    vlc = None  # Allows unit tests in headless CI without LibVLC installed


class DualVlcEngine(QObject):
    """
    Production LibVLC playback engine supporting:
    - Main video/audio player routed to Projector HWND or Operator Preview HWND
    - Separate Background Music player
    - Smooth sample-stepped Fade Out / Fade In / Auto-Fade at End / Crossfade
    - Snapshot Freeze Frame capture
    """

    position_changed = Signal(int, int)
    fade_tick = Signal(int, float)
    fade_finished = Signal(str)
    media_ended = Signal()

    def __init__(self, parent: QObject | None = None) -> None:
        super().__init__(parent)
        self.vlc_available = vlc is not None
        self.instance = vlc.Instance("--no-video-title-show", "--quiet") if vlc else None
        self.player = self.instance.media_player_new() if self.instance else None
        self.bgm_player = self.instance.media_player_new() if self.instance else None

        self._master_volume = 90
        self._bgm_volume = 38
        self._fade_curve: FadeCurve | None = None
        self._fade_direction = "out"
        self._fade_elapsed = 0.0
        self._post_fade_action = "pause"

        self._fade_timer = QTimer(self)
        self._fade_timer.setInterval(40)
        self._fade_timer.timeout.connect(self._on_fade_step)

        self._poll_timer = QTimer(self)
        self._poll_timer.setInterval(200)
        self._poll_timer.timeout.connect(self._on_poll_playback)
        self._poll_timer.start()

    def bind_video_window(self, hwnd: int) -> None:
        if not self.player:
            return
        if sys.platform.startswith("win"):
            self.player.set_hwnd(hwnd)
        elif sys.platform == "darwin":
            self.player.set_nsobject(hwnd)
        else:
            self.player.set_xwindow(hwnd)

    def load_and_play(self, file_path: str, srt_path: str | None = None) -> None:
        if not self.instance or not self.player:
            return
        self._fade_timer.stop()
        media = self.instance.media_new(file_path)
        self.player.set_media(media)
        self.player.audio_set_volume(self._master_volume)
        self.player.play()
        if srt_path and Path(srt_path).exists():
            self.player.video_set_subtitle_file(srt_path)

    def toggle_play_pause(self) -> bool:
        if not self.player:
            return False
        if self.player.is_playing():
            self.player.pause()
            return False
        self.player.play()
        return True

    def stop(self) -> None:
        self._fade_timer.stop()
        if self.player:
            self.player.stop()

    def set_volume(self, vol: int) -> None:
        self._master_volume = max(0, min(100, vol))
        if self.player:
            self.player.audio_set_volume(self._master_volume)

    def start_fade_out(self, duration_sec: float = 5.0, end_vol: int = 0, post_action: str = "pause") -> None:
        if not self.player:
            return
        current = self.player.audio_get_volume()
        if current < 0:
            current = self._master_volume
        self._fade_curve = FadeCurve(start_vol=current, end_vol=end_vol, duration_sec=duration_sec)
        self._fade_direction = "out"
        self._fade_elapsed = 0.0
        self._post_fade_action = post_action
        self._fade_timer.start()

    def start_fade_in(self, duration_sec: float = 3.0, start_vol: int = 0) -> None:
        if not self.player:
            return
        if not self.player.is_playing():
            self.player.play()
        self.player.audio_set_volume(start_vol)
        self._fade_curve = FadeCurve(
            start_vol=start_vol, end_vol=self._master_volume, duration_sec=duration_sec
        )
        self._fade_direction = "in"
        self._fade_elapsed = 0.0
        self._fade_timer.start()

    def take_snapshot(self, output_path: Path) -> bool:
        if not self.player:
            return False
        res = self.player.video_take_snapshot(0, str(output_path), 0, 0)
        return res == 0

    def _on_fade_step(self) -> None:
        if not self._fade_curve or not self.player:
            self._fade_timer.stop()
            return
        self._fade_elapsed += 0.04
        vol = self._fade_curve.volume_at(self._fade_elapsed)
        prog = self._fade_curve.progress_at(self._fade_elapsed)
        self.player.audio_set_volume(vol)
        self.fade_tick.emit(vol, prog)

        if prog >= 1.0:
            self._fade_timer.stop()
            if self._fade_direction == "out" and vol <= 0:
                if self._post_fade_action == "stop":
                    self.player.stop()
                else:
                    self.player.set_pause(1)
            self.fade_finished.emit(self._fade_direction)

    def _on_poll_playback(self) -> None:
        if not self.player:
            return
        cur = self.player.get_time()
        total = self.player.get_length()
        if cur >= 0 and total > 0:
            self.position_changed.emit(cur, total)
        if vlc and self.player.get_state() == vlc.State.Ended:
            self.media_ended.emit()
