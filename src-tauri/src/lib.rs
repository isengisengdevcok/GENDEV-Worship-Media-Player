use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{
    AppHandle, DragDropEvent, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size,
    WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_dialog::DialogExt;
use walkdir::WalkDir;

const VIDEO_EXTS: &[&str] = &["mp4", "mkv", "avi", "mov", "wmv", "webm", "m4v", "mpg", "mpeg"];
const AUDIO_EXTS: &[&str] = &["mp3", "wav", "flac", "aac", "ogg", "m4a", "wma"];

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    pub id: String,
    pub label: String,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub is_primary: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectorOpenResult {
    pub opened: bool,
    pub mode: String, // "dual-fullscreen" | "single-windowed"
    pub monitor_label: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScannedDiskFile {
    pub name: String,
    pub kind: String,
    pub format: String,
    pub size_bytes: u64,
    pub absolute_path: String,
    pub relative_path: String,
}

fn classify_extension(path: &Path) -> Option<(&'static str, String)> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    if VIDEO_EXTS.contains(&ext.as_str()) {
        return Some(("video", ext.to_ascii_uppercase()));
    }
    if AUDIO_EXTS.contains(&ext.as_str()) {
        return Some(("audio", ext.to_ascii_uppercase()));
    }
    None
}

fn normalize_display_id(idx: usize, is_primary: bool) -> String {
    if is_primary {
        "primary".to_string()
    } else {
        format!("screen-{}", idx)
    }
}

#[tauri::command]
fn list_displays(app: AppHandle) -> Result<Vec<DisplayInfo>, String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    let primary = app.primary_monitor().map_err(|e| e.to_string())?;
    let primary_sig = primary.map(|p| {
        let pos = p.position();
        let sz = p.size();
        (pos.x, pos.y, sz.width, sz.height)
    });

    let mut out = Vec::with_capacity(monitors.len());
    for (idx, m) in monitors.iter().enumerate() {
        let pos = m.position();
        let sz = m.size();
        let is_primary = primary_sig == Some((pos.x, pos.y, sz.width, sz.height));
        let label = m
            .name()
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| {
                if is_primary {
                    format!("Primary Display {}", idx + 1)
                } else {
                    format!("Projector Display {}", idx + 1)
                }
            });
        out.push(DisplayInfo {
            id: normalize_display_id(idx, is_primary),
            label,
            width: sz.width,
            height: sz.height,
            x: pos.x,
            y: pos.y,
            is_primary,
        });
    }
    Ok(out)
}

