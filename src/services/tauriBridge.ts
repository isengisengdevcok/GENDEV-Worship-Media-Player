import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { emit, listen, UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

export interface TauriDisplayInfo {
  id: string;
  label: string;
  width: number;
  height: number;
  x: number;
  y: number;
  isPrimary: boolean;
}

export interface TauriProjectorOpenResult {
  opened: boolean;
  mode: 'dual-fullscreen' | 'single-windowed';
  monitorLabel: string;
}

export interface TauriScannedDiskFile {
  name: string;
  kind: 'video' | 'audio';
  format: string;
  sizeBytes: number;
  absolutePath: string;
  relativePath: string;
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function toTauriAssetUrl(filePath: string): string {
  if (!isTauriRuntime()) return filePath;
  return convertFileSrc(filePath);
}

export async function tauriListDisplays(): Promise<TauriDisplayInfo[]> {
  return invoke<TauriDisplayInfo[]>('list_displays');
}

export async function tauriOpenProjector(
  screenId?: string
): Promise<TauriProjectorOpenResult> {
  return invoke<TauriProjectorOpenResult>('open_projector_window', {
    screenId: screenId || null,
  });
}

export async function tauriCloseProjector(): Promise<void> {
  return invoke<void>('close_projector_window');
}

export async function tauriPickMediaFolder(): Promise<string | null> {
  return invoke<string | null>('pick_media_folder');
}

export async function tauriPickMediaFiles(): Promise<string[]> {
  return invoke<string[]>('pick_media_files');
}

export async function tauriPickSingleMediaFile(): Promise<string | null> {
  return invoke<string | null>('pick_single_media_file');
}

export async function tauriScanFolder(
  folderPath: string,
  recursive: boolean
): Promise<TauriScannedDiskFile[]> {
  return invoke<TauriScannedDiskFile[]>('scan_folder_recursive', {
    folderPath,
    recursive,
  });
}

export async function tauriVerifyFilesExist(paths: string[]): Promise<boolean[]> {
  return invoke<boolean[]>('verify_files_exist', { paths });
}

export async function tauriInspectDiskFiles(paths: string[]): Promise<TauriScannedDiskFile[]> {
  return invoke<TauriScannedDiskFile[]>('inspect_disk_files', { paths });
}

export async function tauriReadTextFile(filePath: string): Promise<string> {
  return invoke<string>('read_text_file', { filePath });
}

export async function tauriOpenInExplorer(targetPath: string): Promise<void> {
  return invoke<void>('open_in_explorer', { targetPath });
}

export async function tauriSaveBackupFile(jsonContent: string): Promise<boolean> {
  return invoke<boolean>('save_backup_file', { jsonContent });
}

export async function tauriEmit<T>(eventName: string, payload: T): Promise<void> {
  if (!isTauriRuntime()) return;
  await emit(eventName, payload);
}

export async function tauriListen<T>(
  eventName: string,
  handler: (payload: T) => void
): Promise<UnlistenFn | null> {
  if (!isTauriRuntime()) return null;
  return listen<T>(eventName, (ev) => handler(ev.payload));
}

export async function tauriToggleCurrentWindowFullscreen(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const win = getCurrentWindow();
  const current = await win.isFullscreen();
  await win.setFullscreen(!current);
  return !current;
}
