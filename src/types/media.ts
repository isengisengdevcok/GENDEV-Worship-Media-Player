export type MediaKind = 'video' | 'audio' | 'image';

export type PostFadeAction = 'pause' | 'stop';

export type LogoPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export type RepeatMode = 'off' | 'one' | 'all';

export interface SubtitleCue {
  startSec: number;
  endSec: number;
  text: string;
}

export interface MediaItem {
  id: string;
  name: string;
  kind: MediaKind;
  format: string;
  sizeBytes: number;
  durationSec: number;
  resolution?: string;
  folderId: string;
  folderName: string;
  relativePath: string;
  absolutePath: string;
  sourceType: 'builtin' | 'file' | 'handle';
  url?: string;
  thumbnailUrl?: string;
  subtitleCues?: SubtitleCue[];
  subtitleName?: string;
  missing?: boolean;
  addedAt: number;
  /** Optional synthetic audio descriptor for built-in worship pads */
  builtinPreset?: 'pad-c' | 'piano-g' | 'strings-f' | 'sanctuary-video' | 'sunrise-video';
}

export interface LibraryFolder {
  id: string;
  name: string;
  pathLabel: string;
  autoScan: boolean;
  recursive: boolean;
  lastScannedAt: number;
  itemCount: number;
  sourceType: 'builtin' | 'directory-handle' | 'virtual';
}

export interface Playlist {
  id: string;
  name: string;
  itemIds: string[];
  isBgm?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface FadeSettings {
  fadeOutDurationSec: 1 | 2 | 3 | 5 | 10 | 15;
  fadeInDurationSec: 1 | 2 | 3 | 5 | 10 | 15;
  fadeStartVolume: number; // 0..100
  fadeEndVolume: number;   // 0..100
  postFadeAction: PostFadeAction;
  autoFadeAtEndEnabled: boolean;
  autoFadeAtEndSec: 3 | 5 | 10 | 15;
  crossfadeEnabled: boolean;
  crossfadeDurationSec: number; // 1..10
}

export interface DisplaySettings {
  selectedScreenId: string;
  autoFullscreenProjector: boolean;
  preserveAspectRatio: boolean;
  blackScreenFadeMs: number;
  showSubtitlesOnProjector: boolean;
}

export interface BgmSettings {
  enabled: boolean;
  playlistId: string;
  volume: number; // 0..100
  autoFadeOutOnVideoStart: boolean;
  autoFadeInOnVideoEnd: boolean;
  allowSimultaneousWithVideo: boolean;
}

export interface LogoSettings {
  visible: boolean;
  imageUrl: string;
  position: LogoPosition;
  sizePx: number;
  opacity: number; // 0.1..1
}

export interface CountdownSettings {
  durationSec: number;
  showOnProjector: boolean;
  label: string;
}

export interface ShortcutMap {
  playPause: string;
  stop: string;
  next: string;
  previous: string;
  fadeOut: string;
  fadeIn: string;
  blackScreen: string;
  freezeFrame: string;
  mute: string;
  projectorToggle: string;
}

export interface AppSettings {
  accentTheme: 'indigo' | 'violet' | 'cobalt';
  mode: 'portable' | 'installation';
  autoScanOnStartup: boolean;
  restoreLastPlaylistOnStartup: boolean;
  audioOutputDeviceId: string;
  masterVolume: number; // 0..100
  fade: FadeSettings;
  display: DisplaySettings;
  bgm: BgmSettings;
  logo: LogoSettings;
  countdown: CountdownSettings;
  shortcuts: ShortcutMap;
}

export interface ProjectorSyncState {
  active: boolean;
  mediaId: string | null;
  mediaName: string;
  mediaKind: MediaKind | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  blackScreen: boolean;
  freezeFrame: boolean;
  freezeFrameDataUrl: string | null;
  subtitleText: string;
  showSubtitles: boolean;
  preserveAspectRatio: boolean;
  logo: LogoSettings;
  countdownRemainingSec: number;
  countdownRunning: boolean;
  countdownVisibleOnProjector: boolean;
  countdownLabel: string;
  updatedAt: number;
}
