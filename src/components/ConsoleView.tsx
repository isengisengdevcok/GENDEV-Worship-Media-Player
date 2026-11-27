import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Captions,
  Clock,
  ExternalLink,
  FileAudio,
  FilePlus,
  FileVideo,
  FolderPlus,
  ListPlus,
  Maximize,
  Monitor,
  MonitorOff,
  Music,
  Pause,
  Play,
  Repeat,
  Repeat1,
  RotateCcw,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Snowflake,
  Square,
  Sunrise,
  Sunset,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  AppSettings,
  MediaItem,
  Playlist,
  ProjectorSyncState,
  RepeatMode,
} from '../types/media';
import { formatDuration } from '../utils/formatters';
import { ProjectorStage } from './ProjectorStage';

interface ConsoleViewProps {
  items: MediaItem[];
  mediaMap: Map<string, MediaItem>;
  playlists: Playlist[];
  activePlaylist: Playlist;
  activeIndex: number;
  currentMedia: MediaItem | null;
  nextMedia: MediaItem | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  masterVolume: number;
  isMuted: boolean;
  liveAudioLevel: number;
  fadeProgress: { active: boolean; direction: 'in' | 'out'; progress: number; currentVolPct: number };
  repeatMode: RepeatMode;
  shuffleEnabled: boolean;
  blackScreen: boolean;
  freezeFrame: boolean;
  projectorWindowOpen: boolean;
  projectorState: ProjectorSyncState;
  digitalClock: string;
  countdownRemainingSec: number;
  countdownRunning: boolean;
  bgmPlaying: boolean;
  bgmTrackName: string;
  bgmVolume: number;
  settings: AppSettings;
  onSelectPlaylist: (playlistId: string) => void;
  onPlayMedia: (item: MediaItem, playlistIndex?: number) => void;
  onTogglePlayPause: () => void;
  onStop: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (sec: number) => void;
  onChangePlaybackRate: (rate: number) => void;
  onChangeMasterVolume: (vol: number) => void;
  onToggleMute: () => void;
  onSmartFadeOut: () => void;
  onSmartFadeIn: () => void;
  onToggleBlackScreen: () => void;
  onToggleFreezeFrame: () => void;
  onOpenProjectorWindow: () => void;
  onExitProjector: () => void;
  onEnterSingleScreenFullscreen: () => void;
  onToggleRepeat: () => void;
  onToggleShuffle: () => void;
  onAddToActivePlaylist: (itemId: string) => void;
  onQueueNext: (itemId: string) => void;
  onAddFolderPicker: () => void;
  onAddFiles: (files: FileList | File[]) => void;
  onLoadSrtForCurrent: (file: File) => void;
  onToggleCountdownRun: () => void;
  onResetCountdown: (sec?: number) => void;
  onToggleCountdownProjector: () => void;
  onToggleBgm: () => void;
  onNextBgm: () => void;
  onChangeBgmVolume: (vol: number) => void;
  onUpdateSettings: (updater: (prev: AppSettings) => AppSettings) => void;
}

