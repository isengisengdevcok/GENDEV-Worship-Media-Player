from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import QLabel, QVBoxLayout, QWidget


class ProjectorWindow(QWidget):
    """
    Frameless zero-UI secondary monitor fullscreen output window.
    Supports Black Screen curtain, Freeze Frame snapshot overlay, and Countdown display.
    """

    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("GENDEV Projector Output")
        self.setWindowFlags(Qt.Window | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint)
        self.setStyleSheet("background-color: #000000;")

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)

        self.video_surface = QWidget(self)
        self.video_surface.setStyleSheet("background-color: #000000;")
        layout.addWidget(self.video_surface)

        self.freeze_overlay = QLabel(self)
        self.freeze_overlay.setAlignment(Qt.AlignCenter)
        self.freeze_overlay.setStyleSheet("background-color: #000000;")
        self.freeze_overlay.hide()

        self.black_curtain = QWidget(self)
        self.black_curtain.setStyleSheet("background-color: #000000;")
        self.black_curtain.hide()

    def resizeEvent(self, event) -> None:  # type: ignore[override]
        super().resizeEvent(event)
        rect = self.rect()
        self.freeze_overlay.setGeometry(rect)
        self.black_curtain.setGeometry(rect)

    def show_on_screen(self, screen) -> None:
        self.setGeometry(screen.geometry())
        self.showFullScreen()

    def set_black_screen(self, enabled: bool) -> None:
        if enabled:
            self.black_curtain.raise_()
            self.black_curtain.show()
        else:
            self.black_curtain.hide()

    def set_freeze_frame(self, enabled: bool, image_path: str | None = None) -> None:
        if enabled and image_path:
            pix = QPixmap(image_path)
            if not pix.isNull():
                self.freeze_overlay.setPixmap(
                    pix.scaled(self.size(), Qt.KeepAspectRatio, Qt.SmoothTransformation)
                )
                self.freeze_overlay.raise_()
                self.freeze_overlay.show()
                return
        self.freeze_overlay.hide()
