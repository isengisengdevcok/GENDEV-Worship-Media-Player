# -*- mode: python ; coding: utf-8 -*-
import os
from pathlib import Path

block_cipher = None
project_root = Path(SPECPATH)
vlc_runtime = project_root / "vendor" / "vlc"

datas = []
binaries = []

if vlc_runtime.exists():
    for file_path in vlc_runtime.rglob("*"):
        if file_path.is_file():
            rel_parent = str(Path("vlc") / file_path.relative_to(vlc_runtime).parent)
            if file_path.suffix.lower() == ".dll":
                binaries.append((str(file_path), rel_parent))
            else:
                datas.append((str(file_path), rel_parent))

a = Analysis(
    ["desktop/main.py"],
    pathex=[str(project_root)],
    binaries=binaries,
    datas=datas,
    hiddenimports=["PySide6.QtCore", "PySide6.QtGui", "PySide6.QtWidgets", "vlc"],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "scipy", "numpy"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# One-file Portable EXE
exe_portable = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="GENDEV Worship Media Player Portable",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
)

# Directory bundle for Inno Setup Installer
exe_dir = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="GENDEV",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
)

coll = COLLECT(
    exe_dir,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="GENDEV_Dir",
)