export const ConsoleView: React.FC<ConsoleViewProps> = ({
  items,
  mediaMap,
  playlists,
  activePlaylist,
  activeIndex,
  currentMedia,
  nextMedia,
  isPlaying,
  currentTime,
  duration,
  playbackRate,
  masterVolume,
  isMuted,
  liveAudioLevel,
  fadeProgress,
  repeatMode,
  shuffleEnabled,
  blackScreen,
  freezeFrame,
  projectorWindowOpen,
  projectorState,
  digitalClock,
  countdownRemainingSec,
  countdownRunning,
  bgmPlaying,
  bgmTrackName,
  bgmVolume,
  settings,
  onSelectPlaylist,
  onPlayMedia,
  onTogglePlayPause,
  onStop,
  onNext,
  onPrevious,
  onSeek,
  onChangePlaybackRate,
  onChangeMasterVolume,
  onToggleMute,
  onSmartFadeOut,
  onSmartFadeIn,
  onToggleBlackScreen,
  onToggleFreezeFrame,
  onOpenProjectorWindow,
  onExitProjector,
  onEnterSingleScreenFullscreen,
  onToggleRepeat,
  onToggleShuffle,
  onAddToActivePlaylist,
  onQueueNext,
  onAddFolderPicker,
  onAddFiles,
  onLoadSrtForCurrent,
  onToggleCountdownRun,
  onResetCountdown,
  onToggleCountdownProjector,
  onToggleBgm,
  onNextBgm,
  onChangeBgmVolume,
  onUpdateSettings,
}) => {
  const [libSearch, setLibSearch] = useState('');
  const [libKind, setLibKind] = useState<'all' | 'video' | 'audio'>('all');
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const srtInputRef = useRef<HTMLInputElement | null>(null);

  const filteredLibrary = useMemo(() => {
    const q = libSearch.trim().toLowerCase();
    return items.filter((it) => {
      if (libKind !== 'all' && it.kind !== libKind) return false;
      if (q && !it.name.toLowerCase().includes(q) && !it.format.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [items, libKind, libSearch]);

  const playlistEntries = useMemo(() => {
    return activePlaylist.itemIds.map((id, idx) => ({
      index: idx,
      id,
      item: mediaMap.get(id),
    }));
  }, [activePlaylist.itemIds, mediaMap]);

  return (
    <div
      className="flex-1 min-h-0 flex flex-col xl:flex-row gap-3.5 p-3.5 overflow-y-auto xl:overflow-hidden relative"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files?.length) {
          onAddFiles(e.dataTransfer.files);
        }
      }}
    >
      {isDragging && (
        <div className="absolute inset-3 z-40 bg-[#0A0D14]/92 border-2 border-dashed border-[#6366F1] rounded-xl flex flex-col items-center justify-center gap-2 pointer-events-none">
          <Upload className="w-9 h-9 text-indigo-400" />
          <p className="font-display text-base font-semibold text-white">
            Drop Video, Audio, or Subtitle (.SRT) Files
          </p>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="video/*,audio/*,.mkv,.avi,.wmv,.srt,.vtt"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) onAddFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={srtInputRef}
        type="file"
        accept=".srt,.vtt"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onLoadSrtForCurrent(f);
          e.target.value = '';
        }}
      />

      {/* COLUMN 1: Sidebar Media Library */}
      <aside className="w-full xl:w-[285px] shrink-0 bg-[#111622] border border-white/[0.08] rounded-xl p-3.5 flex flex-col gap-3 min-h-[280px] xl:min-h-0 overflow-hidden">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-xs font-semibold uppercase tracking-wider text-slate-300">
            Media Library
          </h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onAddFolderPicker}
              title="Add Local Folder"
              className="p-1.5 rounded-md bg-white/[0.05] hover:bg-white/[0.12] text-slate-200 cursor-pointer"
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Browse Media Files"
              className="p-1.5 rounded-md bg-white/[0.05] hover:bg-white/[0.12] text-slate-200 cursor-pointer"
            >
              <FilePlus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={libSearch}
            onChange={(e) => setLibSearch(e.target.value)}
            placeholder="Filter media..."
            className="w-full pl-8 pr-2.5 py-1.5 rounded-lg bg-[#0A0D14] border border-white/[0.08] text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#6366F1]"
          />
        </div>

        <div className="grid grid-cols-3 gap-1 p-0.5 bg-[#0A0D14] border border-white/[0.07] rounded-lg">
          {(['all', 'video', 'audio'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setLibKind(k)}
              className={`py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                libKind === k ? 'bg-[#5E6AD2] text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {k === 'all' ? 'All' : k === 'video' ? 'Video' : 'Audio'}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-1 pr-0.5">
          {filteredLibrary.map((item) => (
            <div
              key={item.id}
              className="group flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-white/[0.04] border border-transparent hover:border-white/[0.06] transition-colors"
            >
              <button
                type="button"
                disabled={item.missing}
                onClick={() => onPlayMedia(item)}
                className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer disabled:opacity-45"
              >
                <div className="w-10 h-7 rounded bg-[#0A0D14] border border-white/[0.08] overflow-hidden shrink-0 flex items-center justify-center">
                  {item.thumbnailUrl ? (
                    <img
                      src={item.thumbnailUrl}
                      alt={item.name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : item.kind === 'video' ? (
                    <FileVideo className="w-3.5 h-3.5 text-indigo-400" />
                  ) : (
                    <FileAudio className="w-3.5 h-3.5 text-sky-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-slate-100 truncate">{item.name}</p>
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                    <span>{item.format}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-tabular">
                      {item.durationSec > 0 ? formatDuration(item.durationSec) : '--:--'}
                    </span>
                    {item.missing && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-amber-400">Missing</span>
                      </>
                    )}
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => onAddToActivePlaylist(item.id)}
                title="Add to active playlist"
                className="p-1.5 rounded-md bg-white/[0.04] hover:bg-[#5E6AD2] text-slate-300 hover:text-white shrink-0 cursor-pointer"
              >
                <ListPlus className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* COLUMN 2: Center Dominant Stage Preview & Tactile Operator Deck */}
      <main className="flex-1 min-w-0 flex flex-col gap-3 overflow-y-auto xl:overflow-hidden">
        {/* Stage Preview Viewport */}
        <section className="bg-[#111622] border border-white/[0.08] rounded-xl p-3.5 flex flex-col gap-2.5 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="font-display text-sm font-semibold text-white truncate">
                  {currentMedia ? currentMedia.name : 'No Media Loaded'}
                </h1>
                {blackScreen && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-400 shrink-0">
                    <MonitorOff className="w-3.5 h-3.5" />
                    <span>BLACK SCREEN ACTIVE</span>
                  </span>
                )}
                {freezeFrame && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-sky-400 shrink-0">
                    <Snowflake className="w-3.5 h-3.5" />
                    <span>FROZEN ON PROJECTOR</span>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                <span>{currentMedia ? currentMedia.format : 'READY'}</span>
                {currentMedia?.resolution && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-tabular">{currentMedia.resolution}</span>
                  </>
                )}
                <span aria-hidden="true">·</span>
                <span className="font-mono-tabular">
                  {formatDuration(currentTime)} / {formatDuration(duration)}
                </span>
                {currentMedia?.subtitleName && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-indigo-300">SRT: {currentMedia.subtitleName}</span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                disabled={!currentMedia}
                onClick={() => srtInputRef.current?.click()}
                title="Load External .SRT / .VTT Subtitle"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-slate-200 text-xs font-medium disabled:opacity-40 cursor-pointer whitespace-nowrap"
              >
                <Captions className="w-3.5 h-3.5" />
                <span>SRT</span>
              </button>

              <select
                value={playbackRate}
                onChange={(e) => onChangePlaybackRate(Number(e.target.value))}
                title="Playback Speed"
                className="px-2 py-1.5 rounded-lg bg-[#0A0D14] border border-white/[0.08] font-mono-tabular text-xs text-slate-200 cursor-pointer"
              >
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                  <option key={r} value={r}>
                    {r}x
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={onEnterSingleScreenFullscreen}
                title="Fullscreen Projector Stage on Current Display"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-slate-200 text-xs font-medium cursor-pointer whitespace-nowrap"
              >
                <Maximize className="w-3.5 h-3.5" />
                <span>Fullscreen Stage</span>
              </button>
            </div>
          </div>

          {/* 16:9 Live Preview Canvas */}
          <div className="w-full aspect-video max-h-[300px] xl:max-h-[325px] bg-black rounded-lg overflow-hidden border border-white/[0.08] relative">
            <ProjectorStage state={projectorState} isPreview={true} muted={true} />
          </div>

          {/* Seek Scrubber & Live Audio Meter */}
          <div className="space-y-1.5 pt-0.5">
            <div className="flex items-center gap-3">
              <span className="font-mono-tabular text-xs text-slate-300 w-12">
                {formatDuration(currentTime)}
              </span>
              <input
                type="range"
                min={0}
                max={Math.max(1, duration)}
                step={0.1}
                value={Math.min(currentTime, Math.max(1, duration))}
                onChange={(e) => onSeek(Number(e.target.value))}
                disabled={!currentMedia}
                className="flex-1 studio-slider disabled:opacity-40"
              />
              <span className="font-mono-tabular text-xs text-slate-400 w-12 text-right">
                {formatDuration(duration)}
              </span>
            </div>

            {/* Live RMS Output Meter */}
            <div className="flex items-center gap-2.5">
              <span className="text-[11px] text-slate-400 w-12">Output</span>
              <div className="flex-1 h-1.5 rounded-full bg-[#0A0D14] overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#5E6AD2] via-[#3B82F6] to-[#38BDF8] transition-[width] duration-75"
                  style={{ width: `${Math.round(liveAudioLevel * 100)}%` }}
                />
              </div>
              <span className="font-mono-tabular text-[11px] text-slate-400 w-12 text-right">
                {isMuted ? 'MUTED' : `${Math.round(masterVolume)}%`}
              </span>
            </div>
          </div>
        </section>

        {/* Operator Tactile Stage Controls */}
        <section className="bg-[#111622] border border-white/[0.08] rounded-xl p-3.5 space-y-3 shrink-0">
          {/* Primary Transport + Volume */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onPrevious}
                title={`Previous (${settings.shortcuts.previous})`}
                className="h-11 px-3.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-slate-100 flex items-center justify-center cursor-pointer"
              >
                <SkipBack className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={onTogglePlayPause}
                title={`Play / Pause (${settings.shortcuts.playPause})`}
                className="h-11 px-6 rounded-lg bg-[#5E6AD2] hover:bg-[#4F5BC0] text-white font-display font-semibold text-sm flex items-center gap-2 whitespace-nowrap cursor-pointer"
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                <span>{isPlaying ? 'PAUSE' : 'PLAY'}</span>
              </button>

              <button
                type="button"
                onClick={onStop}
                title={`Stop (${settings.shortcuts.stop})`}
                className="h-11 px-4 rounded-lg bg-white/[0.06] hover:bg-rose-600/80 text-slate-100 font-display font-semibold text-xs flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-colors"
              >
                <Square className="w-3.5 h-3.5" />
                <span>STOP</span>
              </button>

              <button
                type="button"
                onClick={onNext}
                title={`Next (${settings.shortcuts.next})`}
                className="h-11 px-3.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-slate-100 flex items-center justify-center cursor-pointer"
              >
                <SkipForward className="w-4 h-4" />
              </button>
            </div>

            {/* Master Volume & Mute */}
            <div className="flex items-center gap-2.5 min-w-[200px]">
              <button
                type="button"
                onClick={onToggleMute}
                title={`Mute (${settings.shortcuts.mute})`}
                className={`p-2.5 rounded-lg border cursor-pointer transition-colors ${
                  isMuted
                    ? 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                    : 'bg-white/[0.05] border-white/[0.08] text-slate-200 hover:bg-white/[0.1]'
                }`}
              >
                {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={100}
                value={masterVolume}
                onChange={(e) => onChangeMasterVolume(Number(e.target.value))}
                className="flex-1 studio-slider"
              />
              <span className="font-mono-tabular text-xs text-slate-200 w-9 text-right">
                {Math.round(masterVolume)}%
              </span>
            </div>
          </div>

          <div className="h-px bg-white/[0.07]" />

          {/* Smart Fade Out / Fade In Hero Deck */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5 items-stretch">
            <button
              type="button"
              onClick={onSmartFadeOut}
              disabled={!currentMedia}
              title={`Smart Fade Out (${settings.shortcuts.fadeOut})`}
              className="md:col-span-5 relative overflow-hidden min-h-[54px] px-4 py-2.5 rounded-lg bg-gradient-to-r from-[#5E6AD2] to-[#7C5CFC] hover:brightness-110 disabled:opacity-45 text-white font-display font-bold text-sm flex items-center justify-between gap-2 cursor-pointer transition-all"
            >
              {fadeProgress.active && fadeProgress.direction === 'out' && (
                <div
                  className="absolute inset-y-0 left-0 bg-black/35 pointer-events-none"
                  style={{ width: `${Math.round(fadeProgress.progress * 100)}%` }}
                />
              )}
              <span className="relative flex items-center gap-2">
                <Sunset className="w-5 h-5" />
                <span>FADE OUT</span>
              </span>
              <span className="relative font-mono-tabular text-xs bg-black/25 px-2 py-0.5 rounded">
                {fadeProgress.active && fadeProgress.direction === 'out'
                  ? `${Math.round(fadeProgress.currentVolPct)}%`
                  : `${settings.fade.fadeOutDurationSec}s -> ${settings.fade.postFadeAction.toUpperCase()}`}
              </span>
            </button>

            <button
              type="button"
              onClick={onSmartFadeIn}
              disabled={!currentMedia}
              title={`Smart Fade In (${settings.shortcuts.fadeIn})`}
              className="md:col-span-3 relative overflow-hidden min-h-[54px] px-3.5 py-2.5 rounded-lg bg-[#1A2236] hover:bg-[#232D47] border border-indigo-400/30 disabled:opacity-45 text-indigo-100 font-display font-semibold text-xs flex items-center justify-between gap-2 cursor-pointer"
            >
              {fadeProgress.active && fadeProgress.direction === 'in' && (
                <div
                  className="absolute inset-y-0 left-0 bg-indigo-500/30 pointer-events-none"
                  style={{ width: `${Math.round(fadeProgress.progress * 100)}%` }}
                />
              )}
              <span className="relative flex items-center gap-1.5">
                <Sunrise className="w-4 h-4 text-indigo-300" />
                <span>FADE IN</span>
              </span>
              <span className="relative font-mono-tabular text-[11px] text-indigo-300">
                {settings.fade.fadeInDurationSec}s
              </span>
            </button>

            <div className="md:col-span-4 grid grid-cols-2 gap-2">
              <div className="px-2.5 py-1.5 rounded-lg bg-[#0A0D14] border border-white/[0.07] flex flex-col justify-center">
                <span className="text-[10px] text-slate-400">Fade Duration</span>
                <select
                  value={settings.fade.fadeOutDurationSec}
                  onChange={(e) =>
                    onUpdateSettings((p) => ({
                      ...p,
                      fade: {
                        ...p.fade,
                        fadeOutDurationSec: Number(e.target.value) as 1 | 2 | 3 | 5 | 10 | 15,
                      },
                    }))
                  }
                  className="bg-transparent text-xs font-mono-tabular text-white focus:outline-none cursor-pointer"
                >
                  {[1, 2, 3, 5, 10, 15].map((s) => (
                    <option key={s} value={s} className="bg-[#111622]">
                      {s} seconds
                    </option>
                  ))}
                </select>
              </div>

              <div className="px-2.5 py-1.5 rounded-lg bg-[#0A0D14] border border-white/[0.07] flex flex-col justify-center">
                <span className="text-[10px] text-slate-400">Auto-Fade End</span>
                <select
                  value={settings.fade.autoFadeAtEndEnabled ? settings.fade.autoFadeAtEndSec : 0}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    onUpdateSettings((p) => ({
                      ...p,
                      fade: {
                        ...p.fade,
                        autoFadeAtEndEnabled: val > 0,
                        autoFadeAtEndSec: (val > 0 ? val : p.fade.autoFadeAtEndSec) as
                          | 3
                          | 5
                          | 10
                          | 15,
                      },
                    }));
                  }}
                  className="bg-transparent text-xs font-mono-tabular text-white focus:outline-none cursor-pointer"
                >
                  <option value={0} className="bg-[#111622]">
                    Off
                  </option>
                  {[3, 5, 10, 15].map((s) => (
                    <option key={s} value={s} className="bg-[#111622]">
                      Last {s}s
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Projector Output, Black Screen, Freeze Frame */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <button
              type="button"
              onClick={onToggleBlackScreen}
              title={`Black Screen (${settings.shortcuts.blackScreen})`}
              className={`min-h-[44px] px-3 py-2 rounded-lg text-xs font-display font-semibold flex items-center justify-center gap-2 border cursor-pointer transition-colors whitespace-nowrap ${
                blackScreen
                  ? 'bg-rose-600 text-white border-rose-400'
                  : 'bg-[#0A0D14] hover:bg-white/[0.06] text-slate-200 border-white/[0.09]'
              }`}
            >
              <MonitorOff className="w-4 h-4 shrink-0" />
              <span>{blackScreen ? 'EXIT BLACK' : 'BLACK SCREEN'}</span>
            </button>

            <button
              type="button"
              onClick={onToggleFreezeFrame}
              title={`Freeze Frame (${settings.shortcuts.freezeFrame})`}
              className={`min-h-[44px] px-3 py-2 rounded-lg text-xs font-display font-semibold flex items-center justify-center gap-2 border cursor-pointer transition-colors whitespace-nowrap ${
                freezeFrame
                  ? 'bg-sky-600 text-white border-sky-400'
                  : 'bg-[#0A0D14] hover:bg-white/[0.06] text-slate-200 border-white/[0.09]'
              }`}
            >
              <Snowflake className="w-4 h-4 shrink-0" />
              <span>{freezeFrame ? 'UNFREEZE' : 'FREEZE FRAME'}</span>
            </button>

            {projectorWindowOpen ? (
              <button
                type="button"
                onClick={onExitProjector}
                className="sm:col-span-2 min-h-[44px] px-3 py-2 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 text-xs font-display font-semibold flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
              >
                <Monitor className="w-4 h-4 shrink-0" />
                <span>EXIT PROJECTOR (MONITOR 2 LIVE)</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onOpenProjectorWindow}
                className="sm:col-span-2 min-h-[44px] px-3 py-2 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-display font-semibold flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
              >
                <ExternalLink className="w-4 h-4 shrink-0" />
                <span>SEND TO PROJECTOR (MONITOR 2)</span>
              </button>
            )}
          </div>
        </section>

        {/* Background Music Strip */}
        <section className="bg-[#111622] border border-white/[0.08] rounded-xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <Music className="w-4 h-4 text-sky-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white truncate">
                Background Music: {bgmTrackName || 'Ready'}
              </p>
              <p className="text-[11px] text-slate-400">
                {settings.bgm.allowSimultaneousWithVideo
                  ? 'Simultaneous with video'
                  : 'Auto-fades out when video starts'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onToggleBgm}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 cursor-pointer ${
                bgmPlaying
                  ? 'bg-sky-600 text-white'
                  : 'bg-white/[0.06] hover:bg-white/[0.12] text-slate-200'
              }`}
            >
              {bgmPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{bgmPlaying ? 'Pause BGM' : 'Play BGM'}</span>
            </button>

            <button
              type="button"
              onClick={onNextBgm}
              title="Next Background Music Track"
              className="p-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.12] text-slate-200 cursor-pointer"
            >
              <SkipForward className="w-3.5 h-3.5" />
            </button>

            <div className="flex items-center gap-2 w-32">
              <input
                type="range"
                min={0}
                max={100}
                value={bgmVolume}
                onChange={(e) => onChangeBgmVolume(Number(e.target.value))}
                className="flex-1 studio-slider"
              />
              <span className="font-mono-tabular text-[11px] text-slate-300 w-8 text-right">
                {bgmVolume}%
              </span>
            </div>
          </div>
        </section>
      </main>

      {/* COLUMN 3: Digital Clock, Countdown & Service Playlist */}
      <aside className="w-full xl:w-[320px] shrink-0 flex flex-col gap-3 min-h-[320px] xl:min-h-0 overflow-hidden">
        {/* Digital Clock & Countdown Card */}
        <section className="bg-[#111622] border border-white/[0.08] rounded-xl p-3.5 space-y-2.5 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Clock className="w-3.5 h-3.5 text-indigo-400" />
              <span>Service Time</span>
            </div>
            <span className="font-mono-tabular text-base font-bold text-white">
              {digitalClock}
            </span>
          </div>

          <div className="h-px bg-white/[0.07]" />

          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[11px] text-slate-400">Worship Countdown</p>
              <div className="font-mono-tabular text-2xl font-bold text-indigo-300 leading-tight">
                {formatDuration(countdownRemainingSec)}
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onToggleCountdownRun}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
                  countdownRunning
                    ? 'bg-amber-600 text-white'
                    : 'bg-[#5E6AD2] hover:bg-[#4F5BC0] text-white'
                }`}
              >
                {countdownRunning ? 'Pause' : 'Start'}
              </button>
              <button
                type="button"
                onClick={() => onResetCountdown()}
                title="Reset Countdown"
                className="p-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-slate-200 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              {[180, 300, 600].map((sec) => (
                <button
                  key={sec}
                  type="button"
                  onClick={() => onResetCountdown(sec)}
                  className="px-2 py-1 rounded bg-[#0A0D14] hover:bg-white/[0.08] font-mono-tabular text-[11px] text-slate-300 cursor-pointer"
                >
                  {sec / 60}m
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={settings.countdown.showOnProjector}
                onChange={onToggleCountdownProjector}
                className="rounded border-white/20 bg-[#0A0D14]"
              />
              <span>Show on Projector</span>
            </label>
          </div>
        </section>

        {/* Active Service Playlist */}
        <section className="flex-1 min-h-0 bg-[#111622] border border-white/[0.08] rounded-xl p-3.5 flex flex-col gap-2.5 overflow-hidden">
          <div className="flex items-center justify-between gap-2">
            <select
              value={activePlaylist.id}
              onChange={(e) => onSelectPlaylist(e.target.value)}
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-[#0A0D14] border border-white/[0.09] text-xs font-semibold text-white focus:outline-none focus:border-[#6366F1]"
            >
              {playlists.map((pl) => (
                <option key={pl.id} value={pl.id}>
                  {pl.name} ({pl.itemIds.length})
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={onToggleRepeat}
              title={`Repeat: ${repeatMode}`}
              className={`p-1.5 rounded-lg border cursor-pointer ${
                repeatMode !== 'off'
                  ? 'bg-[#5E6AD2]/25 border-[#5E6AD2]/50 text-indigo-200'
                  : 'bg-[#0A0D14] border-white/[0.08] text-slate-400 hover:text-white'
              }`}
            >
              {repeatMode === 'one' ? (
                <Repeat1 className="w-3.5 h-3.5" />
              ) : (
                <Repeat className="w-3.5 h-3.5" />
              )}
            </button>

            <button
              type="button"
              onClick={onToggleShuffle}
              title="Toggle Shuffle"
              className={`p-1.5 rounded-lg border cursor-pointer ${
                shuffleEnabled
                  ? 'bg-[#5E6AD2]/25 border-[#5E6AD2]/50 text-indigo-200'
                  : 'bg-[#0A0D14] border-white/[0.08] text-slate-400 hover:text-white'
              }`}
            >
              <Shuffle className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Next Up Indicator */}
          <div className="px-2.5 py-2 rounded-lg bg-[#0A0D14] border border-white/[0.07] text-xs">
            <span className="text-slate-400">Next Up: </span>
            <span className="text-slate-100 font-medium">
              {nextMedia ? nextMedia.name : 'End of Playlist'}
            </span>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto space-y-1 pr-0.5">
            {playlistEntries.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-400">
                Playlist is empty. Click + next to any library item to queue it.
              </div>
            ) : (
              playlistEntries.map(({ index, id, item }) => {
                const isCurrent = index === activeIndex && currentMedia?.id === id;
                return (
                  <div
                    key={`${id}-${index}`}
                    className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border transition-colors ${
                      isCurrent
                        ? 'bg-[#5E6AD2]/20 border-[#5E6AD2]/50'
                        : 'bg-white/[0.02] border-transparent hover:bg-white/[0.05]'
                    }`}
                  >
                    <button
                      type="button"
                      disabled={!item || item.missing}
                      onClick={() => item && onPlayMedia(item, index)}
                      className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer disabled:opacity-45"
                    >
                      <span className="font-mono-tabular text-[11px] text-slate-400 w-5 shrink-0">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-medium text-slate-100 truncate">
                            {item ? item.name : `Missing Reference (${id})`}
                          </p>
                          {item?.missing && (
                            <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                          <span>{item?.format || 'UNKNOWN'}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono-tabular">
                            {item ? formatDuration(item.durationSec) : '--:--'}
                          </span>
                        </div>
                      </div>
                    </button>

                    {item && !isCurrent && !item.missing && (
                      <button
                        type="button"
                        onClick={() => onQueueNext(item.id)}
                        title="Queue Next"
                        className="px-1.5 py-1 rounded text-[10px] bg-white/[0.04] hover:bg-white/[0.12] text-slate-300 shrink-0 cursor-pointer"
                      >
                        Next
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>
      </aside>
    </div>
  );
};
