# GENDEV Worship Media Player

**Professional Multimedia Control for Worship**

GENDEV Worship Media Player is a lightweight Windows desktop & dual-screen presentation workstation built with **Tauri v2 (Rust + Windows WebView2)** and **React 19 + TypeScript**, ensuring 1:1 parity between the live preview and the compiled Windows `.exe` (~5–15 MB).

---

## Architecture

1. **Tauri v2 Native Desktop Core (`src-tauri/`)**
   - Ultra-lightweight Rust backend (`~5–15 MB` standalone `.exe`) using built-in Windows WebView2.
   - Native Windows multi-monitor enumeration & safe Monitor 2 Fullscreen Projector window (`open_projector_window` / `close_projector_window`), plus safe windowed fallback on 1-display PCs so the laptop screen never turns blank.
   - Recursive local & USB drive directory scanner (`walkdir`), zero-copy streaming via Tauri `asset://` protocol, native Windows Explorer (`open_in_explorer`), and native drag-and-drop paths.
2. **Unified Operator & Projector UI (`src/`)**
   - Built with React 19, TypeScript, Tailwind CSS, Web Audio API (`GainNode` sample-accurate Fade Out/In, Auto-Fade at End, Dual-Deck Audio Crossfade, Background Music Auto-Ducking), IndexedDB persistence, SRT/VTT subtitle rendering, and real-time Monitor 2 sync.
3. **Automated GitHub Actions Windows Build & Release (`.github/workflows/windows-build-release.yml`)**

---

## Core Operator Features

- **Smart Fade Out & Fade In**: Configurable durations (`1, 2, 3, 5, 10, 15s`), start/end volumes, and automatic Pause or Stop when volume reaches `0%`.
- **Auto Fade Out at End & Audio Crossfade**: Automatically fades out `3, 5, 10, 15s` before media ends and crossfades smoothly between tracks.
- **Dual Display / Projector Mode**: Operator console on Monitor 1; clean zero-UI fullscreen output on Monitor 2 (`Send to Projector` / `Exit Projector`).
- **Black Screen & Freeze Frame**: Instant stage blackout or frozen video frame on the projector while audio and playlists continue uninterrupted.
- **Background Music Automation**: Dedicated BGM deck and playlist with automatic fade-out when main video starts and automatic fade-in when video ends.
- **Custom Media Library**: Non-destructive recursive directory scanning across drives C:, D:, E:, and external USB/HDD storage, with `Missing File` detection, `Locate File` re-linking, and `Open in Windows Explorer`.
- **Playlist Manager**: Permanent playlists (`Ibadah Minggu`, `Pujian dan Penyembahan`, `Natal`, `Paskah`, `Pemuda`, `Pengumuman Gereja`, `Video Dokumentasi`), drag-and-drop ordering, Repeat One/All, Shuffle, Queue Next, and session restore.
- **Countdown Timer, Digital Clock & Church Watermark Logo**: Configurable corner logo watermark, live service clock, and optional projector countdown overlay.

---

## Building Windows EXEs via GitHub Actions

Push this repository to GitHub and either:

1. Push to `main`/`master` or tag a semantic version:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
2. Or run **Actions -> Build and Release GENDEV Worship Media Player (Windows Tauri) -> Run workflow**.

The `windows-latest` workflow will:
- Run `npm run lint` and `npm run build`
- Compile `src-tauri/` with Rust (`npx tauri build --bundles nsis`)
- Package `GENDEV Worship Media Player Portable.exe` (~5–15 MB)
- Package `GENDEV Worship Media Player Setup.exe` (NSIS installer)
- Package `GENDEV Worship Media Player.zip` & `SHA256SUMS.txt`
- Publish the GitHub Release automatically using `GITHUB_TOKEN`.
