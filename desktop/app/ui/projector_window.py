from __future__ import annotations

from pathlib import Path
from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import QGraphicsOpacityEffect, QLabel, QVBoxLayout, QWidget


class ProjectorWindow(QWidget):
    """
    Zero-UI Projector Output window.
    - Dual Monitor: Frameless fullscreen on Monitor 2 (zero operator controls).
    - Single Monitor fallback: Movable 960x540 window (never traps laptop screen in blank fullscreen).
    - ESC key or closing window emits `closed` so Operator Console cleanly rebinds video.
    """

    closed = Signal()

    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("GENDEV Projector Output (Monitor 2)")
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

        self.logo_overlay = QLabel(self)
        self.logo_overlay.setStyleSheet("background: transparent;")
        self.logo_overlay.setScaledContents(True)
        self._logo_opacity = QGraphicsOpacityEffect(self.logo_overlay)
        self._logo_opacity.setOpacity(0.72)
        self.logo_overlay.setGraphicsEffect(self._logo_opacity)
        self.logo_overlay.hide()

        self._logo_path = ""
        self._logo_visible = True
        self._logo_position = "bottom-right"
        self._logo_size = 72

        self.countdown_overlay = QLabel(self)
        self.countdown_overlay.setAlignment(Qt.AlignCenter)
        self.countdown_overlay.setStyleSheet(
            "background-color: rgba(10, 13, 20, 175); color: #FFFFFF; font-size: 76px; font-weight: 700;"
        )
        self.countdown_overlay.hide()

        self.black_curtain = QWidget(self)
        self.black_curtain.setStyleSheet("background-color: #000000;")
        self.black_curtain.hide()

    def keyPressEvent(self, event) -> None:  # type: ignore[override]
        if event.key() == Qt.Key_Escape:
            self.hide()
            self.closed.emit()
            event.accept()
            return
        super().keyPressEvent(event)

    def closeEvent(self, event) -> None:  # type: ignore[override]
        self.closed.emit()
        super().closeEvent(event)

    def mouseDoubleClickEvent(self, event) -> None:  # type: ignore[override]
        if self.isFullScreen():
            self.showNormal()
        else:
            self.showFullScreen()
        super().mouseDoubleClickEvent(event)

    def resizeEvent(self, event) -> None:  # type: ignore[override]
        super().resizeEvent(event)
        rect = self.rect()
        self.freeze_overlay.setGeometry(rect)
        self.countdown_overlay.setGeometry(rect)
        self.black_curtain.setGeometry(rect)
        self._position_logo()

    def show_on_screen(self, screen) -> None:
        self.setWindowFlags(Qt.Window | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint)
        self.setGeometry(screen.geometry())
        self.showFullScreen()
        self._position_logo()

    def show_windowed_preview(self, screen) -> None:
        """Safe non-trapping 16:9 window when only 1 screen is connected."""
        self.setWindowFlags(Qt.Window)
        geo = screen.availableGeometry()
        w, h = min(960, max(640, geo.width() - 120)), min(540, max(360, geo.height() - 120))
        x = geo.x() + (geo.width() - w) // 2
        y = geo.y() + (geo.height() - h) // 2
        self.setGeometry(x, y, w, h)
        self.showNormal()
        self.raise_()
        self._position_logo()

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
                if self._logo_visible:
                    self.logo_overlay.raise_()
                if self.countdown_overlay.isVisible():
                    self.countdown_overlay.raise_()
                if self.black_curtain.isVisible():
                    self.black_curtain.raise_()
                return
        self.freeze_overlay.hide()

    def update_logo(
        self, visible: bool, logo_path: str, position: str, size_px: int, opacity: float
    ) -> None:
        self._logo_visible = visible
        self._logo_path = logo_path
        self._logo_position = position
        self._logo_size = max(32, min(160, int(size_px)))
        self._logo_opacity.setOpacity(max(0.15, min(1.0, float(opacity))))

        if visible and logo_path and Path(logo_path).exists():
            pix = QPixmap(logo_path)
            if not pix.isNull():
                self.logo_overlay.setPixmap(pix)
                self._position_logo()
                self.logo_overlay.show()
                self.logo_overlay.raise_()
                if self.black_curtain.isVisible():
                    self.black_curtain.raise_()
                return
        self.logo_overlay.hide()

    def _position_logo(self) -> None:
        margin = 24
        sz = self._logo_size
        w = self.width()
        h = self.height()
        if self._logo_position == "top-left":
            x, y = margin, margin
        elif self._logo_position == "top-right":
            x, y = max(margin, w - sz - margin), margin
        elif self._logo_position == "bottom-left":
            x, y = margin, max(margin, h - sz - margin)
        else:
            x, y = max(margin, w - sz - margin), max(margin, h - sz - margin)
        self.logo_overlay.setGeometry(x, y, sz, sz)

    def update_countdown(self, visible: bool, label: str, time_text: str) -> None:
        if visible:
            self.countdown_overlay.setText(
                f"<div style='font-size:20px; color:#A5B4FC; letter-spacing:2px; font-weight:600;'>{label}</div>"
                f"<div style='font-size:88px; font-weight:800; color:#FFFFFF;'>{time_text}</div>"
            )
            self.countdown_overlay.show()
            self.countdown_overlay.raise_()
            if self.black_curtain.isVisible():
                self.black_curtain.raise_()
        else:
            self.countdown_overlay.hide()
