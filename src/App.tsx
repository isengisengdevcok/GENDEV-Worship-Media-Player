import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Monitor, MonitorOff } from 'lucide-react';
import { ConsoleView } from './components/ConsoleView';
import { LibraryView } from './components/LibraryView';
import { PlaylistsView } from './components/PlaylistsView';
import { ProjectorStage } from './components/ProjectorStage';
import { ProjectorWindowApp } from './components/ProjectorWindowApp';
import { SettingsView } from './components/SettingsView';
import { audioEngine } from './services/audioEngine';
import {
  buildMediaItemFromFile,
  buildMediaItemFromTauriDiskFile,
  makeTauriMediaId,
  resolveSavedHandleItems,
  scanDirectoryHandle,
} from './services/fileScanner';
import {
  createDefaultPlaylists,
  DEFAULT_SETTINGS,
  getFileHandle,
  loadPersistedState,
  saveFileHandle,
  savePersistedState,
} from './services/storage';
import {
  isTauriRuntime,
  tauriCloseProjector,
  tauriEmit,
  tauriInspectDiskFiles,
  tauriListen,
  tauriOpenProjector,
  tauriPickMediaFiles,
  tauriPickMediaFolder,
  tauriPickSingleMediaFile,
  tauriReadTextFile,
  tauriSaveBackupFile,
  tauriScanFolder,
  toTauriAssetUrl,
} from './services/tauriBridge';
import {
  AppSettings,
  LibraryFolder,
  MediaItem,
  Playlist,
  ProjectorSyncState,
  RepeatMode,
} from './types/media';
import { detectMediaKind, formatDigitalClock, getExtension } from './utils/formatters';
import {
  BUILTIN_SANCTUARY_IMG,
  BUILTIN_SUNRISE_IMG,
  createBuiltinLibraryItems,
  generateWorshipWebmUrl,
} from './utils/sampleMediaGenerator';
import { findActiveSubtitle, parseSubtitles } from './utils/srtParser';

type WorkspaceTab = 'console' | 'library' | 'playlists' | 'settings';

export default function App() {
  const isProjectorRoute = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('mode') === 'projector';
  }, []);

  if (isProjectorRoute) {
    return <ProjectorWindowApp />;
  }

  return <OperatorConsoleApp />;
}

