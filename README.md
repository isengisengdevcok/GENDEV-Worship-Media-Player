# GENDEV Worship Media Player

**Professional Multimedia Control for Worship**

GENDEV Worship Media Player is a church presentation, video, and audio playback workstation designed for reliability during live worship services.

---

## Included Implementations in This Repository

1. **Interactive Web & Dual-Screen Studio Console** (`src/`)
   - Built with React 19, TypeScript, Tailwind CSS, Web Audio API (`GainNode` sample-accurate Fade Out/In, Auto-Fade at End, Dual-Deck Audio Crossfade, Background Music Auto-Ducking), IndexedDB persistence, File System Access API (`showDirectoryPicker`), SRT/VTT subtitle rendering, and `BroadcastChannel` Monitor 2 Projector sync.
2. **Windows Native Desktop Edition** (`desktop/`, `gendev.spec`, `installer/gendev_setup.iss`)
   - Built with Python 3, PySide6, LibVLC (`python-vlc`), SQLite, and Pillow for Windows 10/11 (optimized for low-RAM hardware such as Intel Celeron N4020 / 4 GB RAM).
3. **Automated GitHub Actions Windows Build & Release** (`.github/workflows/windows-build-release.yml`)

---

## Core Operator Features

- **Smart Fade Out & Fade In**: Configurable durations (`1, 2, 3, 5, 10, 15s`), start/end volumes, and automatic Pause or Stop when volume reaches `0%`.
- **Auto Fade Out at End & Audio Crossfade**: Automatically fades out `3, 5, 10, 15s` before media ends and crossfades smoothly between tracks.
- **Dual Display / Projector Mode**: Operator console on Monitor 1; clean zero-UI fullscreen output on Monitor 2 (`Send to Projector` / `Exit Projector`).
- **Black Screen & Freeze Frame**: Instant stage blackout or frozen video frame on the projector while audio and playlists continue uninterrupted.
- **Background Music Automation**: Dedicated BGM deck and playlist with automatic fade-out when main video starts and automatic fade-in when video ends.
- **Custom Media Library**: Non-destructive recursive directory scanning across local drives and external USB/HDD storage, with `Missing File` detection and `Locate File` re-linking.
- **Playlist Manager**: Permanent playlists (`Ibadah Minggu`, `Pujian dan Penyembahan`, `Natal`, `Paskah`, `Pemuda`, `Pengumuman Gereja`, `Video Dokumentasi`), drag-and-drop ordering, Repeat One/All, Shuffle, Queue Next, and session restore.
- **Countdown Timer, Digital Clock & Church Watermark Logo**: Configurable corner logo watermark, live service clock, and optional projector countdown overlay.

---

## Directory Structure (Portable & Installation Modes)

```text
GENDEV/
├── GENDEV.exe
├── Config/
├── Playlists/
├── MediaLibrary/
├── Cache/
├── Thumbnails/
├── Logs/
└── Backups/
```

---

## Building Windows EXEs via GitHub Actions

Push this repository to GitHub and either:

1. Push a semantic version tag:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
2. Or run **Actions -> Build and Release GENDEV Worship Media Player (Windows) -> Run workflow**.

The `windows-latest` workflow will:
- Bundle 64-bit LibVLC runtime
- Run Python compilation & unit tests (`desktop/tests/test_core.py`)
- Build `GENDEV Worship Media Player Portable.exe` (PyInstaller)
- Build `GENDEV Worship Media Player Setup.exe` (Inno Setup)
- Package `GENDEV Worship Media Player.zip` & `SHA256SUMS.txt`
- Publish the GitHub Release automatically using `GITHUB_TOKEN` (only when all build checks pass).