#[tauri::command]
fn open_projector_window(
    app: AppHandle,
    screen_id: Option<String>,
) -> Result<ProjectorOpenResult, String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    let primary = app.primary_monitor().map_err(|e| e.to_string())?;
    let primary_sig = primary.map(|p| {
        let pos = p.position();
        let sz = p.size();
        (pos.x, pos.y, sz.width, sz.height)
    });

    // Select Monitor 2 (non-primary) when >1 displays exist so Monitor 1 never turns blank.
    let secondary_monitor = if monitors.len() > 1 {
        let requested = screen_id.unwrap_or_else(|| "secondary".to_string());
        let mut chosen = None;
        for (idx, m) in monitors.iter().enumerate() {
            let pos = m.position();
            let sz = m.size();
            let is_primary = primary_sig == Some((pos.x, pos.y, sz.width, sz.height));
            let id = normalize_display_id(idx, is_primary);
            if !is_primary && (requested == "secondary" || requested == id) {
                chosen = Some(m.clone());
                break;
            }
        }
        chosen.or_else(|| {
            monitors
                .iter()
                .find(|m| {
                    let pos = m.position();
                    let sz = m.size();
                    primary_sig != Some((pos.x, pos.y, sz.width, sz.height))
                })
                .cloned()
        })
    } else {
        None
    };

    if let Some(existing) = app.get_webview_window("projector") {
        if let Some(target) = &secondary_monitor {
            let pos = target.position();
            let sz = target.size();
            let _ = existing.set_fullscreen(false);
            let _ = existing.set_decorations(false);
            let _ = existing.set_position(Position::Physical(PhysicalPosition::new(pos.x, pos.y)));
            let _ = existing.set_size(Size::Physical(PhysicalSize::new(sz.width, sz.height)));
            let _ = existing.set_fullscreen(true);
            let _ = existing.show();
            let _ = existing.set_focus();
            return Ok(ProjectorOpenResult {
                opened: true,
                mode: "dual-fullscreen".to_string(),
                monitor_label: target
                    .name()
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "Monitor 2".to_string()),
            });
        } else {
            let _ = existing.set_fullscreen(false);
            let _ = existing.set_decorations(true);
            let _ = existing.show();
            let _ = existing.set_focus();
            return Ok(ProjectorOpenResult {
                opened: true,
                mode: "single-windowed".to_string(),
                monitor_label: "Windowed Projector".to_string(),
            });
        }
    }

    if let Some(target) = secondary_monitor {
        let pos = target.position();
        let sz = target.size();
        let win = WebviewWindowBuilder::new(
            &app,
            "projector",
            WebviewUrl::App("index.html?mode=projector".into()),
        )
        .title("GENDEV Projector Output (Monitor 2)")
        .decorations(false)
        .always_on_top(true)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;

        let _ = win.set_position(Position::Physical(PhysicalPosition::new(pos.x, pos.y)));
        let _ = win.set_size(Size::Physical(PhysicalSize::new(sz.width, sz.height)));
        let _ = win.set_fullscreen(true);
        let _ = win.show();

        let app_handle = app.clone();
        win.on_window_event(move |event| {
            if let WindowEvent::Destroyed = event {
                let _ = app_handle.emit("gendev-projector-closed", ());
            }
        });

        Ok(ProjectorOpenResult {
            opened: true,
            mode: "dual-fullscreen".to_string(),
            monitor_label: target
                .name()
                .map(|s| s.to_string())
                .unwrap_or_else(|| "Monitor 2".to_string()),
        })
    } else {
        // Safe single-monitor movable window — never traps the laptop screen in blank fullscreen!
        let win = WebviewWindowBuilder::new(
            &app,
            "projector",
            WebviewUrl::App("index.html?mode=projector".into()),
        )
        .title("GENDEV Projector Output (Double-click Fullscreen · ESC to Exit)")
        .inner_size(960.0, 540.0)
        .center()
        .decorations(true)
        .always_on_top(false)
        .resizable(true)
        .build()
        .map_err(|e| e.to_string())?;

        let app_handle = app.clone();
        win.on_window_event(move |event| {
            if let WindowEvent::Destroyed = event {
                let _ = app_handle.emit("gendev-projector-closed", ());
            }
        });

        Ok(ProjectorOpenResult {
            opened: true,
            mode: "single-windowed".to_string(),
            monitor_label: "Windowed Stage".to_string(),
        })
    }
}

#[tauri::command]
fn close_projector_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("projector") {
        win.close().map_err(|e| e.to_string())?;
    }
    let _ = app.emit("gendev-projector-closed", ());
    Ok(())
}

