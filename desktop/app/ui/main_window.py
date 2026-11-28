from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QAbstractItemView,
    QApplication,
    QComboBox,
    QFileDialog,
    QHBoxLayout,
    QLabel,
    QListWidget,
    QListWidgetItem,
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
    """
    GENDEV Worship Media Player — Windows Desktop Operator Console.
    All controls stay strictly below/outside the video preview on the laptop screen,
    leaving the secondary Projector screen 100% clean.
    """

    def __init__(self, paths: AppPaths, db: WorshipDatabase) -> None:
        super().__init__()
        self.paths = paths
        self.db = db
        self.settings = db.get_settings()

        self.setWindowTitle("GENDEV Worship Media Player")
        self.resize(1380, 840)
        self.setStyleSheet(
            """
            QMainWindow, QWidget { background-color: #0A0D14; color: #E6E9F2; font-family: 'Segoe UI'; }
            QPushButton { background-color: #1A2236; border: 1px solid #2A344D; border-radius: 6px; padding: 8px 14px; font-weight: 600; }
            QPushButton:hover { background-color: #25304D; }
            QListWidget, QComboBox { background-color: #111622; border: 1px solid #1F293D; border-radius: 8px; padding: 4px; }
            """
        )

        self.engine = DualVlcEngine(self)
        self.engine.configure_auto_fade(
            bool(self.settings.get("auto_fade_at_end", True)),
            float(self.settings.get("auto_fade_end_seconds", 5)),
        )
        self.projector = ProjectorWindow()
        self._scanner: LibraryScannerThread | None = None
        self._black_active = False
        self._freeze_active = False
        self._current_playlist_id: int | None = None
        self._current_playlist_index: int = 0

        self._build_ui()
        self._wire_events()
        self._load_playlists()

        app = QApplication.instance()
        if app is not None:
            app.screenRemoved.connect(self._handle_screen_removed)

    def _build_ui(self) -> None:
        central = QWidget(self)
        self.setCentralWidget(central)
        root = QHBoxLayout(central)
        root.setContentsMargins(12, 12, 12, 12)
        root.setSpacing(12)

        # Left Column: Media Library
        left = QVBoxLayout()
        left_title = QLabel("Media Library")
        left_title.setStyleSheet("font-size: 14px; font-weight: 700;")
        left.addWidget(left_title)

        btn_row = QHBoxLayout()
        self.btn_add_folder = QPushButton("Add Folder")
        self.btn_refresh = QPushButton("Refresh")
        self.btn_queue_selected = QPushButton("+ Playlist")
        btn_row.addWidget(self.btn_add_folder)
        btn_row.addWidget(self.btn_refresh)
        btn_row.addWidget(self.btn_queue_selected)
        left.addLayout(btn_row)

        self.library_list = QListWidget()
        left.addWidget(self.library_list)
        root.addLayout(left, 1)

        # Center Column: Pure Video Preview on top + All Screen Controls strictly below
        center = QVBoxLayout()
        preview_label = QLabel("Operator Video Preview")
        preview_label.setStyleSheet("font-size: 12px; color: #94A3B8; font-weight: 600;")
        center.addWidget(preview_label)

        self.preview_surface = QWidget()
        self.preview_surface.setMinimumHeight(340)
        self.preview_surface.setStyleSheet(
            "background-color: #000000; border: 1px solid #1F293D; border-radius: 8px;"
        )
        center.addWidget(self.preview_surface, 3)

        self.engine.bind_video_window(int(self.preview_surface.winId()))

        self.status_label = QLabel("Ready — All controls below affect Operator & Projector output")
        self.status_label.setStyleSheet("font-size: 12px; color: #A5B4FC;")
        center.addWidget(self.status_label)

        # Transport Controls Below Video
        transport = QHBoxLayout()
        self.btn_prev = QPushButton("PREVIOUS")
        self.btn_play = QPushButton("PLAY / PAUSE")
        self.btn_play.setStyleSheet("background-color: #5E6AD2; color: #FFFFFF; padding: 10px 18px;")
        self.btn_stop = QPushButton("STOP")
        self.btn_next = QPushButton("NEXT")
        transport.addWidget(self.btn_prev)
        transport.addWidget(self.btn_play)
        transport.addWidget(self.btn_stop)
        transport.addWidget(self.btn_next)
        center.addLayout(transport)

        # Manual SMART FADE OUT / FADE IN Controls Below Video
        fade_row = QHBoxLayout()
        self.btn_fade_out = QPushButton("FADE OUT (5s)")
        self.btn_fade_out.setMinimumHeight(52)
        self.btn_fade_out.setStyleSheet(
            "background-color: #7C5CFC; color: #FFFFFF; font-size: 15px; font-weight: 700; padding: 12px 24px;"
        )
        self.btn_fade_in = QPushButton("FADE IN (3s)")
        self.btn_fade_in.setMinimumHeight(52)
        self.btn_fade_in.setStyleSheet("background-color: #1E293B; color: #E0E7FF; padding: 12px 18px;")
        fade_row.addWidget(self.btn_fade_out, 2)
        fade_row.addWidget(self.btn_fade_in, 1)
        center.addLayout(fade_row)

        # Projector & Stage Controls Below Video
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

        # Right Column: Drag-and-Drop Service Playlist Schedule
        right = QVBoxLayout()
        pl_title = QLabel("Service Playlist (Drag to Reorder)")
        pl_title.setStyleSheet("font-size: 14px; font-weight: 700;")
        right.addWidget(pl_title)

        self.playlist_selector = QComboBox()
        right.addWidget(self.playlist_selector)

        self.playlist_widget = QListWidget()
        self.playlist_widget.setDragDropMode(QAbstractItemView.InternalMove)
        self.playlist_widget.setDefaultDropAction(Qt.MoveAction)
        right.addWidget(self.playlist_widget)

        pl_actions = QHBoxLayout()
        self.btn_pl_up = QPushButton("Up")
        self.btn_pl_down = QPushButton("Down")
        pl_actions.addWidget(self.btn_pl_up)
        pl_actions.addWidget(self.btn_pl_down)
        right.addLayout(pl_actions)

        root.addLayout(right, 1)

    def _wire_events(self) -> None:
        self.btn_add_folder.clicked.connect(self._choose_folder)
        self.btn_refresh.clicked.connect(self._scan_all_folders)
        self.btn_queue_selected.clicked.connect(self._add_selected_library_to_playlist)
        self.btn_prev.clicked.connect(self._play_previous_in_playlist)
        self.btn_play.clicked.connect(self.engine.toggle_play_pause)
        self.btn_stop.clicked.connect(self.engine.stop)
        self.btn_next.clicked.connect(self._play_next_in_playlist)
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
        self.playlist_selector.currentIndexChanged.connect(self._on_playlist_changed)
        self.playlist_widget.itemDoubleClicked.connect(self._play_selected_playlist_item)
        self.playlist_widget.model().rowsMoved.connect(self._persist_playlist_order)
        self.btn_pl_up.clicked.connect(lambda: self._move_playlist_row(-1))
        self.btn_pl_down.clicked.connect(lambda: self._move_playlist_row(1))
        self.engine.media_ended.connect(self._play_next_in_playlist)

    def _load_playlists(self) -> None:
        self.playlist_selector.blockSignals(True)
        self.playlist_selector.clear()
        for pl in self.db.list_playlists():
            self.playlist_selector.addItem(pl["name"], pl["id"])
        self.playlist_selector.blockSignals(False)
        if self.playlist_selector.count() > 0:
            self._on_playlist_changed(0)

    def _on_playlist_changed(self, idx: int) -> None:
        pl_id = self.playlist_selector.itemData(idx)
        if pl_id is None:
            return
        self._current_playlist_id = int(pl_id)
        self._current_playlist_index = 0
        self._refresh_playlist_widget()

    def _refresh_playlist_widget(self) -> None:
        self.playlist_widget.clear()
        if self._current_playlist_id is None:
            return
        for row in self.db.get_playlist_items(self._current_playlist_id):
            item = QListWidgetItem(f"[{row['ext']}] {row['name']}")
            item.setData(Qt.UserRole, {"media_id": row["id"], "file_path": row["file_path"]})
            self.playlist_widget.addItem(item)

    def _persist_playlist_order(self) -> None:
        if self._current_playlist_id is None:
            return
        ordered_ids: list[int] = []
        for i in range(self.playlist_widget.count()):
            data = self.playlist_widget.item(i).data(Qt.UserRole)
            if isinstance(data, dict) and "media_id" in data:
                ordered_ids.append(int(data["media_id"]))
        self.db.replace_playlist_order(self._current_playlist_id, ordered_ids)

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

    def _add_selected_library_to_playlist(self) -> None:
        if self._current_playlist_id is None:
            return
        item = self.library_list.currentItem()
        if item is None:
            return
        data = item.data(Qt.UserRole)
        if isinstance(data, dict) and "media_id" in data:
            self.db.add_to_playlist(self._current_playlist_id, int(data["media_id"]))
            self._refresh_playlist_widget()

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
        media_id = self.db.upsert_media(
            file_path=info["file_path"],
            name=info["name"],
            kind=info["kind"],
            ext=info["ext"],
            size_bytes=info["size_bytes"],
        )
        item = QListWidgetItem(f"[{info['ext']}] {info['name']}")
        item.setData(Qt.UserRole, {"media_id": media_id, "file_path": info["file_path"]})
        self.library_list.addItem(item)

    def _play_selected_library_item(self, item: QListWidgetItem) -> None:
        data = item.data(Qt.UserRole)
        if isinstance(data, dict) and "file_path" in data:
            self.engine.load_and_play(str(data["file_path"]))
            self.status_label.setText(f"Playing: {item.text()}")

    def _play_selected_playlist_item(self, item: QListWidgetItem) -> None:
        self._current_playlist_index = self.playlist_widget.row(item)
        data = item.data(Qt.UserRole)
        if isinstance(data, dict) and "file_path" in data:
            self.engine.load_and_play(str(data["file_path"]))
            self.status_label.setText(f"Playing Playlist Item: {item.text()}")

    def _play_next_in_playlist(self) -> None:
        count = self.playlist_widget.count()
        if count == 0:
            return
        next_idx = (self._current_playlist_index + 1) % count
        self._current_playlist_index = next_idx
        self.playlist_widget.setCurrentRow(next_idx)
        item = self.playlist_widget.item(next_idx)
        if item:
            self._play_selected_playlist_item(item)

    def _play_previous_in_playlist(self) -> None:
        count = self.playlist_widget.count()
        if count == 0:
            return
        prev_idx = (self._current_playlist_index - 1) % count
        self._current_playlist_index = prev_idx
        self.playlist_widget.setCurrentRow(prev_idx)
        item = self.playlist_widget.item(prev_idx)
        if item:
            self._play_selected_playlist_item(item)

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
