from __future__ import annotations

import os
from pathlib import Path
from PySide6.QtCore import QThread, Signal

VIDEO_EXTS = {".mp4", ".mkv", ".avi", ".mov", ".wmv", ".webm", ".m4v", ".mpg", ".mpeg"}
AUDIO_EXTS = {".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a", ".opus", ".wma"}


class LibraryScannerThread(QThread):
    """Non-blocking background media directory scanner optimized for low-RAM systems."""

    progress = Signal(int, str)
    file_discovered = Signal(dict)
    finished_scan = Signal(int)

    def __init__(self, folders: list[str], recursive: bool = True) -> None:
        super().__init__()
        self.folders = folders
        self.recursive = recursive
        self._cancelled = False

    def cancel(self) -> None:
        self._cancelled = True

    def run(self) -> None:
        count = 0
        for folder_str in self.folders:
            if self._cancelled:
                break
            root = Path(folder_str)
            if not root.exists():
                continue

            if self.recursive:
                walker = os.walk(root)
                for dirpath, _, filenames in walker:
                    if self._cancelled:
                        break
                    for fname in filenames:
                        if self._cancelled:
                            break
                        ext = Path(fname).suffix.lower()
                        if ext in VIDEO_EXTS or ext in AUDIO_EXTS:
                            full = Path(dirpath) / fname
                            kind = "video" if ext in VIDEO_EXTS else "audio"
                            try:
                                size = full.stat().st_size
                            except OSError:
                                size = 0
                            count += 1
                            self.file_discovered.emit(
                                {
                                    "file_path": str(full.resolve()),
                                    "name": full.stem,
                                    "kind": kind,
                                    "ext": ext.lstrip(".").upper(),
                                    "size_bytes": size,
                                }
                            )
                            self.progress.emit(count, str(full))
            else:
                for entry in root.iterdir():
                    if self._cancelled:
                        break
                    if entry.is_file():
                        ext = entry.suffix.lower()
                        if ext in VIDEO_EXTS or ext in AUDIO_EXTS:
                            kind = "video" if ext in VIDEO_EXTS else "audio"
                            count += 1
                            self.file_discovered.emit(
                                {
                                    "file_path": str(entry.resolve()),
                                    "name": entry.stem,
                                    "kind": kind,
                                    "ext": ext.lstrip(".").upper(),
                                    "size_bytes": entry.stat().st_size,
                                }
                            )
                            self.progress.emit(count, str(entry))

        self.finished_scan.emit(count)
