from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class AppPaths:
    root: Path
    config: Path
    playlists: Path
    media_library: Path
    cache: Path
    thumbnails: Path
    logs: Path
    backups: Path
    mode: str


def resolve_app_paths(mode: str = "portable", custom_root: Path | None = None) -> AppPaths:
    """
    Resolves GENDEV directory layout:
    GENDEV/
    ├── GENDEV.exe
    ├── Config/
    ├── Playlists/
    ├── MediaLibrary/
    ├── Cache/
    ├── Thumbnails/
    ├── Logs/
    └── Backups/
    """
    if custom_root is not None:
        base = custom_root
    elif mode == "portable":
        if getattr(sys, "frozen", False):
            base = Path(sys.executable).resolve().parent
        else:
            base = Path(__file__).resolve().parents[3] / "GENDEV_DATA"
    else:
        appdata = os.environ.get("LOCALAPPDATA") or str(Path.home())
        base = Path(appdata) / "GENDEV Worship Media Player"

    paths = AppPaths(
        root=base,
        config=base / "Config",
        playlists=base / "Playlists",
        media_library=base / "MediaLibrary",
        cache=base / "Cache",
        thumbnails=base / "Thumbnails",
        logs=base / "Logs",
        backups=base / "Backups",
        mode=mode,
    )

    for folder in (
        paths.root,
        paths.config,
        paths.playlists,
        paths.media_library,
        paths.cache,
        paths.thumbnails,
        paths.logs,
        paths.backups,
    ):
        folder.mkdir(parents=True, exist_ok=True)

    return paths