function OperatorConsoleApp() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('console');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [folders, setFolders] = useState<LibraryFolder[]>([
    {
      id: 'folder-builtin',
      name: 'GENDEV Built-In Sanctuary Pack',
      pathLabel: 'GENDEV://MediaLibrary',
      autoScan: true,
      recursive: true,
      lastScannedAt: Date.now(),
      itemCount: 5,
      sourceType: 'builtin',
    },
  ]);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>(() => createBuiltinLibraryItems());
  const [playlists, setPlaylists] = useState<Playlist[]>(() => createDefaultPlaylists());
  const [activePlaylistId, setActivePlaylistId] = useState<string>('pl-ibadah-minggu');
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [manualQueueIds, setManualQueueIds] = useState<string[]>([]);
  const [currentMediaId, setCurrentMediaId] = useState<string | null>('builtin-sanctuary-loop');

  const [isScanning, setIsScanning] = useState(false);
  const isScanningRef = useRef(false);
  const [scanStatus, setScanStatus] = useState('');
  const [playbackError, setPlaybackError] = useState('');
  const [hydrated, setHydrated] = useState(false);

  // Playback State (Dual-deck A/B for true audio crossfade)
  const [activeDeck, setActiveDeck] = useState<'A' | 'B'>('A');
  const deckARef = useRef<HTMLVideoElement | null>(null);
  const deckBRef = useRef<HTMLVideoElement | null>(null);
  const bgmAudioRef = useRef<HTMLAudioElement | null>(null);
  const singleFsRef = useRef<HTMLDivElement | null>(null);
  const projectorLinkRef = useRef<HTMLAnchorElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(10);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [liveAudioLevel, setLiveAudioLevel] = useState(0);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('all');
  const [shuffleEnabled, setShuffleEnabled] = useState(false);

  const [fadeProgress, setFadeProgress] = useState<{
    active: boolean;
    direction: 'in' | 'out';
    progress: number;
    currentVolPct: number;
  }>({ active: false, direction: 'out', progress: 0, currentVolPct: 100 });

  const autoFadeTriggeredRef = useRef(false);
  const deckGainRef = useRef<number>(1);

  // Stage State
  const [blackScreen, setBlackScreen] = useState(false);
  const [freezeFrame, setFreezeFrame] = useState(false);
  const [freezeFrameDataUrl, setFreezeFrameDataUrl] = useState<string | null>(null);
  const [projectorWindowOpen, setProjectorWindowOpen] = useState(false);
  const [singleScreenFsActive, setSingleScreenFsActive] = useState(false);

  // Clock & Countdown
  const [digitalClock, setDigitalClock] = useState(() => formatDigitalClock(new Date()));
  const [countdownRemainingSec, setCountdownRemainingSec] = useState(
    DEFAULT_SETTINGS.countdown.durationSec
  );
  const [countdownRunning, setCountdownRunning] = useState(false);

  // Background Music State
  const [bgmPlaying, setBgmPlaying] = useState(false);
  const [bgmIndex, setBgmIndex] = useState(0);
  const bgmPausedByVideoRef = useRef(false);

  const broadcastRef = useRef<BroadcastChannel | null>(null);

  const getDeckEl = useCallback(
    (which: 'A' | 'B' = activeDeck) => (which === 'A' ? deckARef.current : deckBRef.current),
    [activeDeck]
  );

  const mediaMap = useMemo(() => {
    const map = new Map<string, MediaItem>();
    for (const item of mediaItems) {
      map.set(item.id, item);
    }
    return map;
  }, [mediaItems]);

  const activePlaylist = useMemo(
    () => playlists.find((p) => p.id === activePlaylistId) || playlists[0],
    [playlists, activePlaylistId]
  );

  const currentMedia = useMemo(
    () => (currentMediaId ? mediaMap.get(currentMediaId) || null : null),
    [currentMediaId, mediaMap]
  );

  const nextMedia = useMemo(() => {
    if (manualQueueIds.length > 0) {
      return mediaMap.get(manualQueueIds[0]) || null;
    }
    if (!activePlaylist || activePlaylist.itemIds.length === 0) return null;
    const nextIdx = (activeIndex + 1) % activePlaylist.itemIds.length;
    if (nextIdx === 0 && repeatMode === 'off' && activeIndex >= activePlaylist.itemIds.length - 1) {
      return null;
    }
    return mediaMap.get(activePlaylist.itemIds[nextIdx]) || null;
  }, [activeIndex, activePlaylist, manualQueueIds, mediaMap, repeatMode]);

  const bgmPlaylist = useMemo(
    () => playlists.find((p) => p.id === settings.bgm.playlistId) || playlists.find((p) => p.isBgm),
    [playlists, settings.bgm.playlistId]
  );

  const currentBgmItem = useMemo(() => {
    if (!bgmPlaylist || bgmPlaylist.itemIds.length === 0) return null;
    const safeIdx = bgmIndex % bgmPlaylist.itemIds.length;
    return mediaMap.get(bgmPlaylist.itemIds[safeIdx]) || null;
  }, [bgmIndex, bgmPlaylist, mediaMap]);

  // Hydrate persisted state from IndexedDB on startup
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadPersistedState();
      if (cancelled) return;

      const builtins = createBuiltinLibraryItems();
      if (saved) {
        const mergedSettings: AppSettings = {
          ...DEFAULT_SETTINGS,
          ...saved.settings,
          fade: { ...DEFAULT_SETTINGS.fade, ...saved.settings?.fade },
          display: { ...DEFAULT_SETTINGS.display, ...saved.settings?.display },
          bgm: { ...DEFAULT_SETTINGS.bgm, ...saved.settings?.bgm },
          logo: { ...DEFAULT_SETTINGS.logo, ...saved.settings?.logo },
          countdown: { ...DEFAULT_SETTINGS.countdown, ...saved.settings?.countdown },
          shortcuts: { ...DEFAULT_SETTINGS.shortcuts, ...saved.settings?.shortcuts },
        };
        setSettings(mergedSettings);
        setCountdownRemainingSec(mergedSettings.countdown.durationSec);

        if (saved.playlists?.length) setPlaylists(saved.playlists);
        if (saved.folders?.length) setFolders(saved.folders);

        if (mergedSettings.restoreLastPlaylistOnStartup) {
          if (saved.activePlaylistId) setActivePlaylistId(saved.activePlaylistId);
          if (saved.lastMediaId) setCurrentMediaId(saved.lastMediaId);
          if (saved.lastQueueIds) setManualQueueIds(saved.lastQueueIds);
        }

        const customResolved = await resolveSavedHandleItems(saved.customMediaMeta || []);
        if (!cancelled) {
          setMediaItems([...builtins, ...customResolved.updated]);
          if (customResolved.missingCount > 0) {
            setScanStatus(
              `${customResolved.missingCount} offline/external file(s) marked Missing File.`
            );
          }
        }
      }
      setHydrated(true);

      // Upgrade built-in video items to real encoded WebM loops asynchronously
      const [sanctuaryWebm, sunriseWebm] = await Promise.all([
        generateWorshipWebmUrl(BUILTIN_SANCTUARY_IMG, 'Sanctuary Light Beams', 3.5),
        generateWorshipWebmUrl(BUILTIN_SUNRISE_IMG, 'Dawn Over Still Water', 3.5),
      ]);
      if (!cancelled) {
        setMediaItems((prev) =>
          prev.map((item) => {
            if (item.id === 'builtin-sanctuary-loop' && sanctuaryWebm) {
              return { ...item, url: sanctuaryWebm, durationSec: 3.5 };
            }
            if (item.id === 'builtin-easter-sunrise' && sunriseWebm) {
              return { ...item, url: sunriseWebm, durationSec: 3.5 };
            }
            return item;
          })
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Persist changes cleanly
  useEffect(() => {
    if (!hydrated) return;
    const customMediaMeta = mediaItems.filter((i) => i.sourceType !== 'builtin');
    void savePersistedState({
      settings,
      playlists,
      folders,
      customMediaMeta,
      activePlaylistId,
      lastMediaId: currentMediaId,
      lastQueueIds: manualQueueIds,
    });
  }, [
    activePlaylistId,
    currentMediaId,
    folders,
    hydrated,
    manualQueueIds,
    mediaItems,
    playlists,
    settings,
  ]);

  // Digital clock & Countdown timer ticks
  useEffect(() => {
    const id = window.setInterval(() => {
      setDigitalClock(formatDigitalClock(new Date()));
      setCountdownRemainingSec((prev) => {
        if (!countdownRunning) return prev;
        if (prev <= 1) {
          setCountdownRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [countdownRunning]);

  // Live audio RMS meter loop
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = getDeckEl();
      if (isPlaying && el) {
        setLiveAudioLevel(audioEngine.getLiveLevel(el));
      } else {
        setLiveAudioLevel(0);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getDeckEl, isPlaying]);

  // Update Web Audio Master Gain when volume/mute changes
  useEffect(() => {
    audioEngine.setMasterGain(settings.masterVolume / 100, isMuted);
  }, [isMuted, settings.masterVolume]);

  // Update Audio Output Device via setSinkId
  useEffect(() => {
    void audioEngine.setAudioOutputDevice(
      [deckARef.current, deckBRef.current, bgmAudioRef.current],
      settings.audioOutputDeviceId
    );
  }, [settings.audioOutputDeviceId]);

  // Subtitle lookup for current playback time
  const activeSubtitleText = useMemo(
    () => findActiveSubtitle(currentMedia?.subtitleCues, currentTime),
    [currentMedia?.subtitleCues, currentTime]
  );

  // Build Projector Sync State
  const projectorState: ProjectorSyncState = useMemo(
    () => ({
      active: projectorWindowOpen || singleScreenFsActive,
      mediaId: currentMedia?.id || null,
      mediaName: currentMedia?.name || '',
      mediaKind: currentMedia?.kind || null,
      mediaUrl: currentMedia?.url || null,
      thumbnailUrl: currentMedia?.thumbnailUrl || null,
      isPlaying,
      currentTime,
      duration,
      playbackRate,
      blackScreen,
      freezeFrame,
      freezeFrameDataUrl,
      subtitleText: activeSubtitleText,
      showSubtitles: settings.display.showSubtitlesOnProjector,
      preserveAspectRatio: settings.display.preserveAspectRatio,
      logo: settings.logo,
      countdownRemainingSec,
      countdownRunning,
      countdownVisibleOnProjector: settings.countdown.showOnProjector,
      countdownLabel: settings.countdown.label,
      updatedAt: Date.now(),
    }),
    [
      activeSubtitleText,
      blackScreen,
      countdownRemainingSec,
      countdownRunning,
      currentMedia,
      currentTime,
      duration,
      freezeFrame,
      freezeFrameDataUrl,
      isPlaying,
      playbackRate,
      projectorWindowOpen,
      settings.countdown.label,
      settings.countdown.showOnProjector,
      settings.display.preserveAspectRatio,
      settings.display.showSubtitlesOnProjector,
      settings.logo,
      singleScreenFsActive,
    ]
  );

  const projectorStateRef = useRef<ProjectorSyncState>(projectorState);
  useEffect(() => {
    projectorStateRef.current = projectorState;
  }, [projectorState]);

  // Setup BroadcastChannel & Tauri Events for Dual Display Monitor 2
  useEffect(() => {
    const ch = new BroadcastChannel('gendev_projector_v1');
    broadcastRef.current = ch;

    ch.onmessage = (ev: MessageEvent) => {
      if (ev.data?.type === 'PROJECTOR_READY') {
        setProjectorWindowOpen(true);
        ch.postMessage({ type: 'SYNC_STATE', payload: projectorStateRef.current });
      } else if (ev.data?.type === 'PROJECTOR_CLOSED') {
        setProjectorWindowOpen(false);
      }
    };

    let unlistenReady: (() => void) | null = null;
    let unlistenClosed: (() => void) | null = null;
    if (isTauriRuntime()) {
      void tauriListen('gendev-projector-ready', () => {
        setProjectorWindowOpen(true);
        void tauriEmit('gendev-projector-sync', projectorStateRef.current);
      }).then((fn) => {
        unlistenReady = fn;
      });
      void tauriListen('gendev-projector-closed', () => {
        setProjectorWindowOpen(false);
      }).then((fn) => {
        unlistenClosed = fn;
      });
    }

    return () => {
      unlistenReady?.();
      unlistenClosed?.();
      ch.close();
      broadcastRef.current = null;
    };
  }, []);

  // Broadcast state updates to Monitor 2
  useEffect(() => {
    try {
      localStorage.setItem('gendev_projector_snapshot', JSON.stringify(projectorState));
    } catch {
      // ignore quota
    }
    broadcastRef.current?.postMessage({ type: 'SYNC_STATE', payload: projectorState });
    if (isTauriRuntime() && projectorWindowOpen) {
      void tauriEmit('gendev-projector-sync', projectorState);
    }
  }, [projectorState, projectorWindowOpen]);

  // Listen for single-screen fullscreen exit
  useEffect(() => {
    const onFs = () => {
      setSingleScreenFsActive(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // Background Music Auto-Fade Helpers
  const duckBgmForVideo = useCallback(() => {
    if (
      settings.bgm.allowSimultaneousWithVideo ||
      !settings.bgm.autoFadeOutOnVideoStart ||
      !bgmPlaying
    ) {
      return;
    }
    const bgmEl = bgmAudioRef.current;
    if (!bgmEl) return;

    bgmPausedByVideoRef.current = true;
    audioEngine.rampElementGain(bgmEl, settings.bgm.volume / 100, 0, 1.5, {
      isBgm: true,
      onComplete: () => {
        bgmEl.pause();
        setBgmPlaying(false);
      },
    });
  }, [
    bgmPlaying,
    settings.bgm.allowSimultaneousWithVideo,
    settings.bgm.autoFadeOutOnVideoStart,
    settings.bgm.volume,
  ]);

  const restoreBgmAfterVideo = useCallback(() => {
    if (!settings.bgm.enabled || !settings.bgm.autoFadeInOnVideoEnd || !bgmPausedByVideoRef.current) {
      return;
    }
    const bgmEl = bgmAudioRef.current;
    if (!bgmEl || !currentBgmItem?.url) return;

    bgmPausedByVideoRef.current = false;
    if (bgmEl.getAttribute('data-src') !== currentBgmItem.url) {
      bgmEl.setAttribute('data-src', currentBgmItem.url);
      bgmEl.src = currentBgmItem.url;
    }
    audioEngine.attachElement(bgmEl, 0);
    void bgmEl
      .play()
      .then(() => {
        setBgmPlaying(true);
        audioEngine.rampElementGain(bgmEl, 0, settings.bgm.volume / 100, 2.0, { isBgm: true });
      })
      .catch(() => {});
  }, [
    currentBgmItem,
    settings.bgm.autoFadeInOnVideoEnd,
    settings.bgm.enabled,
    settings.bgm.volume,
  ]);

  // Core Play Media Handler (supports true A/B Crossfade and safe replay after fade-out)
  const playMediaItem = useCallback(
    (item: MediaItem, playlistIndex?: number) => {
      if (item.missing || !item.url) return;

      setPlaybackError('');
      audioEngine.ensureContext();
      autoFadeTriggeredRef.current = false;
      setFadeProgress({ active: false, direction: 'out', progress: 0, currentVolPct: 100 });
      setFreezeFrame(false);
      setFreezeFrameDataUrl(null);

      if (typeof playlistIndex === 'number') {
        setActiveIndex(playlistIndex);
      }

      if (item.kind === 'video') {
        duckBgmForVideo();
      }

      const oldDeck = activeDeck;
      const oldEl = getDeckEl(oldDeck);
      const shouldCrossfade =
        settings.fade.crossfadeEnabled &&
        isPlaying &&
        oldEl &&
        !oldEl.paused &&
        currentMedia?.id !== item.id;

      const targetDeck: 'A' | 'B' = shouldCrossfade ? (oldDeck === 'A' ? 'B' : 'A') : oldDeck;
      const targetEl = getDeckEl(targetDeck);
      if (!targetEl) return;

      // Cancel any stale fade automation on target deck before starting playback
      audioEngine.cancelMainFade(targetEl);

      if (shouldCrossfade && oldEl) {
        audioEngine.rampElementGain(
          oldEl,
          deckGainRef.current,
          0,
          settings.fade.crossfadeDurationSec,
          {
            onComplete: () => {
              oldEl.pause();
              oldEl.currentTime = 0;
              audioEngine.setElementGainImmediate(oldEl, 1);
            },
          }
        );
      } else if (oldEl && oldEl !== targetEl) {
        audioEngine.cancelMainFade(oldEl);
        oldEl.pause();
        audioEngine.setElementGainImmediate(oldEl, 1);
      }

      setActiveDeck(targetDeck);
      setCurrentMediaId(item.id);
      setCurrentTime(0);
      setDuration(item.durationSec || 10);

      // Load media URL into target deck
      const isPlayableStream =
        !item.url.endsWith('.jpg') && !item.url.endsWith('.png');

      if (!isPlayableStream) {
        if (oldEl && !shouldCrossfade) oldEl.pause();
        setIsPlaying(true);
        return;
      }

      if (targetEl.getAttribute('data-src') !== item.url) {
        targetEl.setAttribute('data-src', item.url);
        targetEl.src = item.url;
      }
      targetEl.currentTime = 0;
      targetEl.playbackRate = playbackRate;
      targetEl.loop = item.sourceType === 'builtin' && item.kind === 'video';

      audioEngine.attachElement(targetEl, shouldCrossfade ? 0 : 1);
      if (!shouldCrossfade) {
        deckGainRef.current = 1;
        audioEngine.setElementGainImmediate(targetEl, 1);
      }

      void targetEl
        .play()
        .then(() => {
          setIsPlaying(true);
          if (shouldCrossfade) {
            deckGainRef.current = 1;
            audioEngine.rampElementGain(targetEl, 0, 1, settings.fade.crossfadeDurationSec);
          } else {
            deckGainRef.current = 1;
            audioEngine.setElementGainImmediate(targetEl, 1);
          }
        })
        .catch(() => {
          setIsPlaying(false);
        });
    },
    [
      activeDeck,
      currentMedia?.id,
      duckBgmForVideo,
      getDeckEl,
      isPlaying,
      playbackRate,
      settings.fade.crossfadeDurationSec,
      settings.fade.crossfadeEnabled,
    ]
  );

  // Stop Playback
  const handleStop = useCallback(() => {
    setFadeProgress({ active: false, direction: 'out', progress: 0, currentVolPct: 100 });
    [deckARef.current, deckBRef.current].forEach((el) => {
      if (el) {
        audioEngine.cancelMainFade(el);
        el.pause();
        el.currentTime = 0;
        audioEngine.setElementGainImmediate(el, 1);
      }
    });
    deckGainRef.current = 1;
    autoFadeTriggeredRef.current = false;
    setIsPlaying(false);
    setCurrentTime(0);
    setFreezeFrame(false);
    setFreezeFrameDataUrl(null);
    restoreBgmAfterVideo();
  }, [restoreBgmAfterVideo]);

  // Toggle Play / Pause (safely restores audio if video previously ended or faded out)
  const handleTogglePlayPause = useCallback(() => {
    audioEngine.ensureContext();
    if (!currentMedia) {
      const firstId = activePlaylist?.itemIds[0];
      const first = firstId ? mediaMap.get(firstId) : mediaItems[0];
      if (first) playMediaItem(first, 0);
      return;
    }

    const el = getDeckEl();
    if (!el) return;

    const isPlayableStream =
      Boolean(currentMedia.url) &&
      !currentMedia.url?.endsWith('.jpg') &&
      !currentMedia.url?.endsWith('.png');

    if (!isPlayableStream) {
      setIsPlaying((p) => !p);
      return;
    }

    if (isPlaying) {
      el.pause();
      setIsPlaying(false);
    } else {
      if (currentMedia.kind === 'video') duckBgmForVideo();
      if (el.getAttribute('data-src') !== currentMedia.url && currentMedia.url) {
        el.setAttribute('data-src', currentMedia.url);
        el.src = currentMedia.url;
      }

      const elDuration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : duration;
      const reachedEnd = el.ended || (elDuration > 0 && el.currentTime >= elDuration - 0.35);
      if (reachedEnd) {
        el.currentTime = 0;
        setCurrentTime(0);
        autoFadeTriggeredRef.current = false;
      }

      // Restore full audio gain if previously faded to 0 via Fade Out or Auto-Fade at End
      if (deckGainRef.current <= 0.05 || reachedEnd) {
        audioEngine.cancelMainFade(el);
        deckGainRef.current = 1;
        audioEngine.attachElement(el, 1);
        audioEngine.setElementGainImmediate(el, 1);
        autoFadeTriggeredRef.current = false;
        setFadeProgress({ active: false, direction: 'out', progress: 0, currentVolPct: 100 });
      } else {
        audioEngine.attachElement(el, deckGainRef.current);
      }

      void el
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => {});
    }
  }, [
    activePlaylist?.itemIds,
    currentMedia,
    duckBgmForVideo,
    duration,
    getDeckEl,
    isPlaying,
    mediaItems,
    mediaMap,
    playMediaItem,
  ]);

  // Next / Previous in Playlist + Queue
  const handleNext = useCallback(() => {
    if (manualQueueIds.length > 0) {
      const [nextId, ...rest] = manualQueueIds;
      setManualQueueIds(rest);
      const item = mediaMap.get(nextId);
      if (item && !item.missing) {
        playMediaItem(item);
        return;
      }
    }

    const list = activePlaylist?.itemIds || [];
    if (list.length === 0) return;

    let nextIdx = activeIndex + 1;
    if (shuffleEnabled && list.length > 1) {
      do {
        nextIdx = Math.floor(Math.random() * list.length);
      } while (nextIdx === activeIndex);
    } else if (nextIdx >= list.length) {
      if (repeatMode === 'all') nextIdx = 0;
      else {
        handleStop();
        return;
      }
    }

    const nextItem = mediaMap.get(list[nextIdx]);
    if (nextItem && !nextItem.missing) {
      playMediaItem(nextItem, nextIdx);
    }
  }, [
    activeIndex,
    activePlaylist?.itemIds,
    handleStop,
    manualQueueIds,
    mediaMap,
    playMediaItem,
    repeatMode,
    shuffleEnabled,
  ]);

  const handlePrevious = useCallback(() => {
    const el = getDeckEl();
    if (el && el.currentTime > 3) {
      el.currentTime = 0;
      setCurrentTime(0);
      return;
    }

    const list = activePlaylist?.itemIds || [];
    if (list.length === 0) return;

    if (activeIndex === 0 && repeatMode === 'off') {
      if (el) el.currentTime = 0;
      setCurrentTime(0);
      return;
    }

    const prevIdx = activeIndex - 1 < 0 ? list.length - 1 : activeIndex - 1;
    const prevItem = mediaMap.get(list[prevIdx]);
    if (prevItem && !prevItem.missing) {
      playMediaItem(prevItem, prevIdx);
    }
  }, [activeIndex, activePlaylist?.itemIds, getDeckEl, mediaMap, playMediaItem, repeatMode]);

  // SMART FADE OUT (Main Signature Feature)
  const handleSmartFadeOut = useCallback(() => {
    const el = getDeckEl();
    if (!el || !currentMedia) return;

    audioEngine.ensureContext();
    const fadeSec = settings.fade.fadeOutDurationSec;
    const endVol01 = settings.fade.fadeEndVolume / 100;
    const startVol01 = deckGainRef.current;

    setFadeProgress({
      active: true,
      direction: 'out',
      progress: 0,
      currentVolPct: startVol01 * 100,
    });

    audioEngine.rampElementGain(el, startVol01, endVol01, fadeSec, {
      onTick: (currentGain, progress) => {
        deckGainRef.current = currentGain;
        setFadeProgress({
          active: true,
          direction: 'out',
          progress,
          currentVolPct: currentGain * 100,
        });
      },
      onComplete: () => {
        setFadeProgress({
          active: false,
          direction: 'out',
          progress: 1,
          currentVolPct: endVol01 * 100,
        });
        if (endVol01 <= 0.02) {
          if (settings.fade.postFadeAction === 'stop') {
            handleStop();
          } else {
            el.pause();
            setIsPlaying(false);
            restoreBgmAfterVideo();
          }
        }
      },
    });
  }, [
    currentMedia,
    getDeckEl,
    handleStop,
    restoreBgmAfterVideo,
    settings.fade.fadeEndVolume,
    settings.fade.fadeOutDurationSec,
    settings.fade.postFadeAction,
  ]);

  // SMART FADE IN
  const handleSmartFadeIn = useCallback(() => {
    const el = getDeckEl();
    if (!el || !currentMedia) return;

    audioEngine.ensureContext();
    const fadeSec = settings.fade.fadeInDurationSec;
    const startVol01 = settings.fade.fadeStartVolume / 100;

    if (currentMedia.kind === 'video') duckBgmForVideo();

    audioEngine.attachElement(el, startVol01);
    if (el.paused && currentMedia.url && !currentMedia.url.endsWith('.jpg')) {
      if (el.getAttribute('data-src') !== currentMedia.url) {
        el.setAttribute('data-src', currentMedia.url);
        el.src = currentMedia.url;
      }
      void el.play().then(() => setIsPlaying(true)).catch(() => {});
    }

    autoFadeTriggeredRef.current = false;
    setFadeProgress({
      active: true,
      direction: 'in',
      progress: 0,
      currentVolPct: startVol01 * 100,
    });

    audioEngine.rampElementGain(el, startVol01, 1.0, fadeSec, {
      onTick: (currentGain, progress) => {
        deckGainRef.current = currentGain;
        setFadeProgress({
          active: true,
          direction: 'in',
          progress,
          currentVolPct: currentGain * 100,
        });
      },
      onComplete: () => {
        deckGainRef.current = 1;
        setFadeProgress({ active: false, direction: 'in', progress: 1, currentVolPct: 100 });
      },
    });
  }, [
    currentMedia,
    duckBgmForVideo,
    getDeckEl,
    settings.fade.fadeInDurationSec,
    settings.fade.fadeStartVolume,
  ]);

  // Toggle Freeze Frame (Captures exact video frame while audio continues!)
  const handleToggleFreezeFrame = useCallback(() => {
    setFreezeFrame((prev) => {
      const next = !prev;
      if (next) {
        const el = getDeckEl();
        if (el && el.videoWidth > 0) {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = el.videoWidth;
            canvas.height = el.videoHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
              setFreezeFrameDataUrl(canvas.toDataURL('image/jpeg', 0.92));
            }
          } catch {
            setFreezeFrameDataUrl(null);
          }
        }
      } else {
        setFreezeFrameDataUrl(null);
      }
      return next;
    });
  }, [getDeckEl]);

  // Open Monitor 2 Projector Window (native Tauri multi-monitor window or browser tab)
  const handleOpenProjectorWindow = useCallback(async () => {
    try {
      localStorage.setItem('gendev_projector_snapshot', JSON.stringify(projectorStateRef.current));
    } catch {
      // ignore
    }
    if (isTauriRuntime()) {
      try {
        const res = await tauriOpenProjector(settings.display.selectedScreenId);
        setProjectorWindowOpen(res.opened);
        await tauriEmit('gendev-projector-sync', projectorStateRef.current);
        if (res.mode === 'single-windowed') {
          setScanStatus(
            'Hanya 1 layar terdeteksi: Projector dibuka sebagai jendela aman (klik 2x fullscreen, tekan ESC untuk keluar).'
          );
          window.setTimeout(() => setScanStatus(''), 5000);
        }
      } catch (err) {
        setPlaybackError(`Failed to open Projector window: ${String(err)}`);
      }
      return;
    }
    setProjectorWindowOpen(true);
    projectorLinkRef.current?.click();
  }, [settings.display.selectedScreenId]);

  const handleExitProjector = useCallback(async () => {
    broadcastRef.current?.postMessage({ type: 'EXIT_PROJECTOR' });
    setProjectorWindowOpen(false);
    if (isTauriRuntime()) {
      await tauriCloseProjector().catch(() => {});
      return;
    }
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
  }, []);

  const handleEnterSingleScreenFullscreen = useCallback(async () => {
    if (!singleFsRef.current) return;
    try {
      await singleFsRef.current.requestFullscreen();
      setSingleScreenFsActive(true);
    } catch {
      // ignore if browser blocks
    }
  }, []);

  // Deck TimeUpdate & Auto Fade Out at End
  const handleDeckTimeUpdate = useCallback(
    (which: 'A' | 'B') => {
      if (which !== activeDeck) return;
      const el = getDeckEl(which);
      if (!el) return;

      const t = el.currentTime || 0;
      const dur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : duration;
      setCurrentTime(t);
      if (dur > 0) setDuration(dur);

      // Auto Fade Out at End
      if (
        settings.fade.autoFadeAtEndEnabled &&
        !el.loop &&
        !autoFadeTriggeredRef.current &&
        dur > settings.fade.autoFadeAtEndSec + 1 &&
        dur - t <= settings.fade.autoFadeAtEndSec
      ) {
        autoFadeTriggeredRef.current = true;
        const remain = Math.max(0.1, dur - t);
        audioEngine.rampElementGain(el, deckGainRef.current, 0, remain, {
          onTick: (g, p) => {
            deckGainRef.current = g;
            setFadeProgress({
              active: true,
              direction: 'out',
              progress: p,
              currentVolPct: g * 100,
            });
          },
          onComplete: () => {
            setFadeProgress({ active: false, direction: 'out', progress: 0, currentVolPct: 100 });
          },
        });
      }
    },
    [activeDeck, duration, getDeckEl, settings.fade.autoFadeAtEndEnabled, settings.fade.autoFadeAtEndSec]
  );

  const handleDeckEnded = useCallback(
    (which: 'A' | 'B') => {
      if (which !== activeDeck) return;
      const el = getDeckEl(which);
      // Cancel any lingering auto-fade automation BEFORE restoring gain to 1
      audioEngine.cancelMainFade(el);
      autoFadeTriggeredRef.current = false;
      deckGainRef.current = 1;
      audioEngine.setElementGainImmediate(el, 1);
      setFadeProgress({ active: false, direction: 'out', progress: 0, currentVolPct: 100 });

      if (repeatMode === 'one' && currentMedia) {
        playMediaItem(currentMedia, activeIndex);
        return;
      }

      const list = activePlaylist?.itemIds || [];
      if (manualQueueIds.length > 0 || activeIndex + 1 < list.length || repeatMode === 'all') {
        handleNext();
      } else {
        if (el) {
          el.currentTime = 0;
        }
        setCurrentTime(0);
        setIsPlaying(false);
        restoreBgmAfterVideo();
      }
    },
    [
      activeDeck,
      activeIndex,
      activePlaylist?.itemIds,
      currentMedia,
      getDeckEl,
      handleNext,
      manualQueueIds.length,
      playMediaItem,
      repeatMode,
      restoreBgmAfterVideo,
    ]
  );

  // Image / still-slide playback progression timer
  useEffect(() => {
    if (!isPlaying || !currentMedia) return;
    const isImageSlide =
      !currentMedia.url ||
      currentMedia.url.endsWith('.jpg') ||
      currentMedia.url.endsWith('.png');
    if (!isImageSlide) return;

    const interval = window.setInterval(() => {
      setCurrentTime((prev) => {
        const next = prev + 0.25;
        if (next >= duration) {
          window.clearInterval(interval);
          handleDeckEnded(activeDeck);
          return duration;
        }
        return next;
      });
    }, 250);
    return () => window.clearInterval(interval);
  }, [activeDeck, currentMedia, duration, handleDeckEnded, isPlaying]);

  // Background Music Controls
  const handleToggleBgm = useCallback(() => {
    const bgmEl = bgmAudioRef.current;
    if (!bgmEl || !currentBgmItem?.url) return;
    audioEngine.ensureContext();

    if (bgmPlaying) {
      bgmPausedByVideoRef.current = false;
      audioEngine.rampElementGain(bgmEl, settings.bgm.volume / 100, 0, 1.0, {
        isBgm: true,
        onComplete: () => {
          bgmEl.pause();
          setBgmPlaying(false);
        },
      });
    } else {
      bgmPausedByVideoRef.current = false;
      if (bgmEl.getAttribute('data-src') !== currentBgmItem.url) {
        bgmEl.setAttribute('data-src', currentBgmItem.url);
        bgmEl.src = currentBgmItem.url;
      }
      audioEngine.attachElement(bgmEl, 0);
      void bgmEl
        .play()
        .then(() => {
          setBgmPlaying(true);
          audioEngine.rampElementGain(bgmEl, 0, settings.bgm.volume / 100, 1.4, { isBgm: true });
        })
        .catch(() => {});
    }
  }, [bgmPlaying, currentBgmItem, settings.bgm.volume]);

  const handleNextBgm = useCallback(() => {
    if (!bgmPlaylist || bgmPlaylist.itemIds.length === 0) return;
    const nextIdx = (bgmIndex + 1) % bgmPlaylist.itemIds.length;
    setBgmIndex(nextIdx);
    const nextItem = mediaMap.get(bgmPlaylist.itemIds[nextIdx]);
    const bgmEl = bgmAudioRef.current;
    if (bgmEl && nextItem?.url && bgmPlaying) {
      bgmEl.setAttribute('data-src', nextItem.url);
      bgmEl.src = nextItem.url;
      void bgmEl.play().catch(() => {});
    }
  }, [bgmIndex, bgmPlaying, bgmPlaylist, mediaMap]);

  // Keyboard Shortcuts Listener
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const code = e.code;
      const sc = settings.shortcuts;
      if (code === sc.playPause) {
        e.preventDefault();
        handleTogglePlayPause();
      } else if (code === sc.stop) {
        e.preventDefault();
        handleStop();
      } else if (code === sc.next) {
        e.preventDefault();
        handleNext();
      } else if (code === sc.previous) {
        e.preventDefault();
        handlePrevious();
      } else if (code === sc.fadeOut) {
        e.preventDefault();
        handleSmartFadeOut();
      } else if (code === sc.fadeIn) {
        e.preventDefault();
        handleSmartFadeIn();
      } else if (code === sc.blackScreen) {
        e.preventDefault();
        setBlackScreen((b) => !b);
      } else if (code === sc.freezeFrame) {
        e.preventDefault();
        handleToggleFreezeFrame();
      } else if (code === sc.mute) {
        e.preventDefault();
        setIsMuted((m) => !m);
      } else if (code === sc.projectorToggle) {
        e.preventDefault();
        if (projectorWindowOpen) handleExitProjector();
        else handleOpenProjectorWindow();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    handleExitProjector,
    handleNext,
    handleOpenProjectorWindow,
    handlePrevious,
    handleSmartFadeIn,
    handleSmartFadeOut,
    handleStop,
    handleToggleFreezeFrame,
    handleTogglePlayPause,
    projectorWindowOpen,
    settings.shortcuts,
  ]);

  // Folder & File Import Handlers
  const handleAddFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (files.length === 0) return;

      setIsScanning(true);
      setScanStatus(`Importing ${files.length} file(s)...`);

      const folderId = 'folder-local-imports';
      const folderName = 'Local Imported Media';

      const newItems: MediaItem[] = [];
      let attachedSrtCount = 0;

      for (const file of files) {
        const ext = getExtension(file.name);
        if (ext === 'srt' || ext === 'vtt') {
          const text = await file.text();
          const cues = parseSubtitles(text);
          if (currentMediaId && cues.length > 0) {
            setMediaItems((prev) =>
              prev.map((it) =>
                it.id === currentMediaId
                  ? { ...it, subtitleCues: cues, subtitleName: file.name }
                  : it
              )
            );
            attachedSrtCount++;
          }
          continue;
        }

        if (!detectMediaKind(file.name)) continue;
        const item = await buildMediaItemFromFile(file, folderId, folderName);
        if (item) newItems.push(item);
      }

      if (newItems.length > 0) {
        let updatedFolderCount = newItems.length;
        setMediaItems((prev) => {
          const map = new Map<string, MediaItem>();
          for (const existing of prev) map.set(existing.id, existing);
          for (const item of newItems) {
            if (!Array.from(map.values()).some((m) => m.absolutePath === item.absolutePath)) {
              map.set(item.id, item);
            }
          }
          const nextList = Array.from(map.values());
          updatedFolderCount = nextList.filter((m) => m.folderId === folderId).length;
          return nextList;
        });

        setFolders((prev) => {
          if (prev.some((f) => f.id === folderId)) {
            return prev.map((f) =>
              f.id === folderId
                ? { ...f, lastScannedAt: Date.now(), itemCount: updatedFolderCount }
                : f
            );
          }
          return [
            ...prev,
            {
              id: folderId,
              name: folderName,
              pathLabel: 'Local Disk / Drag & Drop',
              autoScan: false,
              recursive: true,
              lastScannedAt: Date.now(),
              itemCount: updatedFolderCount,
              sourceType: 'virtual',
            },
          ];
        });
      }

      setIsScanning(false);
      setScanStatus(
        attachedSrtCount > 0
          ? `Attached ${attachedSrtCount} subtitle track(s) & imported ${newItems.length} media file(s).`
          : `Ready: ${newItems.length} media file(s) added directly from disk.`
      );
      window.setTimeout(() => setScanStatus(''), 4000);
    },
    [currentMediaId]
  );

  const handleImportNativePaths = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0 || isScanningRef.current) return;
      isScanningRef.current = true;
      setIsScanning(true);
      setScanStatus(`Scanning ${paths.length} dropped/selected path(s)...`);

      try {
        const existingMap = new Map(mediaItems.map((m) => [m.id, m]));
        const folderId = 'folder-local-imports';
        const folderName = 'Local Disk Imports';
        const newItems: MediaItem[] = [];
        const newFolders: LibraryFolder[] = [];
        let attachedSrtCount = 0;

        // 1. Subtitles (.srt / .vtt)
        const nonSubPaths: string[] = [];
        for (const p of paths) {
          const ext = getExtension(p);
          if (ext === 'srt' || ext === 'vtt') {
            try {
              const text = await tauriReadTextFile(p);
              const cues = parseSubtitles(text);
              const fileName = p.split(/[\\/]/).pop() || p;
              if (currentMediaId && cues.length > 0) {
                setMediaItems((prev) =>
                  prev.map((it) =>
                    it.id === currentMediaId
                      ? { ...it, subtitleCues: cues, subtitleName: fileName }
                      : it
                  )
                );
                attachedSrtCount++;
              }
            } catch {
              // ignore unreadable srt
            }
          } else {
            nonSubPaths.push(p);
          }
        }

        // 2. Inspect individual media files directly on disk
        if (nonSubPaths.length > 0) {
          const fileInfos = await tauriInspectDiskFiles(nonSubPaths);
          const matchedFilePaths = new Set(fileInfos.map((f) => f.absolutePath));

          for (const df of fileInfos) {
            const existing = existingMap.get(makeTauriMediaId(df.absolutePath));
            newItems.push(await buildMediaItemFromTauriDiskFile(df, folderId, folderName, existing));
          }

          // 3. Any remaining path that wasn't a media file might be a folder
          for (const candidate of nonSubPaths) {
            if (matchedFilePaths.has(candidate)) continue;
            try {
              const scanned = await tauriScanFolder(candidate, true);
              const dirName = candidate.split(/[\\/]/).filter(Boolean).pop() || candidate;
              const dirId = `tauri_${makeTauriMediaId(candidate)}`;
              for (const df of scanned) {
                const existing = existingMap.get(makeTauriMediaId(df.absolutePath));
                newItems.push(await buildMediaItemFromTauriDiskFile(df, dirId, dirName, existing));
              }
              newFolders.push({
                id: dirId,
                name: dirName,
                pathLabel: candidate,
                autoScan: true,
                recursive: true,
                lastScannedAt: Date.now(),
                itemCount: scanned.length,
                sourceType: 'tauri-path',
              });
            } catch {
              // Not a directory or unsupported file
            }
          }
        }

        if (newItems.length > 0) {
          let nextListSnapshot: MediaItem[] = [];
          setMediaItems((prev) => {
            const map = new Map<string, MediaItem>();
            for (const existing of prev) map.set(existing.id, existing);
            for (const item of newItems) map.set(item.id, item);
            nextListSnapshot = Array.from(map.values());
            return nextListSnapshot;
          });

          setFolders((prev) => {
            const map = new Map<string, LibraryFolder>();
            for (const f of prev) map.set(f.id, f);
            for (const nf of newFolders) map.set(nf.id, nf);
            const hasLooseFiles = newItems.some((i) => i.folderId === folderId);
            if (hasLooseFiles && !map.has(folderId)) {
              map.set(folderId, {
                id: folderId,
                name: folderName,
                pathLabel: 'Local Disk / Drag & Drop',
                autoScan: false,
                recursive: true,
                lastScannedAt: Date.now(),
                itemCount: newItems.filter((i) => i.folderId === folderId).length,
                sourceType: 'virtual',
              });
            }
            return Array.from(map.values()).map((f) => ({
              ...f,
              itemCount:
                f.id === 'folder-builtin'
                  ? nextListSnapshot.filter((it) => it.folderId === f.id).length
                  : nextListSnapshot.filter((it) => it.folderId === f.id).length,
            }));
          });
        }

        setScanStatus(
          attachedSrtCount > 0
            ? `Attached ${attachedSrtCount} subtitle(s) & added ${newItems.length} disk file(s).`
            : `Ready: ${newItems.length} media file(s) linked directly from disk.`
        );
      } finally {
        isScanningRef.current = false;
        setIsScanning(false);
        window.setTimeout(() => setScanStatus(''), 4000);
      }
    },
    [currentMediaId, mediaItems]
  );

  // Listen for native Tauri drag-and-drop paths from Windows Explorer
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlistenDrop: (() => void) | null = null;
    void tauriListen<string[]>('gendev-files-dropped', (paths) => {
      if (Array.isArray(paths) && paths.length > 0) {
        void handleImportNativePaths(paths);
      }
    }).then((fn) => {
      unlistenDrop = fn;
    });
    return () => {
      unlistenDrop?.();
    };
  }, [handleImportNativePaths]);

  const handleBrowseNativeFiles = useCallback(async () => {
    if (!isTauriRuntime()) return;
    const paths = await tauriPickMediaFiles();
    if (paths.length > 0) {
      await handleImportNativePaths(paths);
    }
  }, [handleImportNativePaths]);

  const handleLocateMissingNative = useCallback(async (itemId: string) => {
    if (!isTauriRuntime()) return;
    const newPath = await tauriPickSingleMediaFile();
    if (!newPath) return;
    const diskFiles = await tauriInspectDiskFiles([newPath]);
    const df = diskFiles[0];
    setMediaItems((prev) =>
      prev.map((it) =>
        it.id === itemId
          ? {
              ...it,
              url: toTauriAssetUrl(newPath),
              missing: false,
              sizeBytes: df?.sizeBytes ?? it.sizeBytes,
              absolutePath: newPath,
              relativePath: df?.relativePath ?? it.relativePath,
              sourceType: 'tauri-path',
            }
          : it
      )
    );
  }, []);

  const handleAddFolderPicker = useCallback(async () => {
    if (isScanningRef.current) return;

    if (isTauriRuntime()) {
      const folderPath = await tauriPickMediaFolder();
      if (!folderPath) return;

      isScanningRef.current = true;
      setIsScanning(true);
      setScanStatus(`Scanning "${folderPath}" recursively...`);

      try {
        const dirName = folderPath.split(/[\\/]/).filter(Boolean).pop() || folderPath;
        const folderId = `tauri_${makeTauriMediaId(folderPath)}`;
        const diskFiles = await tauriScanFolder(folderPath, true);
        const existingMap = new Map(mediaItems.map((m) => [m.id, m]));
        const scanned: MediaItem[] = [];
        for (const df of diskFiles) {
          const existing = existingMap.get(makeTauriMediaId(df.absolutePath));
          scanned.push(await buildMediaItemFromTauriDiskFile(df, folderId, dirName, existing));
        }

        const newFolder: LibraryFolder = {
          id: folderId,
          name: dirName,
          pathLabel: folderPath,
          autoScan: true,
          recursive: true,
          lastScannedAt: Date.now(),
          itemCount: scanned.length,
          sourceType: 'tauri-path',
        };

        setFolders((prev) => [...prev.filter((f) => f.id !== folderId), newFolder]);
        setMediaItems((prev) => {
          const map = new Map<string, MediaItem>();
          for (const item of scanned) map.set(item.id, item);
          for (const existing of prev) {
            if (existing.folderId !== folderId && !map.has(existing.id)) {
              map.set(existing.id, existing);
            }
          }
          return Array.from(map.values());
        });
        setScanStatus(`Added "${dirName}" (${scanned.length} media files).`);
      } catch (err) {
        setPlaybackError(`Folder scan error: ${String(err)}`);
      } finally {
        isScanningRef.current = false;
        setIsScanning(false);
        window.setTimeout(() => setScanStatus(''), 4000);
      }
      return;
    }

    const win = window as unknown as {
      showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
    };
    if (typeof win.showDirectoryPicker !== 'function') {
      setScanStatus('Use "Browse Directory (Subfolders)" or drag a folder onto the window.');
      window.setTimeout(() => setScanStatus(''), 4000);
      return;
    }

    try {
      const dirHandle = await win.showDirectoryPicker();
      const folderId = `dir_${dirHandle.name}`.replace(/[^a-zA-Z0-9_-]/g, '_');
      await saveFileHandle(`folder_${folderId}`, dirHandle);

      const newFolder: LibraryFolder = {
        id: folderId,
        name: dirHandle.name,
        pathLabel: `Local Directory / ${dirHandle.name}`,
        autoScan: true,
        recursive: true,
        lastScannedAt: Date.now(),
        itemCount: 0,
        sourceType: 'directory-handle',
      };

      isScanningRef.current = true;
      setIsScanning(true);
      setScanStatus(`Scanning "${dirHandle.name}" recursively...`);

      const scanned = await scanDirectoryHandle(dirHandle, newFolder, (count, file) => {
        setScanStatus(`Scanning (${count}): ${file}`);
      });

      newFolder.itemCount = scanned.length;
      setFolders((prev) => {
        const filtered = prev.filter((f) => f.id !== folderId);
        return [...filtered, newFolder];
      });
      setMediaItems((prev) => {
        const map = new Map<string, MediaItem>();
        for (const item of scanned) map.set(item.id, item);
        for (const existing of prev) {
          if (existing.folderId !== folderId && !map.has(existing.id)) {
            map.set(existing.id, existing);
          }
        }
        return Array.from(map.values());
      });
      isScanningRef.current = false;
      setIsScanning(false);
      setScanStatus(`Added "${dirHandle.name}" (${scanned.length} media files).`);
      window.setTimeout(() => setScanStatus(''), 4000);
    } catch {
      isScanningRef.current = false;
      setIsScanning(false);
    }
  }, [mediaItems]);

  const handleRefreshLibrary = useCallback(async () => {
    if (isScanningRef.current) return;
    isScanningRef.current = true;
    setIsScanning(true);
    setScanStatus('Refreshing folders & verifying file paths...');

    try {
      const existingMap = new Map(mediaItems.map((m) => [m.id, m]));
      const rescannedByFolder = new Map<string, MediaItem[]>();

      for (const folder of folders) {
        if (folder.sourceType === 'tauri-path' && isTauriRuntime()) {
          try {
            const diskFiles = await tauriScanFolder(folder.pathLabel, folder.recursive);
            const itemsInDir: MediaItem[] = [];
            for (const df of diskFiles) {
              const existing = existingMap.get(makeTauriMediaId(df.absolutePath));
              itemsInDir.push(
                await buildMediaItemFromTauriDiskFile(df, folder.id, folder.name, existing)
              );
            }
            rescannedByFolder.set(folder.id, itemsInDir);
          } catch {
            // Drive temporarily disconnected; preserve existing entries and mark missing below
          }
          continue;
        }

        if (folder.sourceType !== 'directory-handle') continue;
        const handle = await getFileHandle<FileSystemDirectoryHandle>(`folder_${folder.id}`);
        if (!handle) continue;
        try {
          const perm = await (
            handle as FileSystemDirectoryHandle & {
              queryPermission?: (desc: { mode: string }) => Promise<string>;
            }
          ).queryPermission?.({ mode: 'read' });
          if (perm === 'granted') {
            const itemsInDir = await scanDirectoryHandle(handle, folder);
            rescannedByFolder.set(folder.id, itemsInDir);
          }
        } catch {
          // Folder temporarily inaccessible
        }
      }

      const res = await resolveSavedHandleItems(mediaItems);
      const mergedMap = new Map<string, MediaItem>();

      for (const item of res.updated) {
        if (rescannedByFolder.has(item.folderId)) continue;
        mergedMap.set(item.id, item);
      }

      for (const [, dirItems] of rescannedByFolder.entries()) {
        for (const item of dirItems) {
          mergedMap.set(item.id, item);
        }
      }

      const finalItems = Array.from(mergedMap.values());
      const finalMissingCount = finalItems.filter((it) => it.missing).length;
      setMediaItems(finalItems);
      setFolders((prev) =>
        prev.map((f) => ({
          ...f,
          lastScannedAt: Date.now(),
          itemCount: finalItems.filter((it) => it.folderId === f.id).length,
        }))
      );

      setScanStatus(
        finalMissingCount > 0
          ? `Scan complete: ${finalMissingCount} file(s) missing or offline.`
          : `Library refreshed (${finalItems.length} unique media files).`
      );
    } finally {
      isScanningRef.current = false;
      setIsScanning(false);
      window.setTimeout(() => setScanStatus(''), 4000);
    }
  }, [folders, mediaItems]);

  const didAutoScanStartupRef = useRef(false);
  useEffect(() => {
    if (!hydrated || didAutoScanStartupRef.current) return;
    didAutoScanStartupRef.current = true;
    if (
      isTauriRuntime() &&
      settings.autoScanOnStartup &&
      folders.some((f) => f.sourceType === 'tauri-path' && f.autoScan)
    ) {
      void handleRefreshLibrary();
    }
  }, [folders, handleRefreshLibrary, hydrated, settings.autoScanOnStartup]);

  const handleLocateMissingFile = useCallback(async (itemId: string, file: File) => {
    const url = URL.createObjectURL(file);
    setMediaItems((prev) =>
      prev.map((it) =>
        it.id === itemId
          ? {
              ...it,
              url,
              missing: false,
              sizeBytes: file.size,
              absolutePath: file.name,
            }
          : it
      )
    );
  }, []);

  const handleLoadSrtForCurrent = useCallback(
    async (file: File) => {
      if (!currentMediaId) return;
      const text = await file.text();
      const cues = parseSubtitles(text);
      setMediaItems((prev) =>
        prev.map((it) =>
          it.id === currentMediaId
            ? { ...it, subtitleCues: cues, subtitleName: file.name }
            : it
        )
      );
    },
    [currentMediaId]
  );

  // Backup / Restore JSON
  const handleExportBackup = useCallback(async () => {
    const payload = {
      app: 'GENDEV Worship Media Player',
      exportedAt: new Date().toISOString(),
      settings,
      playlists,
      folders,
    };
    const json = JSON.stringify(payload, null, 2);
    if (isTauriRuntime()) {
      await tauriSaveBackupFile(json).catch(() => {});
      return;
    }
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gendev-worship-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [folders, playlists, settings]);

  const handleImportBackup = useCallback(async (file: File): Promise<boolean> => {
    try {
      const parsed = JSON.parse(await file.text()) as {
        settings?: AppSettings;
        playlists?: Playlist[];
        folders?: LibraryFolder[];
      };
      if (!parsed || typeof parsed !== 'object' || !parsed.settings) return false;
      setSettings({ ...DEFAULT_SETTINGS, ...parsed.settings });
      if (Array.isArray(parsed.playlists)) setPlaylists(parsed.playlists);
      if (Array.isArray(parsed.folders)) setFolders(parsed.folders);
      return true;
    } catch {
      return false;
    }
  }, []);

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#0A0D14] text-[#E6E9F2]">
      {/* Hidden Real Media Engines */}
      <video
        ref={deckARef}
        className="hidden"
        playsInline
        preload="auto"
        onTimeUpdate={() => handleDeckTimeUpdate('A')}
        onEnded={() => handleDeckEnded('A')}
        onError={() => {
          if (activeDeck === 'A' && currentMedia) {
            setPlaybackError(
              `Format ${currentMedia.format} tidak didukung oleh codec browser; gunakan MP4/WebM/MOV di web atau aplikasi Desktop Windows (LibVLC) untuk MKV/AVI/WMV.`
            );
            setIsPlaying(false);
          }
        }}
      />
      <video
        ref={deckBRef}
        className="hidden"
        playsInline
        preload="auto"
        onTimeUpdate={() => handleDeckTimeUpdate('B')}
        onEnded={() => handleDeckEnded('B')}
        onError={() => {
          if (activeDeck === 'B' && currentMedia) {
            setPlaybackError(
              `Format ${currentMedia.format} tidak didukung oleh codec browser; gunakan MP4/WebM/MOV di web atau aplikasi Desktop Windows (LibVLC) untuk MKV/AVI/WMV.`
            );
            setIsPlaying(false);
          }
        }}
      />
      <audio
        ref={bgmAudioRef}
        className="hidden"
        preload="auto"
        onEnded={handleNextBgm}
      />

      {/* Hidden Link to open Monitor 2 Projector Window without window.open */}
      <a
        ref={projectorLinkRef}
        href="?mode=projector"
        target="_blank"
        className="hidden"
      >
        Projector Output
      </a>

      {/* Single-Screen Fullscreen Container */}
      <div
        ref={singleFsRef}
        onDoubleClick={() => {
          if (document.fullscreenElement) {
            void document.exitFullscreen().catch(() => {});
          }
        }}
        className={singleScreenFsActive ? 'fixed inset-0 z-50 bg-black' : 'hidden'}
      >
        {singleScreenFsActive && <ProjectorStage state={projectorState} muted={true} />}
      </div>

      {/* Top Bar Contract: Zone 1 (Wordmark) — Zone 2 (Clean Text Tabs) — Zone 3 (1 Primary Action) */}
      <header className="h-14 shrink-0 px-3 lg:px-5 border-b border-white/[0.08] bg-[#0D111B] flex items-center justify-between gap-3 lg:gap-6">
        {/* Zone 1: Single text element wordmark */}
        <span className="font-display text-sm lg:text-base font-bold tracking-tight text-white whitespace-nowrap shrink-0">
          GENDEV Worship Media Player
        </span>

        {/* Zone 2: 4 clean single-line navigation links */}
        <nav className="flex items-center gap-3 lg:gap-6 text-xs font-medium overflow-x-auto min-w-0">
          {(
            [
              { id: 'console', label: 'Operator Console' },
              { id: 'library', label: 'Media Library' },
              { id: 'playlists', label: 'Playlists' },
              { id: 'settings', label: 'Settings' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === tab.id
                  ? 'border-[#6366F1] text-white'
                  : 'border-transparent text-slate-400 hover:text-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Zone 3: 1 Primary Action */}
        <div className="flex items-center shrink-0">
          {projectorWindowOpen ? (
            <button
              type="button"
              onClick={handleExitProjector}
              className="flex items-center gap-2 px-3 lg:px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors"
            >
              <MonitorOff className="w-3.5 h-3.5" />
              <span>Exit Projector</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleOpenProjectorWindow}
              className="flex items-center gap-2 px-3 lg:px-4 py-2 rounded-lg bg-[#5E6AD2] hover:bg-[#4F5BC0] text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors"
            >
              <Monitor className="w-3.5 h-3.5" />
              <span>Send to Projector</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Workspace Viewport */}
      {activeTab === 'console' && (
        <ConsoleView
          items={mediaItems}
          mediaMap={mediaMap}
          playlists={playlists}
          activePlaylist={activePlaylist}
          activeIndex={activeIndex}
          currentMedia={currentMedia}
          nextMedia={nextMedia}
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          playbackRate={playbackRate}
          masterVolume={settings.masterVolume}
          isMuted={isMuted}
          liveAudioLevel={liveAudioLevel}
          fadeProgress={fadeProgress}
          repeatMode={repeatMode}
          shuffleEnabled={shuffleEnabled}
          blackScreen={blackScreen}
          freezeFrame={freezeFrame}
          projectorWindowOpen={projectorWindowOpen}
          projectorState={projectorState}
          digitalClock={digitalClock}
          countdownRemainingSec={countdownRemainingSec}
          countdownRunning={countdownRunning}
          bgmPlaying={bgmPlaying}
          bgmTrackName={currentBgmItem?.name || ''}
          bgmVolume={settings.bgm.volume}
          settings={settings}
          onSelectPlaylist={(id) => {
            setActivePlaylistId(id);
            setActiveIndex(0);
          }}
          onReorderActivePlaylist={(fromIndex, toIndex) => {
            setPlaylists((prev) =>
              prev.map((pl) => {
                if (pl.id !== activePlaylist.id) return pl;
                const copy = [...pl.itemIds];
                const [moved] = copy.splice(fromIndex, 1);
                copy.splice(toIndex, 0, moved);
                return { ...pl, itemIds: copy, updatedAt: Date.now() };
              })
            );
            setActiveIndex((curr) => {
              if (curr === fromIndex) return toIndex;
              if (fromIndex < curr && toIndex >= curr) return curr - 1;
              if (fromIndex > curr && toIndex <= curr) return curr + 1;
              return curr;
            });
          }}
          onPlayMedia={playMediaItem}
          onTogglePlayPause={handleTogglePlayPause}
          onStop={handleStop}
          onNext={handleNext}
          onPrevious={handlePrevious}
          onSeek={(sec) => {
            const el = getDeckEl();
            if (el && Number.isFinite(sec)) {
              el.currentTime = sec;
              setCurrentTime(sec);
              const elDur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : duration;
              if (!settings.fade.autoFadeAtEndEnabled || elDur - sec > settings.fade.autoFadeAtEndSec + 0.5) {
                audioEngine.cancelMainFade(el);
                autoFadeTriggeredRef.current = false;
                deckGainRef.current = 1;
                audioEngine.setElementGainImmediate(el, 1);
                setFadeProgress({ active: false, direction: 'out', progress: 0, currentVolPct: 100 });
              }
            }
          }}
          onChangePlaybackRate={(rate) => {
            setPlaybackRate(rate);
            const el = getDeckEl();
            if (el) el.playbackRate = rate;
          }}
          onChangeMasterVolume={(vol) =>
            setSettings((prev) => ({ ...prev, masterVolume: vol }))
          }
          onToggleMute={() => setIsMuted((m) => !m)}
          onSmartFadeOut={handleSmartFadeOut}
          onSmartFadeIn={handleSmartFadeIn}
          onToggleBlackScreen={() => setBlackScreen((b) => !b)}
          onToggleFreezeFrame={handleToggleFreezeFrame}
          onOpenProjectorWindow={handleOpenProjectorWindow}
          onExitProjector={handleExitProjector}
          onEnterSingleScreenFullscreen={handleEnterSingleScreenFullscreen}
          onToggleRepeat={() =>
            setRepeatMode((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'))
          }
          onToggleShuffle={() => setShuffleEnabled((s) => !s)}
          playbackError={playbackError}
          onDismissError={() => setPlaybackError('')}
          manualQueueCount={manualQueueIds.length}
          onClearManualQueue={() => setManualQueueIds([])}
          onRemoveFromActivePlaylist={(index) => {
            const nextLen = Math.max(0, activePlaylist.itemIds.length - 1);
            setPlaylists((prev) =>
              prev.map((pl) => {
                if (pl.id !== activePlaylist.id) return pl;
                const copy = [...pl.itemIds];
                copy.splice(index, 1);
                return { ...pl, itemIds: copy, updatedAt: Date.now() };
              })
            );
            setActiveIndex((curr) => {
              if (index < curr) return Math.max(0, curr - 1);
              if (index === curr) return Math.max(0, Math.min(curr, nextLen - 1));
              return curr;
            });
          }}
          onClearSrtForCurrent={() => {
            if (!currentMediaId) return;
            setMediaItems((prev) =>
              prev.map((it) =>
                it.id === currentMediaId
                  ? { ...it, subtitleCues: undefined, subtitleName: undefined }
                  : it
              )
            );
          }}
          onStepSeek={(deltaSec) => {
            const el = getDeckEl();
            if (!el || !currentMedia) return;
            const elDur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : duration;
            const nextSec = Math.max(0, Math.min(elDur, (el.currentTime || 0) + deltaSec));
            el.currentTime = nextSec;
            setCurrentTime(nextSec);
            if (!settings.fade.autoFadeAtEndEnabled || elDur - nextSec > settings.fade.autoFadeAtEndSec + 0.5) {
              audioEngine.cancelMainFade(el);
              autoFadeTriggeredRef.current = false;
              deckGainRef.current = 1;
              audioEngine.setElementGainImmediate(el, 1);
              setFadeProgress({ active: false, direction: 'out', progress: 0, currentVolPct: 100 });
            }
          }}
          onAddToActivePlaylist={(itemId) => {
            setPlaylists((prev) =>
              prev.map((pl) =>
                pl.id === activePlaylist.id
                  ? { ...pl, itemIds: [...pl.itemIds, itemId], updatedAt: Date.now() }
                  : pl
              )
            );
          }}
          onQueueNext={(itemId) => setManualQueueIds((q) => [...q, itemId])}
          onAddFolderPicker={handleAddFolderPicker}
          onBrowseNativeFiles={isTauriRuntime() ? handleBrowseNativeFiles : undefined}
          onAddFiles={handleAddFiles}
          onRefreshLibrary={handleRefreshLibrary}
          isScanning={isScanning}
          onLoadSrtForCurrent={handleLoadSrtForCurrent}
          onToggleCountdownRun={() => setCountdownRunning((r) => !r)}
          onResetCountdown={(sec) => {
            setCountdownRunning(false);
            setCountdownRemainingSec(sec ?? settings.countdown.durationSec);
          }}
          onToggleCountdownProjector={() =>
            setSettings((prev) => ({
              ...prev,
              countdown: {
                ...prev.countdown,
                showOnProjector: !prev.countdown.showOnProjector,
              },
            }))
          }
          onToggleBgm={handleToggleBgm}
          onNextBgm={handleNextBgm}
          onChangeBgmVolume={(vol) => {
            setSettings((prev) => ({ ...prev, bgm: { ...prev.bgm, volume: vol } }));
            if (bgmAudioRef.current && bgmPlaying) {
              audioEngine.setElementGainImmediate(bgmAudioRef.current, vol / 100);
            }
          }}
          onUpdateSettings={setSettings}
        />
      )}

      {activeTab === 'library' && (
        <LibraryView
          items={mediaItems}
          folders={folders}
          playlists={playlists}
          activePlaylistId={activePlaylist.id}
          isScanning={isScanning}
          scanStatus={scanStatus}
          onAddFolderPicker={handleAddFolderPicker}
          onBrowseNativeFiles={isTauriRuntime() ? handleBrowseNativeFiles : undefined}
          onAddFiles={handleAddFiles}
          onRefreshLibrary={handleRefreshLibrary}
          onRemoveFolder={(folderId) => {
            setFolders((prev) => prev.filter((f) => f.id !== folderId));
            setMediaItems((prev) => prev.filter((i) => i.folderId !== folderId));
          }}
          onToggleFolderAutoScan={(folderId) => {
            setFolders((prev) =>
              prev.map((f) => (f.id === folderId ? { ...f, autoScan: !f.autoScan } : f))
            );
          }}
          onLocateMissingFile={handleLocateMissingFile}
          onLocateMissingNative={isTauriRuntime() ? handleLocateMissingNative : undefined}
          onPlayMedia={(item) => {
            playMediaItem(item);
            setActiveTab('console');
          }}
          onAddToPlaylist={(playlistId, itemId) => {
            setPlaylists((prev) =>
              prev.map((pl) =>
                pl.id === playlistId
                  ? { ...pl, itemIds: [...pl.itemIds, itemId], updatedAt: Date.now() }
                  : pl
              )
            );
          }}
          onDeleteCustomItem={(itemId) => {
            setMediaItems((prev) => prev.filter((i) => i.id !== itemId));
          }}
        />
      )}

      {activeTab === 'playlists' && (
        <PlaylistsView
          playlists={playlists}
          activePlaylistId={activePlaylist.id}
          mediaMap={mediaMap}
          allItems={mediaItems}
          onSelectActivePlaylist={(id) => {
            setActivePlaylistId(id);
            setActiveIndex(0);
          }}
          onCreatePlaylist={(name, isBgm) => {
            const now = Date.now();
            const newPl: Playlist = {
              id: `pl_${now}`,
              name,
              itemIds: [],
              isBgm,
              createdAt: now,
              updatedAt: now,
            };
            setPlaylists((prev) => [...prev, newPl]);
          }}
          onRenamePlaylist={(id, newName) => {
            setPlaylists((prev) =>
              prev.map((pl) =>
                pl.id === id ? { ...pl, name: newName, updatedAt: Date.now() } : pl
              )
            );
          }}
          onDeletePlaylist={(id) => {
            setPlaylists((prev) => {
              const remaining = prev.filter((p) => p.id !== id);
              if (activePlaylistId === id && remaining[0]) {
                setActivePlaylistId(remaining[0].id);
              }
              return remaining;
            });
          }}
          onReorderPlaylist={(playlistId, fromIndex, toIndex) => {
            setPlaylists((prev) =>
              prev.map((pl) => {
                if (pl.id !== playlistId) return pl;
                const copy = [...pl.itemIds];
                const [moved] = copy.splice(fromIndex, 1);
                copy.splice(toIndex, 0, moved);
                return { ...pl, itemIds: copy, updatedAt: Date.now() };
              })
            );
          }}
          onRemoveItemFromPlaylist={(playlistId, index) => {
            setPlaylists((prev) =>
              prev.map((pl) => {
                if (pl.id !== playlistId) return pl;
                const copy = [...pl.itemIds];
                copy.splice(index, 1);
                return { ...pl, itemIds: copy, updatedAt: Date.now() };
              })
            );
          }}
          onAddItemToPlaylist={(playlistId, itemId) => {
            setPlaylists((prev) =>
              prev.map((pl) =>
                pl.id === playlistId
                  ? { ...pl, itemIds: [...pl.itemIds, itemId], updatedAt: Date.now() }
                  : pl
              )
            );
          }}
          onPlayPlaylistFromIndex={(playlistId, index) => {
            const targetPl = playlists.find((p) => p.id === playlistId);
            if (!targetPl) return;
            setActivePlaylistId(playlistId);
            const itemId = targetPl.itemIds[index];
            const item = itemId ? mediaMap.get(itemId) : undefined;
            if (item && !item.missing) {
              playMediaItem(item, index);
              setActiveTab('console');
            }
          }}
        />
      )}

      {activeTab === 'settings' && (
        <SettingsView
          settings={settings}
          playlists={playlists}
          onUpdateSettings={setSettings}
          onExportBackup={handleExportBackup}
          onImportBackup={handleImportBackup}
          onResetDefaults={() => {
            setSettings(DEFAULT_SETTINGS);
            setCountdownRemainingSec(DEFAULT_SETTINGS.countdown.durationSec);
          }}
        />
      )}
    </div>
  );
}
