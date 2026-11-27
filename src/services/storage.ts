import { AppSettings, LibraryFolder, MediaItem, Playlist } from '../types/media';
import { BUILTIN_CHURCH_LOGO } from '../utils/sampleMediaGenerator';

const DB_NAME = 'gendev_worship_media_db';
const DB_VERSION = 1;
const STORE_STATE = 'app_state';
const STORE_HANDLES = 'fs_handles';

export const DEFAULT_SETTINGS: AppSettings = {
  accentTheme: 'indigo',
  mode: 'portable',
  autoScanOnStartup: true,
  restoreLastPlaylistOnStartup: true,
  audioOutputDeviceId: 'default',
  masterVolume: 90,
  fade: {
    fadeOutDurationSec: 5,
    fadeInDurationSec: 3,
    fadeStartVolume: 0,
    fadeEndVolume: 0,
    postFadeAction: 'pause',
    autoFadeAtEndEnabled: true,
    autoFadeAtEndSec: 5,
    crossfadeEnabled: true,
    crossfadeDurationSec: 3,
  },
  display: {
    selectedScreenId: 'secondary',
    autoFullscreenProjector: true,
    preserveAspectRatio: true,
    blackScreenFadeMs: 450,
    showSubtitlesOnProjector: true,
  },
  bgm: {
    enabled: true,
    playlistId: 'pl-bgm',
    volume: 38,
    autoFadeOutOnVideoStart: true,
    autoFadeInOnVideoEnd: true,
    allowSimultaneousWithVideo: false,
  },
  logo: {
    visible: true,
    imageUrl: BUILTIN_CHURCH_LOGO,
    position: 'bottom-right',
    sizePx: 68,
    opacity: 0.72,
  },
  countdown: {
    durationSec: 300,
    showOnProjector: false,
    label: 'Ibadah Segera Dimulai',
  },
  shortcuts: {
    playPause: 'Space',
    stop: 'KeyS',
    next: 'ArrowRight',
    previous: 'ArrowLeft',
    fadeOut: 'KeyF',
    fadeIn: 'KeyI',
    blackScreen: 'KeyB',
    freezeFrame: 'KeyZ',
    mute: 'KeyM',
    projectorToggle: 'KeyP',
  },
};

export function createDefaultPlaylists(): Playlist[] {
  const now = Date.now();
  return [
    {
      id: 'pl-ibadah-minggu',
      name: 'Ibadah Minggu',
      itemIds: ['builtin-sanctuary-loop', 'builtin-pad-c', 'builtin-easter-sunrise'],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'pl-pujian',
      name: 'Pujian dan Penyembahan',
      itemIds: ['builtin-sanctuary-loop', 'builtin-piano-g'],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'pl-natal',
      name: 'Natal',
      itemIds: ['builtin-sanctuary-loop', 'builtin-strings-f'],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'pl-paskah',
      name: 'Paskah',
      itemIds: ['builtin-easter-sunrise', 'builtin-strings-f'],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'pl-pemuda',
      name: 'Pemuda',
      itemIds: ['builtin-sanctuary-loop'],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'pl-pengumuman',
      name: 'Pengumuman Gereja',
      itemIds: ['builtin-easter-sunrise'],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'pl-dokumentasi',
      name: 'Video Dokumentasi',
      itemIds: [],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'pl-bgm',
      name: 'Background Music Ibadah',
      itemIds: ['builtin-pad-c', 'builtin-piano-g', 'builtin-strings-f'],
      isBgm: true,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

export interface PersistedAppState {
  settings: AppSettings;
  playlists: Playlist[];
  folders: LibraryFolder[];
  customMediaMeta: MediaItem[];
  activePlaylistId: string;
  lastMediaId: string | null;
  lastQueueIds: string[];
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_STATE)) {
        db.createObjectStore(STORE_STATE);
      }
      if (!db.objectStoreNames.contains(STORE_HANDLES)) {
        db.createObjectStore(STORE_HANDLES);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadPersistedState(): Promise<PersistedAppState | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_STATE, 'readonly');
      const store = tx.objectStore(STORE_STATE);
      const req = store.get('main');
      req.onsuccess = () => resolve((req.result as PersistedAppState) || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function savePersistedState(state: PersistedAppState): Promise<void> {
  try {
    const db = await openDb();
    // Strip transient blob URLs from customMediaMeta before saving
    const sanitized: PersistedAppState = {
      ...state,
      customMediaMeta: state.customMediaMeta.map((item) => ({
        ...item,
        url: item.sourceType === 'builtin' ? item.url : undefined,
      })),
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_STATE, 'readwrite');
      tx.objectStore(STORE_STATE).put(sanitized, 'main');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Fallback quietly if IndexedDB blocked
  }
}

export async function saveFileHandle(key: string, handle: FileSystemHandle): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_HANDLES, 'readwrite');
      tx.objectStore(STORE_HANDLES).put(handle, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore if unavailable
  }
}

export async function getFileHandle<T extends FileSystemHandle>(key: string): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_HANDLES, 'readonly');
      const req = tx.objectStore(STORE_HANDLES).get(key);
      req.onsuccess = () => resolve((req.result as T) || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function deleteFileHandle(key: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_HANDLES, 'readwrite');
      tx.objectStore(STORE_HANDLES).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Ignore
  }
}
