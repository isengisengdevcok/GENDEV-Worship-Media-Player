from __future__ import annotations

from pathlib import Path
from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QApplication,
    QFileDialog,
    QHBoxLayout,
    QLabel,
    QListWidget,
    QMainWindow,
    QPushButton,
    QSlider,
    QVBoxLayout,
    QWidget,
)

from ..core.database import WorshipDatabase
from ..core.library_scanner import LibraryScannerThread
from ..core.paths import AppPaths
from ..core.vlc_engine import DualVlcEngine
from .projector_window import ProjectorWindow


class MainOperatorWindow(QMainWindow):
    """GENDEV Worship Media Player — Windows Desktop Operator Console."""

    def __init__(self, paths: AppPaths, db: WorshipDatabase) -> None:
        super().__init__()
        self.paths = paths
        self.db = db
        self.settings = db.get_settings()

        self.setWindowTitle("GENDEV Worship Media Player")
        self.resize(1360, 820)
        self.setStyleSheet(
            """
            QMainWindow, QWidget { background-color: #0A0D14; color: #E6E9F2; font-family: 'Segoe UI'; }
            QPushButton { background-color: #1A2236; border: 1px solid #2A344D; border-radius: 6px; padding: 8px 14px; font-weight: 600; }
            QPushButton:hover { background-color: #25304D; }
            QListWidget { background-color: #111622; border: 1px solid #1F293D; border-radius: 8px; padding: 4px; }
            """
        )

        self.engine = DualVlcEngine(self)
        self.projector = ProjectorWindow()
        self._scanner: LibraryScannerThread | None = None
        self._black_active = False
        self._freeze_active = False

        self._build_ui()
        self._wire_events()

        app = QApplication.instance()
        if app is not None:
            app.screenRemoved.connect(self._handle_screen_removed)

    def _build_ui(self) -> None:
        central = QWidget(self)
        self.setCentralWidget(central)
        root = QHBoxLayout(central)
        root.setContentsMargins(12, 12, 12, 12)
        root.setSpacing(12)

        # Left: Media Library
        left = QVBoxLayout()
        left_title = QLabel("Media Library")
        left_title.setStyleSheet("font-size: 14px; font-weight: 700;")
        left.addWidget(left_title)

        btn_row = QHBoxLayout()
        self.btn_add_folder = QPushButton("Add Folder")
        self.btn_refresh = QPushButton("Refresh")
        btn_row.addWidget(self.btn_add_folder)
        btn_row.addWidget(self.btn_refresh)
        left.addLayout(btn_row)

        self.library_list = QListWidget()
        left.addWidget(self.library_list)
        root.addLayout(left, 1)

        # Center: Preview & Tactile Operator Controls
        center = QVBoxLayout()
        self.preview_surface = QWidget()
        self.preview_surface.setMinimumHeight(340)
        self.preview_surface.setStyleSheet("background-color: #000000; border: 1px solid #1F293D; border-radius: 8px;")
        center.addWidget(self.preview_surface, 3)

        self.engine.bind_video_window(int(self.preview_surface.winId()))

        transport = QHBoxLayout()
        self.btn_play = QPushButton("PLAY / PAUSE")
        self.btn_play.setStyleSheet("background-color: #5E6AD2; color: #FFFFFF;")
        self.btn_stop = QPushButton("STOP")
        self.btn_fade_out = QPushButton("FADE OUT (5s)")
        self.btn_fade_out.setStyleSheet("background-color: #7C5CFC; color: #FFFFFF; padding: 12px 20px;")
        self.btn_fade_in = QPushButton("FADE IN")
        transport.addWidget(self.btn_play)
        transport.addWidget(self.btn_stop)
        transport.addWidget(self.btn_fade_out)
        transport.addWidget(self.btn_fade_in)
        center.addLayout(transport)

        stage_row = QHBoxLayout()
        self.btn_black = QPushButton("BLACK SCREEN")
        self.btn_freeze = QPushButton("FREEZE FRAME")
        self.btn_projector = QPushButton("SEND TO PROJECTOR")
        self.btn_projector.setStyleSheet("background-color: #2563EB; color: #FFFFFF;")
        stage_row.addWidget(self.btn_black)
        stage_row.addWidget(self.btn_freeze)
        stage_row.addWidget(self.btn_projector)
        center.addLayout(stage_row)

        vol_row = QHBoxLayout()
        vol_row.addWidget(QLabel("Master Volume"))
        self.vol_slider = QSlider(Qt.Horizontal)
        self.vol_slider.setRange(0, 100)
        self.vol_slider.setValue(int(self.settings["master_volume"]))
        vol_row.addWidget(self.vol_slider)
        center.addLayout(vol_row)

        root.addLayout(center, 2)

        # Right: Active Playlist
        right = QVBoxLayout()
        pl_title = QLabel("Service Playlist")
        pl_title.setStyleSheet("font-size: 14px; font-weight: 700;")
        right.addWidget(pl_title)
        self.playlist_widget = QListWidget()
        right.addWidget(self.playlist_widget)
        root.addLayout(right, 1)

    def _wire_events(self) -> None:
        self.btn_add_folder.clicked.connect(self._choose_folder)
        self.btn_refresh.clicked.connect(self._scan_all_folders)
        self.btn_play.clicked.connect(self.engine.toggle_play_pause)
        self.btn_stop.clicked.connect(self.engine.stop)
        self.btn_fade_out.clicked.connect(
            lambda: self.engine.start_fade_out(
                duration_sec=float(self.settings["fade_out_duration"]),
                end_vol=int(self.settings["fade_end_volume"]),
                post_action=str(self.settings["post_fade_action"]),
            )
        )
        self.btn_fade_in.clicked.connect(
            lambda: self.engine.start_fade_in(
                duration_sec=float(self.settings["fade_in_duration"]),
                start_vol=int(self.settings["fade_start_volume"]),
            )
        )
        self.btn_black.clicked.connect(self._toggle_black_screen)
        self.btn_freeze.clicked.connect(self._toggle_freeze_frame)
        self.btn_projector.clicked.connect(self._toggle_projector)
        self.vol_slider.valueChanged.connect(self.engine.set_volume)
        self.library_list.itemDoubleClicked.connect(self._play_selected_library_item)

    def _choose_folder(self) -> None:
        folder = QFileDialog.getExistingDirectory(self, "Select Media Folder")
        if folder:
            self.db.add_folder(folder)
            self._scan_folders([folder])

    def _scan_all_folders(self) -> None:
        folders = [f["path"] for f in self.db.list_folders()]
        self.db.verify_all_media_existence()
        if folders:
            self._scan_folders(folders)

    def _scan_folders(self, folders: list[str]) -> None:
        self._scanner = LibraryScannerThread(folders, recursive=True)
        self._scanner.file_discovered.connect(self._on_file_discovered)
        self._scanner.start()

    def _on_file_discovered(self, info: dict) -> None:
        self.db.upsert_media(
            file_path=info["file_path"],
            name=info["name"],
            kind=info["kind"],
            ext=info["ext"],
            size_bytes=info["size_bytes"],
        )
        self.library_list.addItem(f"[{info['ext']}] {info['name']}")
        item = self.library_list.item(self.library_list.count() - 1)
        if item is not None:
            item.setData(Qt.UserRole, info["file_path"])

    def _play_selected_library_item(self, item) -> None:
        file_path = item.data(Qt.UserRole)
        if file_path:
            self.engine.load_and_play(str(file_path))

    def _toggle_black_screen(self) -> None:
        self._black_active = not self._black_active
        self.projector.set_black_screen(self._black_active)

    def _toggle_freeze_frame(self) -> None:
        self._freeze_active = not self._freeze_active
        if self._freeze_active:
            snap_path = self.paths.cache / "freeze_frame.png"
            if self.engine.take_snapshot(snap_path):
                self.projector.set_freeze_frame(True, str(snap_path))
        else:
            self.projector.set_freeze_frame(False)

    def _toggle_projector(self) -> None:
        screens = QApplication.screens()
        if self.projector.isVisible():
            self.projector.hide()
            self.engine.bind_video_window(int(self.preview_surface.winId()))
            self.btn_projector.setText("SEND TO PROJECTOR")
        else:
            target = screens[1] if len(screens) > 1 else screens[0]
            self.projector.show_on_screen(target)
            self.engine.bind_video_window(int(self.projector.video_surface.winId()))
            self.btn_projector.setText("EXIT PROJECTOR")

    def _handle_screen_removed(self, _screen) -> None:
        """Gracefully detach projector output back to primary preview if HDMI disconnects."""
        if self.projector.isVisible():
            self.projector.hide()
            self.engine.bind_video_window(int(self.preview_surface.winId()))
            self.btn_projector.setText("SEND TO PROJECTOR")
