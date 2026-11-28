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
    - Separate Background Music player with auto fade-out/fade-in ducking
    - Smart Fade Out / Fade In & Auto-Fade at End with safe audio restoration on replay/seek
    - Playback rate, mute, seek, SRT subtitle loading, and Freeze Frame snapshot capture
    """

    position_changed = Signal(int, int)
    fade_tick = Signal(int, float)
    fade_finished = Signal(str)
    state_changed = Signal(bool)
    media_ended = Signal()
    bgm_ended = Signal()
    playback_error = Signal(str)

    def __init__(self, parent: QObject | None = None) -> None:
        super().__init__(parent)
        self.vlc_available = vlc is not None
        self.instance = vlc.Instance("--no-video-title-show", "--quiet") if vlc else None
        self.player = self.instance.media_player_new() if self.instance else None
        self.preview_player = self.instance.media_player_new() if self.instance else None
        self.bgm_player = self.instance.media_player_new() if self.instance else None
        self._dual_preview_active = False

        self._master_volume = 90
        self._is_muted = False
        self._playback_rate = 1.0
        self._bgm_volume = 38
        self._current_file_path: str | None = None
        self._current_kind: str = "video"
        self._current_bgm_path: str | None = None
        self._fade_curve: FadeCurve | None = None
        self._fade_direction = "out"
        self._fade_elapsed = 0.0
        self._post_fade_action = "pause"
        self._auto_fade_enabled = True
        self._auto_fade_sec = 5.0
        self._auto_fade_triggered = False

        self._bgm_auto_fade_on_video = True
        self._bgm_auto_resume_after_video = True
        self._bgm_simultaneous = False
        self._bgm_paused_by_video = False
        self._bgm_fade_curve: FadeCurve | None = None
        self._bgm_fade_elapsed = 0.0
        self._bgm_fade_action = "none"

        self._fade_timer = QTimer(self)
        self._fade_timer.setInterval(40)
        self._fade_timer.timeout.connect(self._on_fade_step)

        self._bgm_fade_timer = QTimer(self)
        self._bgm_fade_timer.setInterval(40)
        self._bgm_fade_timer.timeout.connect(self._on_bgm_fade_step)

        self._poll_timer = QTimer(self)
        self._poll_timer.setInterval(200)
        self._poll_timer.timeout.connect(self._on_poll_playback)
        self._poll_timer.start()

    def configure_auto_fade(self, enabled: bool, seconds: float) -> None:
        self._auto_fade_enabled = enabled
        self._auto_fade_sec = max(1.0, seconds)

    def configure_bgm_rules(
        self,
        auto_fade_on_video: bool,
        auto_resume_after_video: bool,
        simultaneous: bool,
    ) -> None:
        self._bgm_auto_fade_on_video = auto_fade_on_video
        self._bgm_auto_resume_after_video = auto_resume_after_video
        self._bgm_simultaneous = simultaneous

    @staticmethod
    def _bind_hwnd(mp, hwnd: int) -> None:
        if not mp:
            return
        if sys.platform.startswith("win"):
            mp.set_hwnd(hwnd)
        elif sys.platform == "darwin":
            mp.set_nsobject(hwnd)
        else:
            mp.set_xwindow(hwnd)

    def bind_video_window(self, hwnd: int) -> None:
        self._bind_hwnd(self.player, hwnd)

    def enable_dual_preview(self, preview_hwnd: int, projector_hwnd: int) -> None:
        """Routes main player (with audio) to Monitor 2 Projector and keeps a muted preview on Laptop."""
        self._dual_preview_active = True
        self._bind_hwnd(self.player, projector_hwnd)
        if self.preview_player and self.instance:
            self._bind_hwnd(self.preview_player, preview_hwnd)
            self.preview_player.audio_set_mute(True)
            self.preview_player.audio_set_volume(0)
            if self._current_file_path and Path(self._current_file_path).exists():
                cur_ms = self.player.get_time() if self.player else 0
                was_playing = bool(self.player and self.player.is_playing())
                self.preview_player.set_media(self.instance.media_new(self._current_file_path))
                self.preview_player.play()
                self.preview_player.set_rate(self._playback_rate)
                if cur_ms > 0:
                    self.preview_player.set_time(cur_ms)
                if not was_playing:
                    self.preview_player.set_pause(1)

    def disable_dual_preview(self, preview_hwnd: int) -> None:
        self._dual_preview_active = False
        if self.preview_player:
            self.preview_player.stop()
        self._bind_hwnd(self.player, preview_hwnd)

    def _apply_effective_volume(self, vol: int) -> None:
        if not self.player:
            return
        self.player.audio_set_mute(self._is_muted)
        self.player.audio_set_volume(0 if self._is_muted else max(0, min(100, vol)))

    def load_and_play(
        self, file_path: str, srt_path: str | None = None, kind: str = "video"
    ) -> None:
        if not self.instance or not self.player:
            return
        if not Path(file_path).exists():
            self.playback_error.emit(f"File tidak ditemukan: {file_path}")
            return
        self._fade_timer.stop()
        self._auto_fade_triggered = False
        self._current_file_path = file_path
        self._current_kind = kind

        if kind == "video":
            self._duck_bgm_for_video()

        media = self.instance.media_new(file_path)
        self.player.set_media(media)
        self._apply_effective_volume(self._master_volume)
        self.player.play()
        self.player.set_rate(self._playback_rate)
        if srt_path and Path(srt_path).exists():
            self.player.video_set_subtitle_file(srt_path)

        if self._dual_preview_active and self.preview_player:
            self.preview_player.set_media(self.instance.media_new(file_path))
            self.preview_player.audio_set_mute(True)
            self.preview_player.audio_set_volume(0)
            self.preview_player.play()
            self.preview_player.set_rate(self._playback_rate)

        self.state_changed.emit(True)

    def toggle_play_pause(self) -> bool:
        if not self.player:
            return False

        state = self.player.get_state() if vlc else None
        if vlc and state in (vlc.State.Ended, vlc.State.Stopped, vlc.State.Error):
            self._fade_timer.stop()
            self._auto_fade_triggered = False
            if self._current_file_path and self.instance:
                if self._current_kind == "video":
                    self._duck_bgm_for_video()
                self.player.set_media(self.instance.media_new(self._current_file_path))
                self._apply_effective_volume(self._master_volume)
                self.player.play()
                self.player.set_rate(self._playback_rate)
                if self._dual_preview_active and self.preview_player:
                    self.preview_player.set_media(self.instance.media_new(self._current_file_path))
                    self.preview_player.audio_set_mute(True)
                    self.preview_player.play()
                    self.preview_player.set_rate(self._playback_rate)
                self.state_changed.emit(True)
                return True
            return False

        if self.player.is_playing():
            self.player.pause()
            if self._dual_preview_active and self.preview_player:
                self.preview_player.set_pause(1)
            self.state_changed.emit(False)
            return False

        self._fade_timer.stop()
        if self._current_kind == "video":
            self._duck_bgm_for_video()
        if self.player.audio_get_volume() <= 2:
            self._auto_fade_triggered = False
            self._apply_effective_volume(self._master_volume)
        self.player.play()
        self.player.set_rate(self._playback_rate)
        if self._dual_preview_active and self.preview_player:
            self.preview_player.play()
            self.preview_player.set_rate(self._playback_rate)
        self.state_changed.emit(True)
        return True

    def stop(self) -> None:
        self._fade_timer.stop()
        self._auto_fade_triggered = False
        if self.player:
            self.player.stop()
            self._apply_effective_volume(self._master_volume)
        if self.preview_player:
            self.preview_player.stop()
        self.state_changed.emit(False)
        self.position_changed.emit(0, self.player.get_length() if self.player else 0)
        self._restore_bgm_after_video()

    def seek_ms(self, target_ms: int) -> None:
        if not self.player:
            return
        total = self.player.get_length()
        if total <= 0:
            return
        clamped = max(0, min(total, target_ms))
        self.player.set_time(clamped)
        if self._dual_preview_active and self.preview_player:
            self.preview_player.set_time(clamped)
        remain_sec = (total - clamped) / 1000.0
        if not self._auto_fade_enabled or remain_sec > self._auto_fade_sec + 0.5:
            self._fade_timer.stop()
            self._auto_fade_triggered = False
            self._apply_effective_volume(self._master_volume)
        self.position_changed.emit(clamped, total)

    def step_seek_ms(self, delta_ms: int) -> None:
        if not self.player:
            return
        cur = max(0, self.player.get_time())
        self.seek_ms(cur + delta_ms)

    def set_rate(self, rate: float) -> None:
        self._playback_rate = max(0.5, min(2.0, rate))
        if self.player:
            self.player.set_rate(self._playback_rate)
        if self._dual_preview_active and self.preview_player:
            self.preview_player.set_rate(self._playback_rate)

    def set_volume(self, vol: int) -> None:
        self._master_volume = max(0, min(100, vol))
        if self.player and not self._fade_timer.isActive():
            self._apply_effective_volume(self._master_volume)

    def toggle_mute(self) -> bool:
        self._is_muted = not self._is_muted
        if self.player:
            self._apply_effective_volume(self._master_volume)
        return self._is_muted

    def load_subtitle(self, srt_path: str) -> bool:
        if not self.player or not Path(srt_path).exists():
            return False
        res = self.player.video_set_subtitle_file(srt_path)
        return res == 0 or res is True

    def clear_subtitle(self) -> None:
        if self.player:
            self.player.video_set_spu(-1)

    def start_fade_out(
        self, duration_sec: float = 5.0, end_vol: int = 0, post_action: str = "pause"
    ) -> None:
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
        self._auto_fade_triggered = False
        state = self.player.get_state() if vlc else None
        if vlc and state in (vlc.State.Ended, vlc.State.Stopped) and self._current_file_path and self.instance:
            self.player.set_media(self.instance.media_new(self._current_file_path))
        if self._current_kind == "video":
            self._duck_bgm_for_video()
        if not self.player.is_playing():
            self.player.play()
            self.player.set_rate(self._playback_rate)
            self.state_changed.emit(True)
        if self._dual_preview_active and self.preview_player:
            if vlc and state in (vlc.State.Ended, vlc.State.Stopped) and self._current_file_path and self.instance:
                self.preview_player.set_media(self.instance.media_new(self._current_file_path))
            self.preview_player.audio_set_mute(True)
            self.preview_player.audio_set_volume(0)
            if not self.preview_player.is_playing():
                self.preview_player.play()
                self.preview_player.set_rate(self._playback_rate)
        self._apply_effective_volume(start_vol)
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

    # --- Background Music (BGM) Deck ---
    def play_bgm(self, file_path: str) -> bool:
        if not self.instance or not self.bgm_player or not Path(file_path).exists():
            return False
        self._bgm_fade_timer.stop()
        self._bgm_paused_by_video = False
        if self._current_bgm_path != file_path or (
            vlc and self.bgm_player.get_state() in (vlc.State.Ended, vlc.State.Stopped, vlc.State.Error)
        ):
            self._current_bgm_path = file_path
            self.bgm_player.set_media(self.instance.media_new(file_path))
        self.bgm_player.audio_set_volume(0)
        self.bgm_player.play()
        self._bgm_fade_curve = FadeCurve(start_vol=0, end_vol=self._bgm_volume, duration_sec=1.4)
        self._bgm_fade_elapsed = 0.0
        self._bgm_fade_action = "none"
        self._bgm_fade_timer.start()
        return True

    def pause_bgm(self) -> None:
        if not self.bgm_player:
            return
        self._bgm_paused_by_video = False
        current = max(0, self.bgm_player.audio_get_volume())
        self._bgm_fade_curve = FadeCurve(start_vol=current, end_vol=0, duration_sec=1.0)
        self._bgm_fade_elapsed = 0.0
        self._bgm_fade_action = "pause"
        self._bgm_fade_timer.start()

    def set_bgm_volume(self, vol: int) -> None:
        self._bgm_volume = max(0, min(100, vol))
        if self.bgm_player and not self._bgm_fade_timer.isActive():
            self.bgm_player.audio_set_volume(self._bgm_volume)

    def is_bgm_playing(self) -> bool:
        return bool(self.bgm_player and self.bgm_player.is_playing())

    def _duck_bgm_for_video(self) -> None:
        if self._bgm_simultaneous or not self._bgm_auto_fade_on_video:
            return
        if not self.bgm_player or not self.bgm_player.is_playing():
            return
        self._bgm_paused_by_video = True
        current = max(0, self.bgm_player.audio_get_volume())
        self._bgm_fade_curve = FadeCurve(start_vol=current, end_vol=0, duration_sec=1.5)
        self._bgm_fade_elapsed = 0.0
        self._bgm_fade_action = "pause"
        self._bgm_fade_timer.start()

    def _restore_bgm_after_video(self) -> None:
        if not self._bgm_auto_resume_after_video or not self._bgm_paused_by_video:
            return
        if not self.bgm_player or not self._current_bgm_path:
            return
        self._bgm_paused_by_video = False
        self.bgm_player.audio_set_volume(0)
        self.bgm_player.play()
        self._bgm_fade_curve = FadeCurve(start_vol=0, end_vol=self._bgm_volume, duration_sec=2.0)
        self._bgm_fade_elapsed = 0.0
        self._bgm_fade_action = "none"
        self._bgm_fade_timer.start()

    def _on_bgm_fade_step(self) -> None:
        if not self._bgm_fade_curve or not self.bgm_player:
            self._bgm_fade_timer.stop()
            return
        self._bgm_fade_elapsed += 0.04
        vol = self._bgm_fade_curve.volume_at(self._bgm_fade_elapsed)
        prog = self._bgm_fade_curve.progress_at(self._bgm_fade_elapsed)
        self.bgm_player.audio_set_volume(vol)
        if prog >= 1.0:
            self._bgm_fade_timer.stop()
            if self._bgm_fade_action == "pause":
                self.bgm_player.pause()
            self._bgm_fade_action = "none"

    def _on_fade_step(self) -> None:
        if not self._fade_curve or not self.player:
            self._fade_timer.stop()
            return
        self._fade_elapsed += 0.04
        vol = self._fade_curve.volume_at(self._fade_elapsed)
        prog = self._fade_curve.progress_at(self._fade_elapsed)
        self._apply_effective_volume(vol)
        self.fade_tick.emit(vol, prog)

        if prog >= 1.0:
            self._fade_timer.stop()
            if self._fade_direction == "out" and vol <= 0:
                if self._post_fade_action == "stop":
                    self.player.stop()
                    if self.preview_player:
                        self.preview_player.stop()
                    self._apply_effective_volume(self._master_volume)
                else:
                    self.player.set_pause(1)
                    if self._dual_preview_active and self.preview_player:
                        self.preview_player.set_pause(1)
                self.state_changed.emit(False)
                self._restore_bgm_after_video()
            self.fade_finished.emit(self._fade_direction)

    def _on_poll_playback(self) -> None:
        if self.bgm_player and vlc and self.bgm_player.get_state() == vlc.State.Ended:
            self.bgm_ended.emit()

        if not self.player:
            return
        cur = self.player.get_time()
        total = self.player.get_length()
        if cur >= 0 and total > 0:
            self.position_changed.emit(cur, total)
            remain_sec = (total - cur) / 1000.0
            if (
                self._auto_fade_enabled
                and not self._auto_fade_triggered
                and self.player.is_playing()
                and total > (self._auto_fade_sec + 1.0) * 1000
                and 0 < remain_sec <= self._auto_fade_sec
            ):
                self._auto_fade_triggered = True
                self.start_fade_out(
                    duration_sec=max(0.2, remain_sec),
                    end_vol=0,
                    post_action="pause",
                )

        if vlc and self.player.get_state() == vlc.State.Ended:
            self._fade_timer.stop()
            self._auto_fade_triggered = False
            self._apply_effective_volume(self._master_volume)
            self.state_changed.emit(False)
            self.media_ended.emit()
        elif vlc and self.player.get_state() == vlc.State.Error:
            self._fade_timer.stop()
            self.state_changed.emit(False)
            self.playback_error.emit("Playback error occurred on current media file.")
