from __future__ import annotations

import json
import random
from datetime import datetime
from pathlib import Path
from typing import Any

from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QKeySequence, QShortcut
from PySide6.QtWidgets import (
    QAbstractItemView,
    QApplication,
    QButtonGroup,
    QCheckBox,
    QComboBox,
    QFileDialog,
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QInputDialog,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QScrollArea,
    QSlider,
    QStackedWidget,
    QVBoxLayout,
    QWidget,
)

from ..core.database import DEFAULT_SETTINGS, WorshipDatabase
from ..core.library_scanner import AUDIO_EXTS, VIDEO_EXTS, LibraryScannerThread
from ..core.paths import AppPaths
from ..core.vlc_engine import DualVlcEngine
from .projector_window import ProjectorWindow


def _format_duration_ms(ms: int) -> str:
    if ms <= 0:
        return "00:00"
    total_sec = int(ms // 1000)
    hrs = total_sec // 3600
    mins = (total_sec % 3600) // 60
    secs = total_sec % 60
    if hrs > 0:
        return f"{hrs}:{mins:02d}:{secs:02d}"
    return f"{mins:02d}:{secs:02d}"


def _format_bytes(size_bytes: int) -> str:
    if size_bytes <= 0:
        return "0 B"
    units = ["B", "KB", "MB", "GB"]
    val = float(size_bytes)
    idx = 0
    while val >= 1024.0 and idx < len(units) - 1:
        val /= 1024.0
        idx += 1
    return f"{val:.1f} {units[idx]}"


class MainOperatorWindow(QMainWindow):
    """
    GENDEV Worship Media Player — Windows Desktop Operator Console.
    Matches the Web Preview 1:1:
    - Top Navigation Bar: Wordmark | 4 Tabs (Operator Console, Media Library, Playlists, Settings) | Send to Projector
    - Operator Console: Pure Video Preview on top, all Screen Controls strictly below video
    - Secondary Monitor Projector Window: 100% clean output (zero operator controls)
    """

    def __init__(self, paths: AppPaths, db: WorshipDatabase) -> None:
        super().__init__()
        self.paths = paths
        self.db = db
        self.settings = db.get_settings()

        self.setWindowTitle("GENDEV Worship Media Player")
        self.resize(1400, 860)
        self.setAcceptDrops(True)
        self.setStyleSheet(
            """
            QMainWindow, QWidget { background-color: #0A0D14; color: #E6E9F2; font-family: 'Segoe UI', sans-serif; }
            QFrame#Card { background-color: #111622; border: 1px solid #1E2538; border-radius: 10px; }
            QFrame#TopBar { background-color: #0D111B; border-bottom: 1px solid #1E2538; }
            QPushButton { background-color: #1A2236; border: 1px solid #2A344D; border-radius: 6px; padding: 7px 12px; font-weight: 600; font-size: 12px; color: #E6E9F2; }
            QPushButton:hover { background-color: #25304D; }
            QPushButton:disabled { opacity: 0.45; color: #64748B; }
            QPushButton#NavTab { background-color: transparent; border: none; border-bottom: 2px solid transparent; border-radius: 0px; padding: 10px 14px; color: #94A3B8; font-weight: 600; }
            QPushButton#NavTab:checked { color: #FFFFFF; border-bottom: 2px solid #6366F1; }
            QPushButton#PrimaryBtn { background-color: #5E6AD2; border: 1px solid #6366F1; color: #FFFFFF; }
            QPushButton#PrimaryBtn:hover { background-color: #4F5BC0; }
            QPushButton#ProjectorBtn { background-color: #2563EB; border: 1px solid #3B82F6; color: #FFFFFF; }
            QPushButton#ProjectorBtn:hover { background-color: #1D4ED8; }
            QPushButton#FadeOutBtn { background-color: #6B5CE7; border: 1px solid #818CF8; color: #FFFFFF; font-size: 14px; font-weight: 700; }
            QPushButton#FadeOutBtn:hover { background-color: #7C5CFC; }
            QPushButton#DangerBtn { background-color: #991B1B; border: 1px solid #EF4444; color: #FFFFFF; }
            QLineEdit, QComboBox { background-color: #0A0D14; border: 1px solid #252E44; border-radius: 6px; padding: 6px 8px; color: #F1F5F9; font-size: 12px; }
            QListWidget { background-color: #0D121D; border: 1px solid #1F293D; border-radius: 8px; padding: 4px; outline: none; }
            QListWidget::item { padding: 6px 8px; border-radius: 5px; }
            QListWidget::item:selected { background-color: rgba(94, 106, 210, 0.25); color: #FFFFFF; }
            QProgressBar { background-color: #0A0D14; border: 1px solid #1F293D; border-radius: 4px; height: 7px; text-align: center; }
            QProgressBar::chunk { background-color: #5E6AD2; border-radius: 3px; }
            """
        )

        self.engine = DualVlcEngine(self)
        self._apply_engine_settings()

        self.projector = ProjectorWindow()
        self._scanner: LibraryScannerThread | None = None
        self._seen_library_paths: set[str] = set()
        self._all_media_rows: list[dict[str, Any]] = []
        self._manual_queue_ids: list[int] = []

        self._black_active = False
        self._freeze_active = False
        self._single_fullscreen_active = False
        self._is_seeking = False
        self._current_duration_ms = 0
        self._current_media_row: dict[str, Any] | None = None
        self._current_srt_name = ""

        self._current_playlist_id: int | None = None
        self._current_playlist_index = 0
        self._repeat_mode = str(self.settings.get("repeat_mode", "all"))
        self._shuffle_enabled = bool(self.settings.get("shuffle_enabled", False))

        self._bgm_index = 0
        self._countdown_remaining = int(self.settings.get("countdown_duration_sec", 300))
        self._countdown_running = False

        self._build_ui()
        self._wire_events()
        self._wire_shortcuts()
        self._reload_all_from_db()

        self._clock_timer = QTimer(self)
        self._clock_timer.setInterval(1000)
        self._clock_timer.timeout.connect(self._on_clock_tick)
        self._clock_timer.start()
        self._on_clock_tick()

        app = QApplication.instance()
        if app is not None:
            app.screenRemoved.connect(self._handle_screen_removed)

        if bool(self.settings.get("auto_scan_on_startup", True)):
            QTimer.singleShot(250, self._scan_all_folders)

    # ------------------------------------------------------------------
    # UI CONSTRUCTION (Matches Web Preview 1:1)
    # ------------------------------------------------------------------
    def _build_ui(self) -> None:
        central = QWidget(self)
        self.setCentralWidget(central)
        outer = QVBoxLayout(central)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        # 1. TOP HEADER BAR
        topbar = QFrame()
        topbar.setObjectName("TopBar")
        topbar.setFixedHeight(54)
        top_layout = QHBoxLayout(topbar)
        top_layout.setContentsMargins(18, 0, 18, 0)

        wordmark = QLabel("GENDEV Worship Media Player")
        wordmark.setStyleSheet("font-size: 15px; font-weight: 700; color: #FFFFFF; background: transparent;")
        top_layout.addWidget(wordmark)
        top_layout.addStretch(1)

        self.nav_group = QButtonGroup(self)
        self.nav_group.setExclusive(True)
        self.nav_buttons: list[QPushButton] = []
        for idx, title in enumerate(["Operator Console", "Media Library", "Playlists", "Settings"]):
            btn = QPushButton(title)
            btn.setObjectName("NavTab")
            btn.setCheckable(True)
            if idx == 0:
                btn.setChecked(True)
            self.nav_group.addButton(btn, idx)
            self.nav_buttons.append(btn)
            top_layout.addWidget(btn)

        top_layout.addStretch(1)
        self.btn_top_projector = QPushButton("Send to Projector")
        self.btn_top_projector.setObjectName("PrimaryBtn")
        top_layout.addWidget(self.btn_top_projector)
        outer.addWidget(topbar)

        # 2. MAIN STACKED WORKSPACE
        self.stack = QStackedWidget()
        outer.addWidget(self.stack, 1)

        self.page_console = self._build_console_page()
        self.page_library = self._build_library_page()
        self.page_playlists = self._build_playlists_page()
        self.page_settings = self._build_settings_page()

        self.stack.addWidget(self.page_console)
        self.stack.addWidget(self.page_library)
        self.stack.addWidget(self.page_playlists)
        self.stack.addWidget(self.page_settings)

    def _build_console_page(self) -> QWidget:
        page = QWidget()
        root = QHBoxLayout(page)
        root.setContentsMargins(12, 12, 12, 12)
        root.setSpacing(12)

        # --- COLUMN 1: SIDEBAR MEDIA LIBRARY (280px) ---
        left_card = QFrame()
        left_card.setObjectName("Card")
        left_card.setFixedWidth(290)
        left = QVBoxLayout(left_card)
        left.setContentsMargins(12, 12, 12, 12)
        left.setSpacing(8)

        hdr = QHBoxLayout()
        hdr_lbl = QLabel("MEDIA LIBRARY")
        hdr_lbl.setStyleSheet("font-size: 11px; font-weight: 700; color: #CBD5E1; background: transparent;")
        hdr.addWidget(hdr_lbl)
        hdr.addStretch(1)
        self.btn_add_folder = QPushButton("+ Folder")
        self.btn_browse_files = QPushButton("+ File")
        self.btn_refresh = QPushButton("Refresh")
        hdr.addWidget(self.btn_add_folder)
        hdr.addWidget(self.btn_browse_files)
        hdr.addWidget(self.btn_refresh)
        left.addLayout(hdr)

        self.console_search = QLineEdit()
        self.console_search.setPlaceholderText("Filter media...")
        left.addWidget(self.console_search)

        filter_row = QHBoxLayout()
        self.console_kind_group = QButtonGroup(self)
        self.console_kind_group.setExclusive(True)
        for idx, label in enumerate(["All", "Video", "Audio"]):
            b = QPushButton(label)
            b.setCheckable(True)
            if idx == 0:
                b.setChecked(True)
            self.console_kind_group.addButton(b, idx)
            filter_row.addWidget(b)
        left.addLayout(filter_row)

        self.library_list = QListWidget()
        left.addWidget(self.library_list, 1)

        self.btn_queue_selected = QPushButton("+ Add Selected to Playlist")
        self.btn_queue_selected.setObjectName("PrimaryBtn")
        left.addWidget(self.btn_queue_selected)
        root.addWidget(left_card)

        # --- COLUMN 2: VIDEO PREVIEW ON TOP + ALL SCREEN CONTROLS STRICTLY BELOW ---
        center_col = QVBoxLayout()
        center_col.setSpacing(10)

        # 2A. Pure Video Preview Card (Zero controls inside viewport)
        preview_card = QFrame()
        preview_card.setObjectName("Card")
        pv_layout = QVBoxLayout(preview_card)
        pv_layout.setContentsMargins(12, 10, 12, 12)
        pv_layout.setSpacing(6)

        pv_header = QHBoxLayout()
        self.preview_title_label = QLabel("No Media Loaded")
        self.preview_title_label.setStyleSheet("font-size: 14px; font-weight: 700; color: #FFFFFF; background: transparent;")
        pv_header.addWidget(self.preview_title_label, 1)
        self.preview_flags_label = QLabel("")
        self.preview_flags_label.setStyleSheet("font-size: 11px; font-weight: 700; color: #F87171; background: transparent;")
        pv_header.addWidget(self.preview_flags_label)
        pv_layout.addLayout(pv_header)

        self.preview_meta_label = QLabel("Operator Video Preview · READY · 00:00 / 00:00")
        self.preview_meta_label.setStyleSheet("font-size: 11px; color: #94A3B8; background: transparent;")
        pv_layout.addWidget(self.preview_meta_label)

        self.preview_surface = QWidget()
        self.preview_surface.setMinimumHeight(250)
        self.preview_surface.setStyleSheet("background-color: #000000; border: 1px solid #1F293D; border-radius: 8px;")
        pv_layout.addWidget(self.preview_surface, 1)
        self.engine.bind_video_window(int(self.preview_surface.winId()))
        center_col.addWidget(preview_card, 3)

        # 2B. Operator Screen Controls Card (Strictly Below & Outside Video)
        ctrl_card = QFrame()
        ctrl_card.setObjectName("Card")
        ctrl_layout = QVBoxLayout(ctrl_card)
        ctrl_layout.setContentsMargins(12, 10, 12, 10)
        ctrl_layout.setSpacing(8)

        self.error_banner = QLabel("")
        self.error_banner.setStyleSheet(
            "background-color: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.4); "
            "color: #FDE68A; padding: 6px 10px; border-radius: 6px; font-size: 11px;"
        )
        self.error_banner.hide()
        ctrl_layout.addWidget(self.error_banner)

        top_ctrl = QHBoxLayout()
        lbl_ctrl = QLabel("OPERATOR SCREEN CONTROLS (LAPTOP ONLY)")
        lbl_ctrl.setStyleSheet("font-size: 11px; font-weight: 700; color: #94A3B8; background: transparent;")
        top_ctrl.addWidget(lbl_ctrl)
        top_ctrl.addStretch(1)

        self.btn_load_srt = QPushButton("SRT")
        self.btn_clear_srt = QPushButton("Clear SRT")
        self.btn_clear_srt.hide()
        self.speed_combo = QComboBox()
        for r in [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]:
            self.speed_combo.addItem(f"{r:g}x", r)
        self.speed_combo.setCurrentIndex(2)
        self.btn_single_fs = QPushButton("Fullscreen Stage")

        top_ctrl.addWidget(self.btn_load_srt)
        top_ctrl.addWidget(self.btn_clear_srt)
        top_ctrl.addWidget(self.speed_combo)
        top_ctrl.addWidget(self.btn_single_fs)
        ctrl_layout.addLayout(top_ctrl)

        # Seek Row
        seek_row = QHBoxLayout()
        self.time_cur_label = QLabel("00:00")
        self.time_cur_label.setStyleSheet("font-size: 11px; color: #CBD5E1; min-width: 42px; background: transparent;")
        self.btn_step_back = QPushButton("-5s")
        self.seek_slider = QSlider(Qt.Horizontal)
        self.seek_slider.setRange(0, 1000)
        self.btn_step_fwd = QPushButton("+5s")
        self.time_tot_label = QLabel("00:00")
        self.time_tot_label.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
        self.time_tot_label.setStyleSheet("font-size: 11px; color: #94A3B8; min-width: 42px; background: transparent;")
        seek_row.addWidget(self.time_cur_label)
        seek_row.addWidget(self.btn_step_back)
        seek_row.addWidget(self.seek_slider, 1)
        seek_row.addWidget(self.btn_step_fwd)
        seek_row.addWidget(self.time_tot_label)
        ctrl_layout.addLayout(seek_row)

        # Audio Level Indicator
        meter_row = QHBoxLayout()
        lbl_aud = QLabel("Audio")
        lbl_aud.setStyleSheet("font-size: 11px; color: #94A3B8; min-width: 42px; background: transparent;")
        self.audio_meter = QProgressBar()
        self.audio_meter.setRange(0, 100)
        self.audio_meter.setValue(0)
        self.audio_meter.setTextVisible(False)
        self.vol_readout_label = QLabel(f"{int(self.settings['master_volume'])}%")
        self.vol_readout_label.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
        self.vol_readout_label.setStyleSheet("font-size: 11px; color: #CBD5E1; min-width: 48px; background: transparent;")
        meter_row.addWidget(lbl_aud)
        meter_row.addWidget(self.audio_meter, 1)
        meter_row.addWidget(self.vol_readout_label)
        ctrl_layout.addLayout(meter_row)

        # Transport + Volume Row
        trans_row = QHBoxLayout()
        self.btn_prev = QPushButton("PREV")
        self.btn_play = QPushButton("PLAY")
        self.btn_play.setObjectName("PrimaryBtn")
        self.btn_play.setMinimumHeight(40)
        self.btn_stop = QPushButton("STOP")
        self.btn_stop.setMinimumHeight(40)
        self.btn_next = QPushButton("NEXT")

        self.btn_mute = QPushButton("Mute")
        self.vol_slider = QSlider(Qt.Horizontal)
        self.vol_slider.setRange(0, 100)
        self.vol_slider.setValue(int(self.settings["master_volume"]))
        self.vol_slider.setMinimumWidth(140)

        trans_row.addWidget(self.btn_prev)
        trans_row.addWidget(self.btn_play, 1)
        trans_row.addWidget(self.btn_stop)
        trans_row.addWidget(self.btn_next)
        trans_row.addSpacing(12)
        trans_row.addWidget(self.btn_mute)
        trans_row.addWidget(self.vol_slider, 1)
        ctrl_layout.addLayout(trans_row)

        # Smart Fade Out / Fade In Section
        fade_hdr = QHBoxLayout()
        lbl_fade = QLabel("SMART FADE OUT / FADE IN")
        lbl_fade.setStyleSheet("font-size: 11px; font-weight: 700; color: #A5B4FC; background: transparent;")
        self.fade_status_label = QLabel("Manual stage volume transition")
        self.fade_status_label.setStyleSheet("font-size: 11px; color: #94A3B8; background: transparent;")
        fade_hdr.addWidget(lbl_fade)
        fade_hdr.addStretch(1)
        fade_hdr.addWidget(self.fade_status_label)
        ctrl_layout.addLayout(fade_hdr)

        fade_row = QHBoxLayout()
        self.btn_fade_out = QPushButton()
        self.btn_fade_out.setObjectName("FadeOutBtn")
        self.btn_fade_out.setMinimumHeight(54)

        self.btn_fade_in = QPushButton()
        self.btn_fade_in.setMinimumHeight(54)
        self.btn_fade_in.setStyleSheet(
            "background-color: #1A2236; border: 1px solid #6366F1; color: #E0E7FF; font-weight: 700; font-size: 13px;"
        )

        self.console_fade_dur_combo = QComboBox()
        for s in [1, 2, 3, 5, 10, 15]:
            self.console_fade_dur_combo.addItem(f"Fade: {s}s", s)
        self.console_auto_fade_combo = QComboBox()
        self.console_auto_fade_combo.addItem("Auto-End: Off", 0)
        for s in [3, 5, 10, 15]:
            self.console_auto_fade_combo.addItem(f"Auto-End: {s}s", s)

        fade_opts = QVBoxLayout()
        fade_opts.setSpacing(4)
        fade_opts.addWidget(self.console_fade_dur_combo)
        fade_opts.addWidget(self.console_auto_fade_combo)

        fade_row.addWidget(self.btn_fade_out, 3)
        fade_row.addWidget(self.btn_fade_in, 2)
        fade_row.addLayout(fade_opts, 2)
        ctrl_layout.addLayout(fade_row)

        # Stage & Dual Display Row
        stage_row = QHBoxLayout()
        self.btn_black = QPushButton("BLACK SCREEN")
        self.btn_black.setMinimumHeight(40)
        self.btn_freeze = QPushButton("FREEZE FRAME")
        self.btn_freeze.setMinimumHeight(40)
        self.btn_projector = QPushButton("SEND TO PROJECTOR (MONITOR 2)")
        self.btn_projector.setObjectName("ProjectorBtn")
        self.btn_projector.setMinimumHeight(40)
        stage_row.addWidget(self.btn_black, 1)
        stage_row.addWidget(self.btn_freeze, 1)
        stage_row.addWidget(self.btn_projector, 2)
        ctrl_layout.addLayout(stage_row)
        center_col.addWidget(ctrl_card)

        # 2C. Background Music Strip
        bgm_card = QFrame()
        bgm_card.setObjectName("Card")
        bgm_layout = QHBoxLayout(bgm_card)
        bgm_layout.setContentsMargins(12, 8, 12, 8)

        bgm_info = QVBoxLayout()
        self.bgm_track_label = QLabel("Background Music: Ready")
        self.bgm_track_label.setStyleSheet("font-size: 12px; font-weight: 600; color: #FFFFFF; background: transparent;")
        self.bgm_rule_label = QLabel("Auto-fades out when video starts")
        self.bgm_rule_label.setStyleSheet("font-size: 11px; color: #94A3B8; background: transparent;")
        bgm_info.addWidget(self.bgm_track_label)
        bgm_info.addWidget(self.bgm_rule_label)
        bgm_layout.addLayout(bgm_info, 1)

        self.btn_bgm_toggle = QPushButton("Play BGM")
        self.btn_bgm_next = QPushButton("Next BGM")
        self.bgm_vol_slider = QSlider(Qt.Horizontal)
        self.bgm_vol_slider.setRange(0, 100)
        self.bgm_vol_slider.setValue(int(self.settings["bgm_volume"]))
        self.bgm_vol_slider.setFixedWidth(110)
        self.bgm_vol_label = QLabel(f"{int(self.settings['bgm_volume'])}%")
        self.bgm_vol_label.setStyleSheet("font-size: 11px; color: #CBD5E1; min-width: 34px; background: transparent;")

        bgm_layout.addWidget(self.btn_bgm_toggle)
        bgm_layout.addWidget(self.btn_bgm_next)
        bgm_layout.addWidget(self.bgm_vol_slider)
        bgm_layout.addWidget(self.bgm_vol_label)
        center_col.addWidget(bgm_card)

        root.addLayout(center_col, 2)

        # --- COLUMN 3: CLOCK / COUNTDOWN + SERVICE PLAYLIST SCHEDULE (335px) ---
        right_col = QVBoxLayout()
        right_col.setSpacing(10)

        # 3A. Digital Clock & Countdown Card
        clock_card = QFrame()
        clock_card.setObjectName("Card")
        clock_card.setFixedWidth(335)
        ck = QVBoxLayout(clock_card)
        ck.setContentsMargins(12, 10, 12, 10)
        ck.setSpacing(6)

        ck_top = QHBoxLayout()
        ck_lbl = QLabel("Service Time")
        ck_lbl.setStyleSheet("font-size: 11px; color: #94A3B8; background: transparent;")
        self.digital_clock_label = QLabel("00:00:00")
        self.digital_clock_label.setStyleSheet("font-size: 15px; font-weight: 700; color: #FFFFFF; background: transparent;")
        ck_top.addWidget(ck_lbl)
        ck_top.addStretch(1)
        ck_top.addWidget(self.digital_clock_label)
        ck.addLayout(ck_top)

        cd_mid = QHBoxLayout()
        cd_left = QVBoxLayout()
        cd_sub = QLabel("Worship Countdown")
        cd_sub.setStyleSheet("font-size: 11px; color: #94A3B8; background: transparent;")
        self.countdown_display = QLabel("05:00")
        self.countdown_display.setStyleSheet("font-size: 24px; font-weight: 800; color: #A5B4FC; background: transparent;")
        cd_left.addWidget(cd_sub)
        cd_left.addWidget(self.countdown_display)
        cd_mid.addLayout(cd_left, 1)

        self.btn_cd_toggle = QPushButton("Start")
        self.btn_cd_toggle.setObjectName("PrimaryBtn")
        self.btn_cd_reset = QPushButton("Reset")
        cd_mid.addWidget(self.btn_cd_toggle)
        cd_mid.addWidget(self.btn_cd_reset)
        ck.addLayout(cd_mid)

        cd_bot = QHBoxLayout()
        self.btn_cd_3m = QPushButton("3m")
        self.btn_cd_5m = QPushButton("5m")
        self.btn_cd_10m = QPushButton("10m")
        self.chk_cd_projector = QCheckBox("Show on Projector")
        self.chk_cd_projector.setChecked(bool(self.settings.get("countdown_show_on_projector", False)))
        cd_bot.addWidget(self.btn_cd_3m)
        cd_bot.addWidget(self.btn_cd_5m)
        cd_bot.addWidget(self.btn_cd_10m)
        cd_bot.addStretch(1)
        cd_bot.addWidget(self.chk_cd_projector)
        ck.addLayout(cd_bot)
        right_col.addWidget(clock_card)

        # 3B. Service Playlist Schedule Card
        pl_card = QFrame()
        pl_card.setObjectName("Card")
        pl_card.setFixedWidth(335)
        pl_layout = QVBoxLayout(pl_card)
        pl_layout.setContentsMargins(12, 10, 12, 10)
        pl_layout.setSpacing(8)

        pl_sel_row = QHBoxLayout()
        self.playlist_selector = QComboBox()
        self.btn_repeat = QPushButton("Repeat: All")
        self.btn_shuffle = QPushButton("Shuffle")
        self.btn_shuffle.setCheckable(True)
        self.btn_shuffle.setChecked(self._shuffle_enabled)
        pl_sel_row.addWidget(self.playlist_selector, 1)
        pl_sel_row.addWidget(self.btn_repeat)
        pl_sel_row.addWidget(self.btn_shuffle)
        pl_layout.addLayout(pl_sel_row)

        next_up_row = QHBoxLayout()
        self.next_up_label = QLabel("Next Up: End of Playlist")
        self.next_up_label.setStyleSheet(
            "background-color: #0A0D14; border: 1px solid #1E2538; border-radius: 6px; padding: 6px 8px; font-size: 11px; color: #E2E8F0;"
        )
        self.btn_clear_queue = QPushButton("Clear Queue")
        self.btn_clear_queue.hide()
        next_up_row.addWidget(self.next_up_label, 1)
        next_up_row.addWidget(self.btn_clear_queue)
        pl_layout.addLayout(next_up_row)

        self.playlist_widget = QListWidget()
        self.playlist_widget.setDragDropMode(QAbstractItemView.InternalMove)
        self.playlist_widget.setDefaultDropAction(Qt.MoveAction)
        pl_layout.addWidget(self.playlist_widget, 1)

        pl_actions = QHBoxLayout()
        self.btn_pl_up = QPushButton("Up")
        self.btn_pl_down = QPushButton("Down")
        self.btn_pl_queue_next = QPushButton("Next")
        self.btn_pl_remove = QPushButton("Remove")
        pl_actions.addWidget(self.btn_pl_up)
        pl_actions.addWidget(self.btn_pl_down)
        pl_actions.addWidget(self.btn_pl_queue_next)
        pl_actions.addWidget(self.btn_pl_remove)
        pl_layout.addLayout(pl_actions)
        right_col.addWidget(pl_card, 1)

        root.addLayout(right_col)
        return page

    def _build_library_page(self) -> QWidget:
        page = QWidget()
        layout = QHBoxLayout(page)
        layout.setContentsMargins(14, 14, 14, 14)
        layout.setSpacing(14)

        # Left Folder Panel
        left_card = QFrame()
        left_card.setObjectName("Card")
        left_card.setFixedWidth(320)
        lf = QVBoxLayout(left_card)
        lf.setContentsMargins(14, 14, 14, 14)
        lf.setSpacing(10)

        lbl = QLabel("GENDEV Media Library")
        lbl.setStyleSheet("font-size: 14px; font-weight: 700; color: #FFFFFF; background: transparent;")
        lf.addWidget(lbl)

        btns = QHBoxLayout()
        self.lib_btn_add_folder = QPushButton("Add Folder")
        self.lib_btn_add_folder.setObjectName("PrimaryBtn")
        self.lib_btn_browse_file = QPushButton("Browse Files")
        self.lib_btn_refresh = QPushButton("Refresh")
        btns.addWidget(self.lib_btn_add_folder)
        btns.addWidget(self.lib_btn_browse_file)
        btns.addWidget(self.lib_btn_refresh)
        lf.addLayout(btns)

        self.lib_scan_status = QLabel("Source folders play directly without copying files.")
        self.lib_scan_status.setWordWrap(True)
        self.lib_scan_status.setStyleSheet("font-size: 11px; color: #94A3B8; background: transparent;")
        lf.addWidget(self.lib_scan_status)

        self.folder_list = QListWidget()
        lf.addWidget(self.folder_list, 1)

        f_actions = QHBoxLayout()
        self.btn_folder_autoscan = QPushButton("Toggle Auto-Scan")
        self.btn_folder_remove = QPushButton("Remove Folder")
        f_actions.addWidget(self.btn_folder_autoscan)
        f_actions.addWidget(self.btn_folder_remove)
        lf.addLayout(f_actions)
        layout.addWidget(left_card)

        # Right Media Table Panel
        right_card = QFrame()
        right_card.setObjectName("Card")
        rt = QVBoxLayout(right_card)
        rt.setContentsMargins(14, 14, 14, 14)
        rt.setSpacing(10)

        toolbar = QHBoxLayout()
        self.lib_search = QLineEdit()
        self.lib_search.setPlaceholderText("Search media by filename, format, or path...")
        self.lib_kind_combo = QComboBox()
        self.lib_kind_combo.addItems(["All Media", "Video", "Audio"])
        self.lib_target_playlist = QComboBox()
        toolbar.addWidget(self.lib_search, 2)
        toolbar.addWidget(self.lib_kind_combo)
        toolbar.addWidget(QLabel("Target Playlist:"))
        toolbar.addWidget(self.lib_target_playlist, 1)
        rt.addLayout(toolbar)

        self.lib_missing_banner = QLabel("")
        self.lib_missing_banner.setStyleSheet(
            "background-color: rgba(245, 158, 11, 0.14); border: 1px solid rgba(245, 158, 11, 0.35); "
            "color: #FDE68A; padding: 8px 10px; border-radius: 6px; font-size: 12px;"
        )
        self.lib_missing_banner.hide()
        rt.addWidget(self.lib_missing_banner)

        self.lib_media_list = QListWidget()
        rt.addWidget(self.lib_media_list, 1)

        m_actions = QHBoxLayout()
        self.lib_btn_play = QPushButton("Play Selected")
        self.lib_btn_play.setObjectName("PrimaryBtn")
        self.lib_btn_queue = QPushButton("Add to Target Playlist")
        self.lib_btn_relocate = QPushButton("Locate Missing File")
        self.lib_btn_delete = QPushButton("Remove from Index")
        m_actions.addWidget(self.lib_btn_play)
        m_actions.addWidget(self.lib_btn_queue)
        m_actions.addWidget(self.lib_btn_relocate)
        m_actions.addStretch(1)
        m_actions.addWidget(self.lib_btn_delete)
        rt.addLayout(m_actions)
        layout.addWidget(right_card, 1)
        return page

    def _build_playlists_page(self) -> QWidget:
        page = QWidget()
        layout = QHBoxLayout(page)
        layout.setContentsMargins(14, 14, 14, 14)
        layout.setSpacing(14)

        left_card = QFrame()
        left_card.setObjectName("Card")
        left_card.setFixedWidth(320)
        lp = QVBoxLayout(left_card)
        lp.setContentsMargins(14, 14, 14, 14)
        lp.setSpacing(10)

        lbl = QLabel("Service Playlists")
        lbl.setStyleSheet("font-size: 14px; font-weight: 700; color: #FFFFFF; background: transparent;")
        lp.addWidget(lbl)

        create_row = QHBoxLayout()
        self.pl_new_name = QLineEdit()
        self.pl_new_name.setPlaceholderText("New playlist name...")
        self.pl_btn_create = QPushButton("+ Create")
        self.pl_btn_create.setObjectName("PrimaryBtn")
        create_row.addWidget(self.pl_new_name, 1)
        create_row.addWidget(self.pl_btn_create)
        lp.addLayout(create_row)

        self.pl_new_is_bgm = QCheckBox("Mark as Background Music playlist")
        lp.addWidget(self.pl_new_is_bgm)

        self.pl_manager_list = QListWidget()
        lp.addWidget(self.pl_manager_list, 1)

        pl_crud = QHBoxLayout()
        self.pl_btn_rename = QPushButton("Rename")
        self.pl_btn_delete = QPushButton("Delete")
        pl_crud.addWidget(self.pl_btn_rename)
        pl_crud.addWidget(self.pl_btn_delete)
        lp.addLayout(pl_crud)
        layout.addWidget(left_card)

        right_card = QFrame()
        right_card.setObjectName("Card")
        rp = QVBoxLayout(right_card)
        rp.setContentsMargins(14, 14, 14, 14)
        rp.setSpacing(10)

        top = QHBoxLayout()
        self.pl_editor_title = QLabel("Playlist Editor")
        self.pl_editor_title.setStyleSheet("font-size: 16px; font-weight: 700; color: #FFFFFF; background: transparent;")
        self.pl_btn_set_active = QPushButton("Set as Active Console Playlist")
        self.pl_btn_play_start = QPushButton("Play From Start")
        self.pl_btn_play_start.setObjectName("PrimaryBtn")
        top.addWidget(self.pl_editor_title, 1)
        top.addWidget(self.pl_btn_set_active)
        top.addWidget(self.pl_btn_play_start)
        rp.addLayout(top)

        add_bar = QHBoxLayout()
        self.pl_quick_add_combo = QComboBox()
        self.pl_btn_quick_add = QPushButton("+ Add to Playlist")
        add_bar.addWidget(self.pl_quick_add_combo, 1)
        add_bar.addWidget(self.pl_btn_quick_add)
        rp.addLayout(add_bar)

        self.pl_editor_items = QListWidget()
        self.pl_editor_items.setDragDropMode(QAbstractItemView.InternalMove)
        self.pl_editor_items.setDefaultDropAction(Qt.MoveAction)
        rp.addWidget(self.pl_editor_items, 1)

        ed_btns = QHBoxLayout()
        self.pl_ed_up = QPushButton("Up")
        self.pl_ed_down = QPushButton("Down")
        self.pl_ed_play = QPushButton("Play Item")
        self.pl_ed_remove = QPushButton("Remove Item")
        ed_btns.addWidget(self.pl_ed_up)
        ed_btns.addWidget(self.pl_ed_down)
        ed_btns.addWidget(self.pl_ed_play)
        ed_btns.addStretch(1)
        ed_btns.addWidget(self.pl_ed_remove)
        rp.addLayout(ed_btns)
        layout.addWidget(right_card, 1)
        return page

    def _build_settings_page(self) -> QWidget:
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.NoFrame)

        container = QWidget()
        outer = QVBoxLayout(container)
        outer.setContentsMargins(20, 18, 20, 24)
        outer.setSpacing(14)

        hdr = QHBoxLayout()
        title = QLabel("Application Settings & Configuration")
        title.setStyleSheet("font-size: 18px; font-weight: 700; color: #FFFFFF; background: transparent;")
        self.btn_backup_export = QPushButton("Backup Config (.json)")
        self.btn_backup_import = QPushButton("Restore Config (.json)")
        self.btn_reset_settings = QPushButton("Reset Defaults")
        hdr.addWidget(title, 1)
        hdr.addWidget(self.btn_backup_export)
        hdr.addWidget(self.btn_backup_import)
        hdr.addWidget(self.btn_reset_settings)
        outer.addLayout(hdr)

        grid = QGridLayout()
        grid.setSpacing(14)

        # Card 1: Smart Fade Out / In
        c1 = QFrame()
        c1.setObjectName("Card")
        f1 = QVBoxLayout(c1)
        f1.setContentsMargins(14, 14, 14, 14)
        f1.setSpacing(8)
        f1_title = QLabel("Smart Fade Out / Fade In & Auto-Fade")
        f1_title.setStyleSheet("font-size: 13px; font-weight: 700; color: #FFFFFF; background: transparent;")
        f1.addWidget(f1_title)

        self.set_fade_out_combo = QComboBox()
        self.set_fade_in_combo = QComboBox()
        for s in [1, 2, 3, 5, 10, 15]:
            self.set_fade_out_combo.addItem(f"{s} seconds", s)
            self.set_fade_in_combo.addItem(f"{s} seconds", s)
        self.set_post_fade_combo = QComboBox()
        self.set_post_fade_combo.addItem("Pause Video (Keep Frame Ready)", "pause")
        self.set_post_fade_combo.addItem("Stop & Reset to Start", "stop")

        self.set_auto_fade_chk = QCheckBox("Auto Fade Out Before End")
        self.set_auto_fade_sec_combo = QComboBox()
        for s in [3, 5, 10, 15]:
            self.set_auto_fade_sec_combo.addItem(f"{s}s before end", s)

        f1.addWidget(QLabel("Fade Out Duration"))
        f1.addWidget(self.set_fade_out_combo)
        f1.addWidget(QLabel("Fade In Duration"))
        f1.addWidget(self.set_fade_in_combo)
        f1.addWidget(QLabel("Action When Volume Reaches 0%"))
        f1.addWidget(self.set_post_fade_combo)
        f1.addWidget(self.set_auto_fade_chk)
        f1.addWidget(self.set_auto_fade_sec_combo)
        grid.addWidget(c1, 0, 0)

        # Card 2: Dual Display & Subtitles
        c2 = QFrame()
        c2.setObjectName("Card")
        f2 = QVBoxLayout(c2)
        f2.setContentsMargins(14, 14, 14, 14)
        f2.setSpacing(8)
        f2_title = QLabel("Dual Display & Projector Output")
        f2_title.setStyleSheet("font-size: 13px; font-weight: 700; color: #FFFFFF; background: transparent;")
        f2.addWidget(f2_title)

        self.set_screen_combo = QComboBox()
        self.btn_detect_screens = QPushButton("Detect Displays")
        self.set_preserve_aspect_chk = QCheckBox("Preserve Video Aspect Ratio")
        self.set_show_srt_chk = QCheckBox("Show SRT Subtitles on Projector")
        f2.addWidget(QLabel("Target Projector Screen"))
        f2.addWidget(self.set_screen_combo)
        f2.addWidget(self.btn_detect_screens)
        f2.addWidget(self.set_preserve_aspect_chk)
        f2.addWidget(self.set_show_srt_chk)
        f2.addStretch(1)
        grid.addWidget(c2, 0, 1)

        # Card 3: Background Music Automation
        c3 = QFrame()
        c3.setObjectName("Card")
        f3 = QVBoxLayout(c3)
        f3.setContentsMargins(14, 14, 14, 14)
        f3.setSpacing(8)
        f3_title = QLabel("Background Music Automation")
        f3_title.setStyleSheet("font-size: 13px; font-weight: 700; color: #FFFFFF; background: transparent;")
        f3.addWidget(f3_title)

        self.set_bgm_playlist_combo = QComboBox()
        self.set_bgm_auto_fade_chk = QCheckBox("Auto fade out BGM when main video starts")
        self.set_bgm_auto_resume_chk = QCheckBox("Auto fade in BGM after video finishes or stops")
        self.set_bgm_simultaneous_chk = QCheckBox("Allow BGM and main video audio simultaneously")
        f3.addWidget(QLabel("Dedicated Background Music Playlist"))
        f3.addWidget(self.set_bgm_playlist_combo)
        f3.addWidget(self.set_bgm_auto_fade_chk)
        f3.addWidget(self.set_bgm_auto_resume_chk)
        f3.addWidget(self.set_bgm_simultaneous_chk)
        f3.addStretch(1)
        grid.addWidget(c3, 1, 0)

        # Card 4: Church Watermark Logo & Startup
        c4 = QFrame()
        c4.setObjectName("Card")
        f4 = QVBoxLayout(c4)
        f4.setContentsMargins(14, 14, 14, 14)
        f4.setSpacing(8)
        f4_title = QLabel("Church Watermark Logo & Startup")
        f4_title.setStyleSheet("font-size: 13px; font-weight: 700; color: #FFFFFF; background: transparent;")
        f4.addWidget(f4_title)

        logo_row = QHBoxLayout()
        self.btn_choose_logo = QPushButton("Upload Church Logo")
        self.set_logo_visible_chk = QCheckBox("Show Watermark")
        self.set_logo_pos_combo = QComboBox()
        self.set_logo_pos_combo.addItems(["top-left", "top-right", "bottom-left", "bottom-right"])
        logo_row.addWidget(self.btn_choose_logo)
        logo_row.addWidget(self.set_logo_visible_chk)
        logo_row.addWidget(self.set_logo_pos_combo)
        f4.addLayout(logo_row)

        self.set_auto_scan_chk = QCheckBox("Auto-scan configured folders on startup")
        self.set_restore_playlist_chk = QCheckBox("Restore last active playlist on launch")
        f4.addWidget(self.set_auto_scan_chk)
        f4.addWidget(self.set_restore_playlist_chk)

        shortcuts_lbl = QLabel(
            "Shortcuts: Space (Play/Pause) · F (Fade Out) · I (Fade In) · "
            "B (Black Screen) · Z (Freeze) · M (Mute) · P (Projector)"
        )
        shortcuts_lbl.setWordWrap(True)
        shortcuts_lbl.setStyleSheet("font-size: 11px; color: #94A3B8; background: transparent;")
        f4.addWidget(shortcuts_lbl)
        grid.addWidget(c4, 1, 1)

        outer.addLayout(grid)
        outer.addStretch(1)
        scroll.setWidget(container)
        self._populate_settings_widgets()
        return scroll

    # ------------------------------------------------------------------
    # EVENT WIRING & SHORTCUTS
    # ------------------------------------------------------------------
    def _wire_events(self) -> None:
        self.nav_group.idClicked.connect(self.stack.setCurrentIndex)
        self.btn_top_projector.clicked.connect(self._toggle_projector)

        # Console Library Sidebar
        self.btn_add_folder.clicked.connect(self._choose_folder)
        self.btn_browse_files.clicked.connect(self._browse_files)
        self.btn_refresh.clicked.connect(self._scan_all_folders)
        self.console_search.textChanged.connect(self._render_console_library_list)
        self.console_kind_group.idClicked.connect(lambda _: self._render_console_library_list())
        self.library_list.itemDoubleClicked.connect(self._play_selected_library_item)
        self.btn_queue_selected.clicked.connect(self._add_selected_library_to_playlist)

        # Operator Screen Controls
        self.btn_load_srt.clicked.connect(self._choose_srt_file)
        self.btn_clear_srt.clicked.connect(self._clear_srt)
        self.speed_combo.currentIndexChanged.connect(
            lambda _: self.engine.set_rate(float(self.speed_combo.currentData()))
        )
        self.btn_single_fs.clicked.connect(self._toggle_single_fullscreen)
        self.btn_step_back.clicked.connect(lambda: self.engine.step_seek_ms(-5000))
        self.btn_step_fwd.clicked.connect(lambda: self.engine.step_seek_ms(5000))
        self.seek_slider.sliderPressed.connect(lambda: setattr(self, "_is_seeking", True))
        self.seek_slider.sliderReleased.connect(self._on_seek_released)

        self.btn_prev.clicked.connect(self._play_previous_in_playlist)
        self.btn_play.clicked.connect(self._on_toggle_play_pause)
        self.btn_stop.clicked.connect(self.engine.stop)
        self.btn_next.clicked.connect(self._play_next_in_playlist)
        self.btn_mute.clicked.connect(self._on_toggle_mute)
        self.vol_slider.valueChanged.connect(self._on_master_volume_changed)

        self.btn_fade_out.clicked.connect(self._trigger_fade_out)
        self.btn_fade_in.clicked.connect(self._trigger_fade_in)
        self.console_fade_dur_combo.currentIndexChanged.connect(self._on_console_fade_dur_changed)
        self.console_auto_fade_combo.currentIndexChanged.connect(self._on_console_autofade_changed)

        self.btn_black.clicked.connect(self._toggle_black_screen)
        self.btn_freeze.clicked.connect(self._toggle_freeze_frame)
        self.btn_projector.clicked.connect(self._toggle_projector)

        # BGM Strip
        self.btn_bgm_toggle.clicked.connect(self._toggle_bgm)
        self.btn_bgm_next.clicked.connect(self._next_bgm)
        self.bgm_vol_slider.valueChanged.connect(self._on_bgm_volume_changed)

        # Clock / Countdown
        self.btn_cd_toggle.clicked.connect(self._toggle_countdown)
        self.btn_cd_reset.clicked.connect(lambda: self._reset_countdown())
        self.btn_cd_3m.clicked.connect(lambda: self._reset_countdown(180))
        self.btn_cd_5m.clicked.connect(lambda: self._reset_countdown(300))
        self.btn_cd_10m.clicked.connect(lambda: self._reset_countdown(600))
        self.chk_cd_projector.toggled.connect(self._on_countdown_projector_toggled)

        # Console Service Playlist
        self.playlist_selector.currentIndexChanged.connect(self._on_playlist_changed)
        self.btn_repeat.clicked.connect(self._cycle_repeat_mode)
        self.btn_shuffle.toggled.connect(self._on_shuffle_toggled)
        self.btn_clear_queue.clicked.connect(self._clear_manual_queue)
        self.playlist_widget.itemDoubleClicked.connect(self._play_selected_playlist_item)
        self.playlist_widget.model().rowsMoved.connect(self._persist_playlist_order)
        self.btn_pl_up.clicked.connect(lambda: self._move_playlist_row(-1))
        self.btn_pl_down.clicked.connect(lambda: self._move_playlist_row(1))
        self.btn_pl_queue_next.clicked.connect(self._queue_selected_playlist_item_next)
        self.btn_pl_remove.clicked.connect(self._remove_selected_playlist_item)

        # Media Library Tab
        self.lib_btn_add_folder.clicked.connect(self._choose_folder)
        self.lib_btn_browse_file.clicked.connect(self._browse_files)
        self.lib_btn_refresh.clicked.connect(self._scan_all_folders)
        self.lib_search.textChanged.connect(self._render_library_tab_items)
        self.lib_kind_combo.currentIndexChanged.connect(self._render_library_tab_items)
        self.folder_list.currentRowChanged.connect(lambda _: self._render_library_tab_items())
        self.btn_folder_autoscan.clicked.connect(self._toggle_selected_folder_autoscan)
        self.btn_folder_remove.clicked.connect(self._remove_selected_folder)
        self.lib_btn_play.clicked.connect(self._play_selected_lib_tab_item)
        self.lib_btn_queue.clicked.connect(self._queue_selected_lib_tab_item)
        self.lib_btn_relocate.clicked.connect(self._relocate_selected_lib_tab_item)
        self.lib_btn_delete.clicked.connect(self._delete_selected_lib_tab_item)

        # Playlists Tab
        self.pl_btn_create.clicked.connect(self._create_new_playlist)
        self.pl_btn_rename.clicked.connect(self._rename_selected_playlist)
        self.pl_btn_delete.clicked.connect(self._delete_selected_playlist)
        self.pl_manager_list.currentRowChanged.connect(lambda _: self._render_playlist_editor())
        self.pl_btn_set_active.clicked.connect(self._set_editor_playlist_active)
        self.pl_btn_play_start.clicked.connect(lambda: self._play_editor_playlist_index(0))
        self.pl_btn_quick_add.clicked.connect(self._quick_add_to_editor_playlist)
        self.pl_editor_items.model().rowsMoved.connect(self._persist_editor_playlist_order)
        self.pl_ed_up.clicked.connect(lambda: self._move_editor_row(-1))
        self.pl_ed_down.clicked.connect(lambda: self._move_editor_row(1))
        self.pl_ed_play.clicked.connect(
            lambda: self._play_editor_playlist_index(max(0, self.pl_editor_items.currentRow()))
        )
        self.pl_ed_remove.clicked.connect(self._remove_editor_row)

        # Settings Tab
        self.btn_backup_export.clicked.connect(self._export_backup)
        self.btn_backup_import.clicked.connect(self._import_backup)
        self.btn_reset_settings.clicked.connect(self._reset_settings_defaults)
        self.set_fade_out_combo.currentIndexChanged.connect(self._save_settings_from_ui)
        self.set_fade_in_combo.currentIndexChanged.connect(self._save_settings_from_ui)
        self.set_post_fade_combo.currentIndexChanged.connect(self._save_settings_from_ui)
        self.set_auto_fade_chk.toggled.connect(self._save_settings_from_ui)
        self.set_auto_fade_sec_combo.currentIndexChanged.connect(self._save_settings_from_ui)
        self.set_screen_combo.currentIndexChanged.connect(self._save_settings_from_ui)
        self.btn_detect_screens.clicked.connect(self._populate_screens_combo)
        self.set_preserve_aspect_chk.toggled.connect(self._save_settings_from_ui)
        self.set_show_srt_chk.toggled.connect(self._save_settings_from_ui)
        self.set_bgm_playlist_combo.currentIndexChanged.connect(self._save_settings_from_ui)
        self.set_bgm_auto_fade_chk.toggled.connect(self._save_settings_from_ui)
        self.set_bgm_auto_resume_chk.toggled.connect(self._save_settings_from_ui)
        self.set_bgm_simultaneous_chk.toggled.connect(self._save_settings_from_ui)
        self.btn_choose_logo.clicked.connect(self._choose_logo_file)
        self.set_logo_visible_chk.toggled.connect(self._save_settings_from_ui)
        self.set_logo_pos_combo.currentIndexChanged.connect(self._save_settings_from_ui)
        self.set_auto_scan_chk.toggled.connect(self._save_settings_from_ui)
        self.set_restore_playlist_chk.toggled.connect(self._save_settings_from_ui)

        # Engine Signals
        self.engine.position_changed.connect(self._on_position_changed)
        self.engine.fade_tick.connect(self._on_fade_tick)
        self.engine.fade_finished.connect(self._on_fade_finished)
        self.engine.state_changed.connect(self._on_playback_state_changed)
        self.engine.media_ended.connect(self._play_next_in_playlist)
        self.engine.bgm_ended.connect(self._next_bgm)
        self.engine.playback_error.connect(self._show_error)
        self.projector.closed.connect(self._on_projector_closed_externally)

    def _wire_shortcuts(self) -> None:
        QShortcut(QKeySequence(Qt.Key_Space), self, self._on_toggle_play_pause)
        QShortcut(QKeySequence("F"), self, self._trigger_fade_out)
        QShortcut(QKeySequence("I"), self, self._trigger_fade_in)
        QShortcut(QKeySequence("B"), self, self._toggle_black_screen)
        QShortcut(QKeySequence("Z"), self, self._toggle_freeze_frame)
        QShortcut(QKeySequence("M"), self, self._on_toggle_mute)
        QShortcut(QKeySequence("P"), self, self._toggle_projector)
        QShortcut(QKeySequence(Qt.Key_Escape), self, self._exit_single_fullscreen_if_active)

    # ------------------------------------------------------------------
    # DATA HYDRATION & REFRESH DEDUPLICATION FIX
    # ------------------------------------------------------------------
    def _reload_all_from_db(self) -> None:
        self._all_media_rows = self.db.list_media()
        self._seen_library_paths = {str(r["file_path"]) for r in self._all_media_rows}
        self._render_console_library_list()
        self._render_folder_list()
        self._render_library_tab_items()
        self._load_playlists()
        self._update_fade_button_labels()
        self._update_next_up_label()
        self._sync_projector_overlays()

    def _choose_folder(self) -> None:
        if self._scanner is not None and self._scanner.isRunning():
            return
        folder = QFileDialog.getExistingDirectory(self, "Select Media Folder")
        if folder:
            self.db.add_folder(folder)
            self._render_folder_list()
            self._scan_folders([folder])

    def _browse_files(self) -> None:
        files, _ = QFileDialog.getOpenFileNames(
            self,
            "Select Video or Audio Files",
            "",
            "Media Files (*.mp4 *.mkv *.avi *.mov *.wmv *.webm *.mp3 *.wav *.flac *.aac *.ogg *.m4a);;All Files (*.*)",
        )
        if not files:
            return
        self._import_file_paths(files)

    def _import_file_paths(self, paths: list[str]) -> None:
        added = 0
        for p_str in paths:
            p = Path(p_str)
            if not p.is_file():
                continue
            ext = p.suffix.lower()
            if ext == ".srt" and self._current_media_row:
                if self.engine.load_subtitle(str(p)):
                    self._current_srt_name = p.name
                    self.btn_clear_srt.show()
                    self._update_preview_meta()
                continue
            if ext not in VIDEO_EXTS and ext not in AUDIO_EXTS:
                continue
            kind = "video" if ext in VIDEO_EXTS else "audio"
            resolved = str(p.resolve())
            self.db.upsert_media(
                file_path=resolved,
                name=p.stem,
                kind=kind,
                ext=ext.lstrip(".").upper(),
                size_bytes=p.stat().st_size,
            )
            added += 1
        self._reload_all_from_db()
        if added > 0:
            self.lib_scan_status.setText(f"Ready: {added} file(s) indexed without copying.")

    def _scan_all_folders(self) -> None:
        """
        BUG FIX: Guard against concurrent Refresh clicks, clear existing UI lists &
        rebuild `_seen_library_paths` from DB cleanly so repeated Refresh clicks
        NEVER duplicate items in Media Library.
        """
        if self._scanner is not None and self._scanner.isRunning():
            return
        self.btn_refresh.setEnabled(False)
        self.lib_btn_refresh.setEnabled(False)
        self.lib_scan_status.setText("Refreshing folders & verifying files on disk...")

        missing_count = self.db.verify_all_media_existence()
        self._all_media_rows = self.db.list_media()
        self._seen_library_paths = {str(r["file_path"]) for r in self._all_media_rows}
        self._render_console_library_list()
        self._render_library_tab_items()

        folders = [f["path"] for f in self.db.list_folders()]
        if folders:
            self._scan_folders(folders)
        else:
            self.btn_refresh.setEnabled(True)
            self.lib_btn_refresh.setEnabled(True)
            self.lib_scan_status.setText(
                f"Verified {len(self._all_media_rows)} file(s)"
                + (f" ({missing_count} missing)." if missing_count else ".")
            )

    def _scan_folders(self, folders: list[str]) -> None:
        if self._scanner is not None and self._scanner.isRunning():
            return
        self.btn_refresh.setEnabled(False)
        self.lib_btn_refresh.setEnabled(False)
        self._scanner = LibraryScannerThread(folders, recursive=True)
        self._scanner.file_discovered.connect(self._on_file_discovered)
        self._scanner.finished_scan.connect(self._on_scan_finished)
        self._scanner.start()

    def _on_file_discovered(self, info: dict[str, Any]) -> None:
        fpath = str(info["file_path"])
        self.db.upsert_media(
            file_path=fpath,
            name=str(info["name"]),
            kind=str(info["kind"]),
            ext=str(info["ext"]),
            size_bytes=int(info["size_bytes"]),
        )
        # Only update list if new path wasn't already indexed in memory
        if fpath not in self._seen_library_paths:
            self._seen_library_paths.add(fpath)

    def _on_scan_finished(self, scanned_count: int) -> None:
        self.btn_refresh.setEnabled(True)
        self.lib_btn_refresh.setEnabled(True)
        self._reload_all_from_db()
        self.lib_scan_status.setText(
            f"Scan complete: {len(self._all_media_rows)} unique media items ({scanned_count} scanned)."
        )

    def _render_console_library_list(self) -> None:
        self.library_list.clear()
        q = self.console_search.text().strip().lower()
        kind_idx = self.console_kind_group.checkedId()
        kind_filter = "all" if kind_idx <= 0 else ("video" if kind_idx == 1 else "audio")

        for row in self._all_media_rows:
            if kind_filter != "all" and row["kind"] != kind_filter:
                continue
            if q and q not in row["name"].lower() and q not in row["ext"].lower():
                continue
            missing_tag = " [MISSING]" if row.get("missing") else ""
            item = QListWidgetItem(f"[{row['ext']}] {row['name']}{missing_tag}")
            item.setData(Qt.UserRole, row)
            self.library_list.addItem(item)

    def _render_folder_list(self) -> None:
        self.folder_list.clear()
        all_item = QListWidgetItem(f"All Directories ({len(self._all_media_rows)})")
        all_item.setData(Qt.UserRole, None)
        self.folder_list.addItem(all_item)
        for f in self.db.list_folders():
            mode = "Auto-Scan" if f["auto_scan"] else "Manual"
            item = QListWidgetItem(f"{Path(f['path']).name or f['path']} [{mode}]")
            item.setToolTip(f["path"])
            item.setData(Qt.UserRole, f)
            self.folder_list.addItem(item)

    def _render_library_tab_items(self) -> None:
        self.lib_media_list.clear()
        q = self.lib_search.text().strip().lower()
        kind_text = self.lib_kind_combo.currentText()
        folder_item = self.folder_list.currentItem()
        folder_data = folder_item.data(Qt.UserRole) if folder_item else None
        folder_prefix = str(folder_data["path"]) if isinstance(folder_data, dict) else None

        missing_count = 0
        for row in self._all_media_rows:
            if row.get("missing"):
                missing_count += 1
            if kind_text == "Video" and row["kind"] != "video":
                continue
            if kind_text == "Audio" and row["kind"] != "audio":
                continue
            if folder_prefix and not str(row["file_path"]).startswith(folder_prefix):
                continue
            if (
                q
                and q not in row["name"].lower()
                and q not in row["ext"].lower()
                and q not in row["file_path"].lower()
            ):
                continue
            tag = " [MISSING]" if row.get("missing") else ""
            entry = QListWidgetItem(
                f"[{row['ext']}] {row['name']} · {_format_bytes(int(row['size_bytes']))}{tag}"
            )
            entry.setData(Qt.UserRole, row)
            self.lib_media_list.addItem(entry)

        if missing_count > 0:
            self.lib_missing_banner.setText(
                f"{missing_count} media item(s) missing or offline. Playlist references are preserved — select an item and click 'Locate Missing File'."
            )
            self.lib_missing_banner.show()
        else:
            self.lib_missing_banner.hide()

        # Keep quick-add combo in Playlists tab synchronized
        if hasattr(self, "pl_quick_add_combo"):
            cur_id = self.pl_quick_add_combo.currentData()
            self.pl_quick_add_combo.clear()
            for row in self._all_media_rows:
                self.pl_quick_add_combo.addItem(
                    f"[{row['kind'].upper()}] {row['name']} ({row['ext']})", row["id"]
                )
            if cur_id is not None:
                idx = self.pl_quick_add_combo.findData(cur_id)
                if idx >= 0:
                    self.pl_quick_add_combo.setCurrentIndex(idx)

    # ------------------------------------------------------------------
    # PLAYLIST MANAGEMENT & DRAG-DROP REORDER
    # ------------------------------------------------------------------
    def _load_playlists(self) -> None:
        playlists = self.db.list_playlists()
        prev_console_id = self._current_playlist_id or self.settings.get("last_playlist_id")

        self.playlist_selector.blockSignals(True)
        self.playlist_selector.clear()
        self.lib_target_playlist.clear()
        self.pl_manager_list.clear()
        self.set_bgm_playlist_combo.blockSignals(True)
        self.set_bgm_playlist_combo.clear()

        selected_idx = 0
        for idx, pl in enumerate(playlists):
            label = f"{pl['name']} (BGM)" if pl["is_bgm"] else pl["name"]
            self.playlist_selector.addItem(pl["name"], pl["id"])
            self.lib_target_playlist.addItem(pl["name"], pl["id"])
            self.set_bgm_playlist_combo.addItem(pl["name"], pl["name"])
            m_item = QListWidgetItem(label)
            m_item.setData(Qt.UserRole, pl)
            self.pl_manager_list.addItem(m_item)
            if prev_console_id is not None and int(pl["id"]) == int(prev_console_id):
                selected_idx = idx

        self.playlist_selector.setCurrentIndex(selected_idx)
        self.playlist_selector.blockSignals(False)

        bgm_name = str(self.settings.get("bgm_playlist_name", "Background Music Ibadah"))
        bgm_idx = self.set_bgm_playlist_combo.findData(bgm_name)
        if bgm_idx >= 0:
            self.set_bgm_playlist_combo.setCurrentIndex(bgm_idx)
        self.set_bgm_playlist_combo.blockSignals(False)

        if self.playlist_selector.count() > 0:
            self._on_playlist_changed(selected_idx)
        if self.pl_manager_list.count() > 0:
            self.pl_manager_list.setCurrentRow(selected_idx)
            self._render_playlist_editor()

    def _on_playlist_changed(self, idx: int) -> None:
        pl_id = self.playlist_selector.itemData(idx)
        if pl_id is None:
            return
        self._current_playlist_id = int(pl_id)
        self._current_playlist_index = 0
        self.db.set_setting("last_playlist_id", self._current_playlist_id)
        self._refresh_playlist_widget()

    def _refresh_playlist_widget(self) -> None:
        self.playlist_widget.clear()
        if self._current_playlist_id is None:
            return
        rows = self.db.get_playlist_items(self._current_playlist_id)
        total = len(rows)
        for idx, row in enumerate(rows):
            pos_tag = " · Start" if idx == 0 else (" · End" if idx == total - 1 and total > 1 else "")
            miss_tag = " [MISSING]" if row.get("missing") else ""
            item = QListWidgetItem(f"{idx + 1:02d}  [{row['ext']}] {row['name']}{pos_tag}{miss_tag}")
            item.setData(Qt.UserRole, row)
            self.playlist_widget.addItem(item)
        self._update_next_up_label()

    def _persist_playlist_order(self) -> None:
        if self._current_playlist_id is None:
            return
        ordered_ids: list[int] = []
        for i in range(self.playlist_widget.count()):
            data = self.playlist_widget.item(i).data(Qt.UserRole)
            if isinstance(data, dict) and "id" in data:
                ordered_ids.append(int(data["id"]))
        self.db.replace_playlist_order(self._current_playlist_id, ordered_ids)
        self._refresh_playlist_widget()
        self._render_playlist_editor()

    def _move_playlist_row(self, delta: int) -> None:
        row = self.playlist_widget.currentRow()
        if row < 0:
            return
        target = row + delta
        if target < 0 or target >= self.playlist_widget.count():
            return
        item = self.playlist_widget.takeItem(row)
        self.playlist_widget.insertItem(target, item)
        self.playlist_widget.setCurrentRow(target)
        self._persist_playlist_order()

    def _remove_selected_playlist_item(self) -> None:
        row = self.playlist_widget.currentRow()
        if row < 0:
            return
        self.playlist_widget.takeItem(row)
        self._persist_playlist_order()

    def _queue_selected_playlist_item_next(self) -> None:
        item = self.playlist_widget.currentItem()
        if not item:
            return
        data = item.data(Qt.UserRole)
        if isinstance(data, dict) and "id" in data:
            self._manual_queue_ids.append(int(data["id"]))
            self._update_next_up_label()

    def _clear_manual_queue(self) -> None:
        self._manual_queue_ids.clear()
        self._update_next_up_label()

    def _add_selected_library_to_playlist(self) -> None:
        if self._current_playlist_id is None:
            return
        item = self.library_list.currentItem()
        if item is None:
            return
        data = item.data(Qt.UserRole)
        if isinstance(data, dict) and "id" in data:
            self.db.add_to_playlist(self._current_playlist_id, int(data["id"]))
            self._refresh_playlist_widget()
            self._render_playlist_editor()

    # ------------------------------------------------------------------
    # PLAYBACK, FADE OUT/IN, SEEK, MUTE, SRT
    # ------------------------------------------------------------------
    def _play_media_row(self, row: dict[str, Any], playlist_idx: int | None = None) -> None:
        if row.get("missing"):
            self._show_error(f"File tidak ditemukan: {row['file_path']}")
            return
        self.error_banner.hide()
        self._current_media_row = row
        self._current_srt_name = ""
        self.btn_clear_srt.hide()
        if playlist_idx is not None:
            self._current_playlist_index = playlist_idx

        self.preview_title_label.setText(str(row["name"]))
        self._update_preview_meta()
        self.engine.load_and_play(str(row["file_path"]), kind=str(row["kind"]))
        self._update_next_up_label()

    def _play_selected_library_item(self, item: QListWidgetItem) -> None:
        data = item.data(Qt.UserRole)
        if isinstance(data, dict):
            self._play_media_row(data)

    def _play_selected_playlist_item(self, item: QListWidgetItem) -> None:
        idx = self.playlist_widget.row(item)
        data = item.data(Qt.UserRole)
        if isinstance(data, dict):
            self._play_media_row(data, playlist_idx=idx)

    def _on_toggle_play_pause(self) -> None:
        if self._current_media_row is None and self.playlist_widget.count() > 0:
            first = self.playlist_widget.item(0)
            if first:
                self._play_selected_playlist_item(first)
                return
        self.engine.toggle_play_pause()

    def _play_next_in_playlist(self) -> None:
        if self._repeat_mode == "one" and self._current_media_row is not None:
            self._play_media_row(self._current_media_row, self._current_playlist_index)
            return

        if self._manual_queue_ids:
            next_media_id = self._manual_queue_ids.pop(0)
            row = self.db.get_media(next_media_id)
            self._update_next_up_label()
            if row:
                self._play_media_row(row)
                return

        count = self.playlist_widget.count()
        if count == 0:
            return
        if self._shuffle_enabled and count > 1:
            choices = [i for i in range(count) if i != self._current_playlist_index]
            next_idx = random.choice(choices)
        else:
            next_idx = self._current_playlist_index + 1
            if next_idx >= count:
                if self._repeat_mode == "all":
                    next_idx = 0
                else:
                    self.engine.stop()
                    return

        self._current_playlist_index = next_idx
        self.playlist_widget.setCurrentRow(next_idx)
        item = self.playlist_widget.item(next_idx)
        if item:
            self._play_selected_playlist_item(item)

    def _play_previous_in_playlist(self) -> None:
        count = self.playlist_widget.count()
        if count == 0:
            return
        if self._current_playlist_index == 0 and self._repeat_mode == "off":
            self.engine.seek_ms(0)
            return
        prev_idx = (self._current_playlist_index - 1) % count
        self._current_playlist_index = prev_idx
        self.playlist_widget.setCurrentRow(prev_idx)
        item = self.playlist_widget.item(prev_idx)
        if item:
            self._play_selected_playlist_item(item)

    def _on_seek_released(self) -> None:
        self._is_seeking = False
        if self._current_duration_ms > 0:
            ratio = self.seek_slider.value() / 1000.0
            self.engine.seek_ms(int(ratio * self._current_duration_ms))

    def _on_position_changed(self, cur_ms: int, total_ms: int) -> None:
        self._current_duration_ms = total_ms
        self.time_cur_label.setText(_format_duration_ms(cur_ms))
        self.time_tot_label.setText(_format_duration_ms(total_ms))
        if not self._is_seeking and total_ms > 0:
            self.seek_slider.setValue(int((cur_ms / total_ms) * 1000))
        self._update_preview_meta(cur_ms, total_ms)

    def _on_playback_state_changed(self, playing: bool) -> None:
        self.btn_play.setText("PAUSE" if playing else "PLAY")
        if playing:
            self.audio_meter.setValue(int(self.settings["master_volume"] * 0.72))
        else:
            self.audio_meter.setValue(0)

    def _on_master_volume_changed(self, vol: int) -> None:
        self.settings["master_volume"] = vol
        self.db.set_setting("master_volume", vol)
        self.engine.set_volume(vol)
        self.vol_readout_label.setText("MUTED" if self.engine._is_muted else f"{vol}%")

    def _on_toggle_mute(self) -> None:
        muted = self.engine.toggle_mute()
        self.btn_mute.setText("Unmute" if muted else "Mute")
        self.vol_readout_label.setText(
            "MUTED" if muted else f"{int(self.settings['master_volume'])}%"
        )

    def _trigger_fade_out(self) -> None:
        self.engine.start_fade_out(
            duration_sec=float(self.settings["fade_out_duration"]),
            end_vol=int(self.settings["fade_end_volume"]),
            post_action=str(self.settings["post_fade_action"]),
        )

    def _trigger_fade_in(self) -> None:
        self.engine.start_fade_in(
            duration_sec=float(self.settings["fade_in_duration"]),
            start_vol=int(self.settings["fade_start_volume"]),
        )

    def _on_fade_tick(self, vol: int, prog: float) -> None:
        pct = int(round(prog * 100))
        self.fade_status_label.setText(f"Fading volume: {vol}% ({pct}%)")
        self.audio_meter.setValue(vol)

    def _on_fade_finished(self, direction: str) -> None:
        self.fade_status_label.setText(
            "Fade Out complete" if direction == "out" else "Fade In complete"
        )

    def _on_console_fade_dur_changed(self) -> None:
        val = int(self.console_fade_dur_combo.currentData())
        self.settings["fade_out_duration"] = val
        self.db.set_setting("fade_out_duration", val)
        self._update_fade_button_labels()
        self._populate_settings_widgets()

    def _on_console_autofade_changed(self) -> None:
        val = int(self.console_auto_fade_combo.currentData())
        enabled = val > 0
        self.settings["auto_fade_at_end"] = enabled
        self.db.set_setting("auto_fade_at_end", enabled)
        if enabled:
            self.settings["auto_fade_end_seconds"] = val
            self.db.set_setting("auto_fade_end_seconds", val)
        self._apply_engine_settings()
        self._populate_settings_widgets()

    def _update_fade_button_labels(self) -> None:
        dur = int(self.settings.get("fade_out_duration", 5))
        in_dur = int(self.settings.get("fade_in_duration", 3))
        action = str(self.settings.get("post_fade_action", "pause")).upper()
        self.btn_fade_out.setText(f"FADE OUT   ({dur}s -> {action})")
        self.btn_fade_in.setText(f"FADE IN ({in_dur}s)")

        self.console_fade_dur_combo.blockSignals(True)
        idx = self.console_fade_dur_combo.findData(dur)
        if idx >= 0:
            self.console_fade_dur_combo.setCurrentIndex(idx)
        self.console_fade_dur_combo.blockSignals(False)

        self.console_auto_fade_combo.blockSignals(True)
        auto_val = (
            int(self.settings.get("auto_fade_end_seconds", 5))
            if self.settings.get("auto_fade_at_end", True)
            else 0
        )
        a_idx = self.console_auto_fade_combo.findData(auto_val)
        if a_idx >= 0:
            self.console_auto_fade_combo.setCurrentIndex(a_idx)
        self.console_auto_fade_combo.blockSignals(False)

    def _choose_srt_file(self) -> None:
        path, _ = QFileDialog.getOpenFileName(
            self, "Load Subtitle File", "", "Subtitles (*.srt *.vtt);;All Files (*.*)"
        )
        if path and self.engine.load_subtitle(path):
            self._current_srt_name = Path(path).name
            self.btn_clear_srt.show()
            self._update_preview_meta()

    def _clear_srt(self) -> None:
        self.engine.clear_subtitle()
        self._current_srt_name = ""
        self.btn_clear_srt.hide()
        self._update_preview_meta()

    def _update_preview_meta(self, cur_ms: int = 0, total_ms: int = 0) -> None:
        ext = self._current_media_row["ext"] if self._current_media_row else "READY"
        srt_part = f" · SRT: {self._current_srt_name}" if self._current_srt_name else ""
        self.preview_meta_label.setText(
            f"Operator Video Preview · {ext} · {_format_duration_ms(cur_ms)} / {_format_duration_ms(total_ms)}{srt_part}"
        )

    # ------------------------------------------------------------------
    # STAGE, DUAL PROJECTOR, REPEAT/SHUFFLE, BGM, CLOCK & COUNTDOWN
    # ------------------------------------------------------------------
    def _toggle_black_screen(self) -> None:
        self._black_active = not self._black_active
        self.projector.set_black_screen(self._black_active)
        self.btn_black.setText("EXIT BLACK" if self._black_active else "BLACK SCREEN")
        self._update_stage_flags()

    def _toggle_freeze_frame(self) -> None:
        self._freeze_active = not self._freeze_active
        if self._freeze_active:
            snap_path = self.paths.cache / "freeze_frame.png"
            if self.engine.take_snapshot(snap_path):
                self.projector.set_freeze_frame(True, str(snap_path))
                self.btn_freeze.setText("UNFREEZE")
            else:
                self._freeze_active = False
        else:
            self.projector.set_freeze_frame(False)
            self.btn_freeze.setText("FREEZE FRAME")
        self._update_stage_flags()

    def _update_stage_flags(self) -> None:
        flags = []
        if self._black_active:
            flags.append("BLACK SCREEN")
        if self._freeze_active:
            flags.append("FROZEN")
        self.preview_flags_label.setText("  ·  ".join(flags))

    def _sync_projector_buttons(self, live: bool, windowed: bool = False) -> None:
        if live:
            self.btn_projector.setText(
                "EXIT PROJECTOR (WINDOWED)" if windowed else "EXIT PROJECTOR (MONITOR 2 LIVE)"
            )
            self.btn_top_projector.setText("Exit Projector")
            self.btn_top_projector.setObjectName("DangerBtn")
        else:
            self.btn_projector.setText("SEND TO PROJECTOR (MONITOR 2)")
            self.btn_top_projector.setText("Send to Projector")
            self.btn_top_projector.setObjectName("PrimaryBtn")
        self.btn_top_projector.style().unpolish(self.btn_top_projector)
        self.btn_top_projector.style().polish(self.btn_top_projector)

    def _toggle_projector(self) -> None:
        screens = QApplication.screens()
        if self.projector.isVisible():
            self.projector.hide()
            self.engine.disable_dual_preview(int(self.preview_surface.winId()))
            self._sync_projector_buttons(live=False)
            self.error_banner.hide()
            return

        if not screens:
            self._show_error("Tidak ada layar display yang terdeteksi.")
            return

        self._sync_projector_overlays()
        if len(screens) > 1:
            target_idx = int(self.settings.get("selected_screen_index", 1))
            if target_idx <= 0 or target_idx >= len(screens):
                target_idx = 1
            self.projector.show_on_screen(screens[target_idx])
            self.engine.enable_dual_preview(
                int(self.preview_surface.winId()),
                int(self.projector.video_surface.winId()),
            )
            self._sync_projector_buttons(live=True, windowed=False)
            self.error_banner.hide()
        else:
            self.projector.show_windowed_preview(screens[0])
            self.engine.enable_dual_preview(
                int(self.preview_surface.winId()),
                int(self.projector.video_surface.winId()),
            )
            self._sync_projector_buttons(live=True, windowed=True)
            self._show_error(
                "Hanya 1 layar terdeteksi: Projector dibuka sebagai jendela aman (klik dua kali untuk fullscreen, tekan ESC atau Exit Projector untuk kembali)."
            )

    def _on_projector_closed_externally(self) -> None:
        self.engine.disable_dual_preview(int(self.preview_surface.winId()))
        self._sync_projector_buttons(live=False)

    def _toggle_single_fullscreen(self) -> None:
        self._single_fullscreen_active = not self._single_fullscreen_active
        if self._single_fullscreen_active:
            self.showFullScreen()
            self.btn_single_fs.setText("Exit Fullscreen")
        else:
            self.showNormal()
            self.btn_single_fs.setText("Fullscreen Stage")

    def _exit_single_fullscreen_if_active(self) -> None:
        if self._single_fullscreen_active:
            self._toggle_single_fullscreen()

    def _handle_screen_removed(self, _screen) -> None:
        if self.projector.isVisible():
            self.projector.hide()
            self.engine.disable_dual_preview(int(self.preview_surface.winId()))
            self._sync_projector_buttons(live=False)
            self._show_error("Monitor proyektor dilepas. Output dikembalikan ke layar operator dengan aman.")

    def _cycle_repeat_mode(self) -> None:
        order = ["off", "all", "one"]
        next_mode = order[(order.index(self._repeat_mode) + 1) % len(order)]
        self._repeat_mode = next_mode
        self.db.set_setting("repeat_mode", next_mode)
        self.btn_repeat.setText(f"Repeat: {next_mode.capitalize()}")
        self._update_next_up_label()

    def _on_shuffle_toggled(self, checked: bool) -> None:
        self._shuffle_enabled = checked
        self.db.set_setting("shuffle_enabled", checked)

    def _update_next_up_label(self) -> None:
        if self._manual_queue_ids:
            nxt = self.db.get_media(self._manual_queue_ids[0])
            name = nxt["name"] if nxt else "Queued Track"
            self.next_up_label.setText(f"Next Up (Queue {len(self._manual_queue_ids)}): {name}")
            self.btn_clear_queue.show()
            return
        self.btn_clear_queue.hide()
        count = self.playlist_widget.count()
        if count == 0:
            self.next_up_label.setText("Next Up: End of Playlist")
            return
        next_idx = (self._current_playlist_index + 1) % count
        if next_idx == 0 and self._repeat_mode == "off" and self._current_playlist_index >= count - 1:
            self.next_up_label.setText("Next Up: End of Playlist")
            return
        item = self.playlist_widget.item(next_idx)
        data = item.data(Qt.UserRole) if item else None
        name = data["name"] if isinstance(data, dict) else "End of Playlist"
        self.next_up_label.setText(f"Next Up: {name}")

    # BGM
    def _get_bgm_items(self) -> list[dict[str, Any]]:
        bgm_name = str(self.settings.get("bgm_playlist_name", "Background Music Ibadah"))
        for pl in self.db.list_playlists():
            if pl["name"] == bgm_name:
                return self.db.get_playlist_items(int(pl["id"]))
        for pl in self.db.list_playlists():
            if pl["is_bgm"]:
                return self.db.get_playlist_items(int(pl["id"]))
        return []

    def _toggle_bgm(self) -> None:
        if self.engine.is_bgm_playing():
            self.engine.pause_bgm()
            self.btn_bgm_toggle.setText("Play BGM")
            return
        items = self._get_bgm_items()
        if not items:
            self._show_error("Tambahkan musik ke playlist Background Music Ibadah terlebih dahulu.")
            return
        item = items[self._bgm_index % len(items)]
        if self.engine.play_bgm(str(item["file_path"])):
            self.bgm_track_label.setText(f"Background Music: {item['name']}")
            self.btn_bgm_toggle.setText("Pause BGM")

    def _next_bgm(self) -> None:
        items = self._get_bgm_items()
        if not items:
            return
        self._bgm_index = (self._bgm_index + 1) % len(items)
        item = items[self._bgm_index]
        if self.engine.is_bgm_playing():
            self.engine.play_bgm(str(item["file_path"]))
        self.bgm_track_label.setText(f"Background Music: {item['name']}")

    def _on_bgm_volume_changed(self, vol: int) -> None:
        self.settings["bgm_volume"] = vol
        self.db.set_setting("bgm_volume", vol)
        self.engine.set_bgm_volume(vol)
        self.bgm_vol_label.setText(f"{vol}%")

    # Clock & Countdown
    def _on_clock_tick(self) -> None:
        self.digital_clock_label.setText(datetime.now().strftime("%H:%M:%S"))
        if self._countdown_running:
            if self._countdown_remaining > 0:
                self._countdown_remaining -= 1
            if self._countdown_remaining <= 0:
                self._countdown_running = False
                self.btn_cd_toggle.setText("Start")
        mins = self._countdown_remaining // 60
        secs = self._countdown_remaining % 60
        txt = f"{mins:02d}:{secs:02d}"
        self.countdown_display.setText(txt)
        self.projector.update_countdown(
            bool(self.settings.get("countdown_show_on_projector", False)),
            str(self.settings.get("countdown_label", "Worship Service Starts In")),
            txt,
        )

    def _toggle_countdown(self) -> None:
        self._countdown_running = not self._countdown_running
        self.btn_cd_toggle.setText("Pause" if self._countdown_running else "Start")

    def _reset_countdown(self, sec: int | None = None) -> None:
        self._countdown_running = False
        self.btn_cd_toggle.setText("Start")
        self._countdown_remaining = (
            sec if sec is not None else int(self.settings.get("countdown_duration_sec", 300))
        )
        self._on_clock_tick()

    def _on_countdown_projector_toggled(self, checked: bool) -> None:
        self.settings["countdown_show_on_projector"] = checked
        self.db.set_setting("countdown_show_on_projector", checked)
        self._on_clock_tick()

    # ------------------------------------------------------------------
    # LIBRARY TAB & PLAYLISTS TAB HELPERS
    # ------------------------------------------------------------------
    def _toggle_selected_folder_autoscan(self) -> None:
        item = self.folder_list.currentItem()
        data = item.data(Qt.UserRole) if item else None
        if isinstance(data, dict) and "id" in data:
            self.db.toggle_folder_auto_scan(int(data["id"]))
            self._render_folder_list()

    def _remove_selected_folder(self) -> None:
        item = self.folder_list.currentItem()
        data = item.data(Qt.UserRole) if item else None
        if isinstance(data, dict) and "id" in data:
            self.db.remove_folder(int(data["id"]))
            self._render_folder_list()

    def _play_selected_lib_tab_item(self) -> None:
        item = self.lib_media_list.currentItem()
        data = item.data(Qt.UserRole) if item else None
        if isinstance(data, dict):
            self._play_media_row(data)
            self.nav_buttons[0].setChecked(True)
            self.stack.setCurrentIndex(0)

    def _queue_selected_lib_tab_item(self) -> None:
        item = self.lib_media_list.currentItem()
        data = item.data(Qt.UserRole) if item else None
        target_pl_id = self.lib_target_playlist.currentData()
        if isinstance(data, dict) and target_pl_id is not None:
            self.db.add_to_playlist(int(target_pl_id), int(data["id"]))
            self._refresh_playlist_widget()
            self._render_playlist_editor()

    def _relocate_selected_lib_tab_item(self) -> None:
        item = self.lib_media_list.currentItem()
        data = item.data(Qt.UserRole) if item else None
        if not isinstance(data, dict):
            return
        new_path, _ = QFileDialog.getOpenFileName(self, f"Locate {data['name']}")
        if new_path:
            self.db.relocate_missing_media(int(data["id"]), new_path)
            self._reload_all_from_db()

    def _delete_selected_lib_tab_item(self) -> None:
        item = self.lib_media_list.currentItem()
        data = item.data(Qt.UserRole) if item else None
        if isinstance(data, dict):
            self.db.delete_media(int(data["id"]))
            self._reload_all_from_db()

    def _create_new_playlist(self) -> None:
        name = self.pl_new_name.text().strip()
        if not name:
            return
        try:
            self.db.create_playlist(name, is_bgm=self.pl_new_is_bgm.isChecked())
            self.pl_new_name.clear()
            self.pl_new_is_bgm.setChecked(False)
            self._load_playlists()
        except Exception as exc:
            self._show_error(f"Could not create playlist: {exc}")

    def _rename_selected_playlist(self) -> None:
        item = self.pl_manager_list.currentItem()
        data = item.data(Qt.UserRole) if item else None
        if not isinstance(data, dict):
            return
        new_name, ok = QInputDialog.getText(
            self, "Rename Playlist", "Playlist Name:", text=str(data["name"])
        )
        if ok and new_name.strip():
            self.db.rename_playlist(int(data["id"]), new_name.strip())
            self._load_playlists()

    def _delete_selected_playlist(self) -> None:
        item = self.pl_manager_list.currentItem()
        data = item.data(Qt.UserRole) if item else None
        if not isinstance(data, dict):
            return
        self.db.delete_playlist(int(data["id"]))
        self._load_playlists()

    def _render_playlist_editor(self) -> None:
        self.pl_editor_items.clear()
        item = self.pl_manager_list.currentItem()
        data = item.data(Qt.UserRole) if item else None
        if not isinstance(data, dict):
            return
        self.pl_editor_title.setText(str(data["name"]))
        rows = self.db.get_playlist_items(int(data["id"]))
        for idx, row in enumerate(rows):
            entry = QListWidgetItem(f"{idx + 1:02d}  [{row['ext']}] {row['name']}")
            entry.setData(Qt.UserRole, row)
            self.pl_editor_items.addItem(entry)

    def _set_editor_playlist_active(self) -> None:
        item = self.pl_manager_list.currentItem()
        data = item.data(Qt.UserRole) if item else None
        if isinstance(data, dict):
            idx = self.playlist_selector.findData(int(data["id"]))
            if idx >= 0:
                self.playlist_selector.setCurrentIndex(idx)

    def _play_editor_playlist_index(self, row_idx: int) -> None:
        self._set_editor_playlist_active()
        if row_idx < self.playlist_widget.count():
            item = self.playlist_widget.item(row_idx)
            if item:
                self._play_selected_playlist_item(item)
                self.nav_buttons[0].setChecked(True)
                self.stack.setCurrentIndex(0)

    def _quick_add_to_editor_playlist(self) -> None:
        item = self.pl_manager_list.currentItem()
        data = item.data(Qt.UserRole) if item else None
        media_id = self.pl_quick_add_combo.currentData()
        if isinstance(data, dict) and media_id is not None:
            self.db.add_to_playlist(int(data["id"]), int(media_id))
            self._render_playlist_editor()
            self._refresh_playlist_widget()

    def _persist_editor_playlist_order(self) -> None:
        item = self.pl_manager_list.currentItem()
        data = item.data(Qt.UserRole) if item else None
        if not isinstance(data, dict):
            return
        ordered_ids: list[int] = []
        for i in range(self.pl_editor_items.count()):
            row = self.pl_editor_items.item(i).data(Qt.UserRole)
            if isinstance(row, dict) and "id" in row:
                ordered_ids.append(int(row["id"]))
        self.db.replace_playlist_order(int(data["id"]), ordered_ids)
        self._render_playlist_editor()
        self._refresh_playlist_widget()

    def _move_editor_row(self, delta: int) -> None:
        row = self.pl_editor_items.currentRow()
        if row < 0:
            return
        target = row + delta
        if target < 0 or target >= self.pl_editor_items.count():
            return
        item = self.pl_editor_items.takeItem(row)
        self.pl_editor_items.insertItem(target, item)
        self.pl_editor_items.setCurrentRow(target)
        self._persist_editor_playlist_order()

    def _remove_editor_row(self) -> None:
        row = self.pl_editor_items.currentRow()
        if row < 0:
            return
        self.pl_editor_items.takeItem(row)
        self._persist_editor_playlist_order()

    # ------------------------------------------------------------------
    # SETTINGS, SCREENS, WATERMARK & BACKUP
    # ------------------------------------------------------------------
    def _populate_screens_combo(self) -> None:
        self.set_screen_combo.blockSignals(True)
        self.set_screen_combo.clear()
        for idx, scr in enumerate(QApplication.screens()):
            geo = scr.geometry()
            role = "Primary" if idx == 0 else "Projector"
            self.set_screen_combo.addItem(
                f"Display {idx + 1} ({geo.width()}x{geo.height()}) — {role}", idx
            )
        cur = int(self.settings.get("selected_screen_index", 1))
        pos = self.set_screen_combo.findData(cur)
        self.set_screen_combo.setCurrentIndex(pos if pos >= 0 else 0)
        self.set_screen_combo.blockSignals(False)

    def _populate_settings_widgets(self) -> None:
        widgets = [
            self.set_fade_out_combo,
            self.set_fade_in_combo,
            self.set_post_fade_combo,
            self.set_auto_fade_chk,
            self.set_auto_fade_sec_combo,
            self.set_preserve_aspect_chk,
            self.set_show_srt_chk,
            self.set_bgm_auto_fade_chk,
            self.set_bgm_auto_resume_chk,
            self.set_bgm_simultaneous_chk,
            self.set_logo_visible_chk,
            self.set_logo_pos_combo,
            self.set_auto_scan_chk,
            self.set_restore_playlist_chk,
        ]
        for w in widgets:
            w.blockSignals(True)

        self._populate_screens_combo()
        if (i := self.set_fade_out_combo.findData(int(self.settings["fade_out_duration"]))) >= 0:
            self.set_fade_out_combo.setCurrentIndex(i)
        if (i := self.set_fade_in_combo.findData(int(self.settings["fade_in_duration"]))) >= 0:
            self.set_fade_in_combo.setCurrentIndex(i)
        if (i := self.set_post_fade_combo.findData(str(self.settings["post_fade_action"]))) >= 0:
            self.set_post_fade_combo.setCurrentIndex(i)
        self.set_auto_fade_chk.setChecked(bool(self.settings["auto_fade_at_end"]))
        if (i := self.set_auto_fade_sec_combo.findData(int(self.settings["auto_fade_end_seconds"]))) >= 0:
            self.set_auto_fade_sec_combo.setCurrentIndex(i)

        self.set_preserve_aspect_chk.setChecked(bool(self.settings["preserve_aspect_ratio"]))
        self.set_show_srt_chk.setChecked(bool(self.settings.get("show_subtitles_on_projector", True)))
        self.set_bgm_auto_fade_chk.setChecked(bool(self.settings["bgm_auto_fade_on_video"]))
        self.set_bgm_auto_resume_chk.setChecked(bool(self.settings["bgm_auto_resume_after_video"]))
        self.set_bgm_simultaneous_chk.setChecked(bool(self.settings["bgm_simultaneous"]))
        self.set_logo_visible_chk.setChecked(bool(self.settings["logo_visible"]))
        self.set_logo_pos_combo.setCurrentText(str(self.settings["logo_position"]))
        self.set_auto_scan_chk.setChecked(bool(self.settings["auto_scan_on_startup"]))
        self.set_restore_playlist_chk.setChecked(bool(self.settings["restore_last_playlist"]))

        for w in widgets:
            w.blockSignals(False)

    def _save_settings_from_ui(self) -> None:
        screens = QApplication.screens()
        selected_screen = (
            int(self.set_screen_combo.currentData() or 1)
            if len(screens) > 1
            else int(self.settings.get("selected_screen_index", 1))
        )
        updates = {
            "fade_out_duration": int(self.set_fade_out_combo.currentData()),
            "fade_in_duration": int(self.set_fade_in_combo.currentData()),
            "post_fade_action": str(self.set_post_fade_combo.currentData()),
            "auto_fade_at_end": self.set_auto_fade_chk.isChecked(),
            "auto_fade_end_seconds": int(self.set_auto_fade_sec_combo.currentData()),
            "selected_screen_index": selected_screen,
            "preserve_aspect_ratio": self.set_preserve_aspect_chk.isChecked(),
            "show_subtitles_on_projector": self.set_show_srt_chk.isChecked(),
            "bgm_playlist_name": str(self.set_bgm_playlist_combo.currentData() or "Background Music Ibadah"),
            "bgm_auto_fade_on_video": self.set_bgm_auto_fade_chk.isChecked(),
            "bgm_auto_resume_after_video": self.set_bgm_auto_resume_chk.isChecked(),
            "bgm_simultaneous": self.set_bgm_simultaneous_chk.isChecked(),
            "logo_visible": self.set_logo_visible_chk.isChecked(),
            "logo_position": self.set_logo_pos_combo.currentText(),
            "auto_scan_on_startup": self.set_auto_scan_chk.isChecked(),
            "restore_last_playlist": self.set_restore_playlist_chk.isChecked(),
        }
        for k, v in updates.items():
            self.settings[k] = v
            self.db.set_setting(k, v)
        self._apply_engine_settings()
        self._update_fade_button_labels()
        self._sync_projector_overlays()

    def _apply_engine_settings(self) -> None:
        self.engine.configure_auto_fade(
            bool(self.settings.get("auto_fade_at_end", True)),
            float(self.settings.get("auto_fade_end_seconds", 5)),
        )
        self.engine.configure_bgm_rules(
            bool(self.settings.get("bgm_auto_fade_on_video", True)),
            bool(self.settings.get("bgm_auto_resume_after_video", True)),
            bool(self.settings.get("bgm_simultaneous", False)),
        )
        if hasattr(self, "bgm_rule_label"):
            self.bgm_rule_label.setText(
                "Simultaneous with video"
                if self.settings.get("bgm_simultaneous")
                else "Auto-fades out when video starts"
            )

    def _choose_logo_file(self) -> None:
        path, _ = QFileDialog.getOpenFileName(
            self, "Select Church Logo", "", "Images (*.png *.jpg *.jpeg *.webp)"
        )
        if path:
            self.settings["logo_path"] = path
            self.db.set_setting("logo_path", path)
            self._sync_projector_overlays()

    def _sync_projector_overlays(self) -> None:
        self.projector.update_logo(
            visible=bool(self.settings.get("logo_visible", True)),
            logo_path=str(self.settings.get("logo_path", "")),
            position=str(self.settings.get("logo_position", "bottom-right")),
            size_px=int(self.settings.get("logo_size", 72)),
            opacity=float(self.settings.get("logo_opacity", 0.72)),
        )

    def _export_backup(self) -> None:
        default_path = str(self.paths.backups / "gendev-worship-backup.json")
        path, _ = QFileDialog.getSaveFileName(
            self, "Backup Configuration", default_path, "JSON (*.json)"
        )
        if path:
            Path(path).write_text(
                json.dumps(self.db.export_backup_dict(), indent=2), encoding="utf-8"
            )
            QMessageBox.information(self, "Backup", "Configuration exported successfully.")

    def _import_backup(self) -> None:
        path, _ = QFileDialog.getOpenFileName(
            self, "Restore Configuration", str(self.paths.backups), "JSON (*.json)"
        )
        if not path:
            return
        try:
            payload = json.loads(Path(path).read_text(encoding="utf-8"))
            if self.db.import_backup_dict(payload):
                self.settings = self.db.get_settings()
                self._populate_settings_widgets()
                self._reload_all_from_db()
                QMessageBox.information(self, "Restore", "Configuration restored successfully.")
        except Exception as exc:
            QMessageBox.warning(self, "Restore Error", f"Invalid backup file: {exc}")

    def _reset_settings_defaults(self) -> None:
        for k, v in DEFAULT_SETTINGS.items():
            self.db.set_setting(k, v)
        self.settings = self.db.get_settings()
        self._populate_settings_widgets()
        self._apply_engine_settings()
        self._update_fade_button_labels()
        self._sync_projector_overlays()

    def _show_error(self, message: str) -> None:
        self.error_banner.setText(message)
        self.error_banner.show()

    # ------------------------------------------------------------------
    # WINDOW DRAG-AND-DROP (Files & Folders)
    # ------------------------------------------------------------------
    def dragEnterEvent(self, event) -> None:  # type: ignore[override]
        if event.mimeData().hasUrls():
            event.acceptProposedAction()

    def dropEvent(self, event) -> None:  # type: ignore[override]
        urls = event.mimeData().urls()
        file_paths: list[str] = []
        folder_paths: list[str] = []
        for u in urls:
            local = u.toLocalFile()
            if not local:
                continue
            p = Path(local)
            if p.is_dir():
                self.db.add_folder(str(p))
                folder_paths.append(str(p))
            elif p.is_file():
                file_paths.append(str(p))
        if file_paths:
            self._import_file_paths(file_paths)
        if folder_paths:
            self._render_folder_list()
            self._scan_folders(folder_paths)

    def closeEvent(self, event) -> None:  # type: ignore[override]
        try:
            self._clock_timer.stop()
            self.engine.stop()
            self.engine._poll_timer.stop()
            self.engine._bgm_fade_timer.stop()
            if self.engine.bgm_player:
                self.engine.bgm_player.stop()
            if self._scanner is not None and self._scanner.isRunning():
                self._scanner.wait(500)
            if self.projector.isVisible():
                self.projector.close()
        finally:
            self.db.close()
        super().closeEvent(event)