#[tauri::command]
async fn pick_media_folder(app: AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Select Media Folder")
            .blocking_pick_folder()
            .and_then(|fp| fp.into_path().ok())
            .map(|p| p.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn pick_media_files(app: AppHandle) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Select Video, Audio, or Subtitle Files")
            .add_filter(
                "Media & Subtitles",
                &[
                    "mp4", "mkv", "avi", "mov", "wmv", "webm", "m4v", "mp3", "wav", "flac", "aac",
                    "ogg", "m4a", "srt", "vtt",
                ],
            )
            .blocking_pick_files()
            .map(|files| {
                files
                    .into_iter()
                    .filter_map(|fp| fp.into_path().ok())
                    .map(|p| p.to_string_lossy().to_string())
                    .collect()
            })
            .unwrap_or_default()
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn pick_single_media_file(app: AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Locate Missing Media File")
            .add_filter(
                "Media Files",
                &[
                    "mp4", "mkv", "avi", "mov", "wmv", "webm", "m4v", "mp3", "wav", "flac", "aac",
                    "ogg", "m4a",
                ],
            )
            .blocking_pick_file()
            .and_then(|fp| fp.into_path().ok())
            .map(|p| p.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn scan_folder_recursive(
    folder_path: String,
    recursive: bool,
) -> Result<Vec<ScannedDiskFile>, String> {
    let root = PathBuf::from(&folder_path);
    if !root.exists() {
        return Err(format!("Folder not found: {}", folder_path));
    }
    let mut walker = WalkDir::new(&root);
    if !recursive {
        walker = walker.max_depth(1);
    }

    let mut out = Vec::new();
    for entry in walker.into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        if let Some((kind, format)) = classify_extension(path) {
            let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Media")
                .to_string();
            let relative_path = path
                .strip_prefix(&root)
                .unwrap_or(path)
                .to_string_lossy()
                .to_string();
            out.push(ScannedDiskFile {
                name,
                kind: kind.to_string(),
                format,
                size_bytes,
                absolute_path: path.to_string_lossy().to_string(),
                relative_path,
            });
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

#[tauri::command]
fn verify_files_exist(paths: Vec<String>) -> Vec<bool> {
    paths.into_iter().map(|p| Path::new(&p).exists()).collect()
}

#[tauri::command]
fn read_text_file(file_path: String) -> Result<String, String> {
    fs::read_to_string(&file_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn inspect_disk_files(paths: Vec<String>) -> Vec<ScannedDiskFile> {
    let mut out = Vec::new();
    for raw in paths {
        let p = PathBuf::from(&raw);
        if p.is_file() {
            if let Some((kind, format)) = classify_extension(&p) {
                let size_bytes = fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
                let name = p
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Media")
                    .to_string();
                let file_name = p
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or(&name)
                    .to_string();
                out.push(ScannedDiskFile {
                    name,
                    kind: kind.to_string(),
                    format,
                    size_bytes,
                    absolute_path: p.to_string_lossy().to_string(),
                    relative_path: file_name,
                });
            }
        }
    }
    out
}

#[tauri::command]
fn open_in_explorer(target_path: String) -> Result<(), String> {
    let p = Path::new(&target_path);
    if !p.exists() {
        return Err("File or folder not found on disk".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        if p.is_file() {
            std::process::Command::new("explorer")
                .arg(format!("/select,{}", p.display()))
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            std::process::Command::new("explorer")
                .arg(p)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(if p.is_file() { "-R" } else { "" })
            .arg(p)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let dir = if p.is_file() {
            p.parent().unwrap_or(p)
        } else {
            p
        };
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn save_backup_file(app: AppHandle, json_content: String) -> Result<bool, String> {
    let saved_path = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Export GENDEV Configuration Backup")
            .set_file_name("gendev-worship-backup.json")
            .add_filter("JSON Backup", &["json"])
            .blocking_save_file()
            .and_then(|fp| fp.into_path().ok())
    })
    .await
    .map_err(|e| e.to_string())?;

    if let Some(path) = saved_path {
        fs::write(path, json_content).map_err(|e| e.to_string())?;
        return Ok(true);
    }
    Ok(false)
}

fn ensure_portable_dirs(app: &AppHandle) {
    let base = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .or_else(|| app.path().app_data_dir().ok());

    if let Some(root) = base {
        let probe = root.join("Config");
        let target_root = if fs::create_dir_all(&probe).is_ok() {
            root
        } else if let Ok(data_dir) = app.path().app_data_dir() {
            data_dir
        } else {
            return;
        };
        for folder in [
            "Config",
            "Playlists",
            "MediaLibrary",
            "Cache",
            "Thumbnails",
            "Logs",
            "Backups",
        ] {
            let _ = fs::create_dir_all(target_root.join(folder));
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            ensure_portable_dirs(app.handle());
            if let Some(main_win) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                main_win.on_window_event(move |event| match event {
                    WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) => {
                        let str_paths: Vec<String> = paths
                            .iter()
                            .map(|p| p.to_string_lossy().to_string())
                            .collect();
                        let _ = app_handle.emit("gendev-files-dropped", str_paths);
                    }
                    WindowEvent::Destroyed => {
                        if let Some(proj) = app_handle.get_webview_window("projector") {
                            let _ = proj.close();
                        }
                    }
                    _ => {}
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_displays,
            open_projector_window,
            close_projector_window,
            pick_media_folder,
            pick_media_files,
            pick_single_media_file,
            scan_folder_recursive,
            verify_files_exist,
            read_text_file,
            inspect_disk_files,
            open_in_explorer,
            save_backup_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running GENDEV Worship Media Player");
}
