import { LibraryFolder, MediaItem, MediaKind } from '../types/media';
import { detectMediaKind, getExtension } from '../utils/formatters';
import { saveFileHandle, getFileHandle } from './storage';

/**
 * Extracts real duration, resolution, and a lightweight video thumbnail
 * without copying the source file or overloading low-RAM hardware.
 */
export async function probeMediaMetadata(
  file: File,
  kind: MediaKind,
  url: string
): Promise<{ durationSec: number; resolution?: string; thumbnailUrl?: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (res: { durationSec: number; resolution?: string; thumbnailUrl?: string }) => {
      if (!settled) {
        settled = true;
        resolve(res);
      }
    };

    const timeout = window.setTimeout(() => {
      finish({ durationSec: 0 });
    }, 4500);

    if (kind === 'video') {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;

      video.onloadedmetadata = () => {
        const durationSec = Number.isFinite(video.duration) ? video.duration : 0;
        const resolution =
          video.videoWidth && video.videoHeight
            ? `${video.videoWidth}x${video.videoHeight}`
            : undefined;

        // Seek slightly into the video for a crisp representative thumbnail
        const targetSeek = durationSec > 2 ? Math.min(1.5, durationSec * 0.15) : 0;
        video.currentTime = targetSeek;
      };

      video.onseeked = () => {
        try {
          const canvas = document.createElement('canvas');
          const thumbW = 320;
          const aspect =
            video.videoWidth && video.videoHeight ? video.videoHeight / video.videoWidth : 9 / 16;
          canvas.width = thumbW;
          canvas.height = Math.round(thumbW * aspect);
          const ctx = canvas.getContext('2d');
          let thumbnailUrl: string | undefined;
          if (ctx && video.videoWidth > 0) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            thumbnailUrl = canvas.toDataURL('image/jpeg', 0.72);
          }
          clearTimeout(timeout);
          finish({
            durationSec: Number.isFinite(video.duration) ? video.duration : 0,
            resolution:
              video.videoWidth && video.videoHeight
                ? `${video.videoWidth}x${video.videoHeight}`
                : undefined,
            thumbnailUrl,
          });
        } catch {
          clearTimeout(timeout);
          finish({
            durationSec: Number.isFinite(video.duration) ? video.duration : 0,
          });
        }
      };

      video.onerror = () => {
        clearTimeout(timeout);
        finish({ durationSec: 0 });
      };

      video.src = url;
    } else {
      const audio = document.createElement('audio');
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => {
        clearTimeout(timeout);
        finish({
          durationSec: Number.isFinite(audio.duration) ? audio.duration : 0,
        });
      };
      audio.onerror = () => {
        clearTimeout(timeout);
        finish({ durationSec: 0 });
      };
      audio.src = url;
    }

    // Prevent unused warning on file
    void file;
  });
}

export async function buildMediaItemFromFile(
  file: File,
  folderId: string,
  folderName: string,
  relativePath?: string,
  handleKey?: string
): Promise<MediaItem | null> {
  const kind = detectMediaKind(file.name);
  if (!kind) return null;

  const url = URL.createObjectURL(file);
  const meta = await probeMediaMetadata(file, kind, url);
  const rel = relativePath || file.webkitRelativePath || file.name;
  const id = handleKey
    ? `local_${handleKey}`
    : `file_${folderId}_${rel}_${file.size}_${file.lastModified}`.replace(/[^a-zA-Z0-9_-]/g, '_');

  return {
    id,
    name: file.name.replace(/\.[^.]+$/, ''),
    kind,
    format: getExtension(file.name).toUpperCase(),
    sizeBytes: file.size,
    durationSec: meta.durationSec,
    resolution: meta.resolution,
    folderId,
    folderName,
    relativePath: rel,
    absolutePath: `${folderName}/${rel}`,
    sourceType: handleKey ? 'handle' : 'file',
    url,
    thumbnailUrl: meta.thumbnailUrl,
    missing: false,
    addedAt: Date.now(),
  };
}

/**
 * Recursively scans a FileSystemDirectoryHandle without copying files.
 */
export async function scanDirectoryHandle(
  dirHandle: FileSystemDirectoryHandle,
  folder: LibraryFolder,
  onProgress?: (scannedCount: number, currentFile: string) => void
): Promise<MediaItem[]> {
  const results: MediaItem[] = [];
  let count = 0;

  async function walk(currentDir: FileSystemDirectoryHandle, prefix: string) {
    for await (const [name, entry] of currentDir.entries()) {
      if (entry.kind === 'file') {
        const kind = detectMediaKind(name);
        if (!kind) continue;

        const fileHandle = entry as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        const rel = prefix ? `${prefix}/${name}` : name;
        const handleKey = `${folder.id}__${rel}`;
        await saveFileHandle(handleKey, fileHandle);

        const item = await buildMediaItemFromFile(file, folder.id, folder.name, rel, handleKey);
        if (item) {
          results.push(item);
          count++;
          onProgress?.(count, rel);
        }
      } else if (entry.kind === 'directory' && folder.recursive) {
        const nextPrefix = prefix ? `${prefix}/${name}` : name;
        await walk(entry as FileSystemDirectoryHandle, nextPrefix);
      }
    }
  }

  await walk(dirHandle, '');
  return results;
}

/**
 * Re-validates stored FileSystemHandle items on startup or Refresh Library.
 * Marks files as missing if drive/USB is disconnected without deleting playlist references.
 */
export async function resolveSavedHandleItems(
  items: MediaItem[]
): Promise<{ updated: MediaItem[]; missingCount: number }> {
  let missingCount = 0;
  const updated: MediaItem[] = [];

  for (const item of items) {
    if (item.sourceType === 'builtin') {
      updated.push(item);
      continue;
    }

    if (item.sourceType === 'handle') {
      const handleKey = item.id.replace(/^local_/, '');
      const handle = await getFileHandle<FileSystemFileHandle>(handleKey);
      if (!handle) {
        missingCount++;
        updated.push({ ...item, missing: true, url: undefined });
        continue;
      }

      try {
        // Check permission silently first
        const perm = await (handle as FileSystemFileHandle & {
          queryPermission?: (desc: { mode: string }) => Promise<string>;
        }).queryPermission?.({ mode: 'read' });
        if (perm === 'denied') {
          missingCount++;
          updated.push({ ...item, missing: true, url: undefined });
          continue;
        }
        const file = await handle.getFile();
        const url = URL.createObjectURL(file);
        updated.push({ ...item, url, missing: false });
      } catch {
        missingCount++;
        updated.push({ ...item, missing: true, url: undefined });
      }
    } else {
      // Transient session File objects cannot survive a full page reload unless re-located
      if (!item.url) {
        missingCount++;
        updated.push({ ...item, missing: true });
      } else {
        updated.push(item);
      }
    }
  }

  return { updated, missingCount };
}
