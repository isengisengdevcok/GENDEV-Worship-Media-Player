import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Download,
  FolderCog,
  Keyboard,
  Monitor,
  Music,
  RotateCcw,
  Sliders,
  Sparkles,
  Upload,
  Volume2,
} from 'lucide-react';
import { isTauriRuntime, tauriListDisplays } from '../services/tauriBridge';
import { AppSettings, LogoPosition, Playlist, ShortcutMap } from '../types/media';
import { BUILTIN_CHURCH_LOGO } from '../utils/sampleMediaGenerator';

interface DetectedScreen {
  id: string;
  label: string;
  isPrimary: boolean;
  width: number;
  height: number;
}

interface SettingsViewProps {
  settings: AppSettings;
  playlists: Playlist[];
  onUpdateSettings: (updater: (prev: AppSettings) => AppSettings) => void;
  onExportBackup: () => void;
  onImportBackup: (file: File) => Promise<boolean>;
  onResetDefaults: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  playlists,
  onUpdateSettings,
  onExportBackup,
  onImportBackup,
  onResetDefaults,
}) => {
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [screens, setScreens] = useState<DetectedScreen[]>([]);
  const [recordingKey, setRecordingKey] = useState<keyof ShortcutMap | null>(null);
  const [backupMessage, setBackupMessage] = useState<string>('');
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const loadDevices = async () => {
      try {
        if (navigator.mediaDevices?.enumerateDevices) {
          const list = await navigator.mediaDevices.enumerateDevices();
          setAudioOutputs(list.filter((d) => d.kind === 'audiooutput'));
        }
      } catch {
        // ignore if restricted
      }
    };
    void loadDevices();
  }, []);

  const detectDisplays = async () => {
    if (isTauriRuntime()) {
      try {
        const tauriScreens = await tauriListDisplays();
        if (tauriScreens.length > 0) {
          setScreens(
            tauriScreens.map((s) => ({
              id: s.id,
              label: s.label,
              isPrimary: s.isPrimary,
              width: s.width,
              height: s.height,
            }))
          );
          return;
        }
      } catch {
        // Fallback to browser detection
      }
    }

    try {
      const win = window as unknown as {
        getScreenDetails?: () => Promise<{
          screens: Array<{
            label?: string;
            isPrimary?: boolean;
            width: number;
            height: number;
          }>;
        }>;
      };
      if (typeof win.getScreenDetails === 'function') {
        const details = await win.getScreenDetails();
        setScreens(
          details.screens.map((s, idx) => ({
            id: idx === 0 ? 'primary' : `screen-${idx}`,
            label: s.label || `Display ${idx + 1}`,
            isPrimary: Boolean(s.isPrimary),
            width: s.width,
            height: s.height,
          }))
        );
        return;
      }
    } catch {
      // Fallback to basic screen detection
    }

    const isExtended = Boolean(
      (window.screen as Screen & { isExtended?: boolean }).isExtended
    );
    setScreens([
      {
        id: 'primary',
        label: 'Primary Operator Display',
        isPrimary: true,
        width: window.screen.width,
        height: window.screen.height,
      },
      ...(isExtended
        ? [
            {
              id: 'secondary',
              label: 'External Projector Display (Extended)',
              isPrimary: false,
              width: 1920,
              height: 1080,
            },
          ]
        : []),
    ]);
  };

  useEffect(() => {
    void detectDisplays();
  }, []);

  useEffect(() => {
    if (!recordingKey) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const code = e.code;
      onUpdateSettings((prev) => ({
        ...prev,
        shortcuts: {
          ...prev.shortcuts,
          [recordingKey]: code,
        },
      }));
      setRecordingKey(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [recordingKey, onUpdateSettings]);

  const handleLogoUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onUpdateSettings((prev) => ({
          ...prev,
          logo: { ...prev.logo, imageUrl: reader.result as string, visible: true },
        }));
      }
    };
    reader.readAsDataURL(file);
  };

  const shortcutLabels: Array<{ key: keyof ShortcutMap; label: string }> = [
    { key: 'playPause', label: 'Play / Pause' },
    { key: 'stop', label: 'Stop Playback' },
    { key: 'next', label: 'Next Item' },
    { key: 'previous', label: 'Previous Item' },
    { key: 'fadeOut', label: 'Smart Fade Out' },
    { key: 'fadeIn', label: 'Smart Fade In' },
    { key: 'blackScreen', label: 'Toggle Black Screen' },
    { key: 'freezeFrame', label: 'Toggle Freeze Frame' },
    { key: 'mute', label: 'Mute / Unmute' },
    { key: 'projectorToggle', label: 'Send / Exit Projector' },
  ];

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-6 pb-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-xl font-bold text-white">
              Application Settings & Build Configuration
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Configure audio fade curves, dual display projector routing, church branding,
              shortcuts, and backups.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={backupInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const ok = await onImportBackup(file);
                  setBackupMessage(
                    ok ? 'Configuration restored successfully.' : 'Invalid backup JSON file.'
                  );
                  window.setTimeout(() => setBackupMessage(''), 3500);
                }
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={onExportBackup}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-slate-100 text-xs font-medium border border-white/[0.08] cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Backup Config</span>
            </button>
            <button
              type="button"
              onClick={() => backupInputRef.current?.click()}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-slate-100 text-xs font-medium border border-white/[0.08] cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Restore Config</span>
            </button>
            <button
              type="button"
              onClick={onResetDefaults}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white/[0.04] hover:bg-rose-500/20 text-slate-300 hover:text-rose-200 text-xs font-medium border border-white/[0.08] cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          </div>
        </div>

        {backupMessage && (
          <div className="px-4 py-2.5 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-xs text-indigo-200 flex items-center gap-2">
            <Check className="w-4 h-4 text-indigo-300" />
            <span>{backupMessage}</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* 1. Smart Fade Out / Fade In & Crossfade */}
          <section className="bg-[#111622] border border-white/[0.08] rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <Sliders className="w-4 h-4 text-indigo-400" />
              <h2 className="font-display text-sm font-semibold text-white">
                Smart Fade Out / Fade In & Crossfade
              </h2>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Fade Out Duration</label>
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
                  className="w-full px-3 py-2 rounded-lg bg-[#0A0D14] border border-white/[0.09] text-xs text-white"
                >
                  {[1, 2, 3, 5, 10, 15].map((sec) => (
                    <option key={sec} value={sec}>
                      {sec} seconds
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Fade In Duration</label>
                <select
                  value={settings.fade.fadeInDurationSec}
                  onChange={(e) =>
                    onUpdateSettings((p) => ({
                      ...p,
                      fade: {
                        ...p.fade,
                        fadeInDurationSec: Number(e.target.value) as 1 | 2 | 3 | 5 | 10 | 15,
                      },
                    }))
                  }
                  className="w-full px-3 py-2 rounded-lg bg-[#0A0D14] border border-white/[0.09] text-xs text-white"
                >
                  {[1, 2, 3, 5, 10, 15].map((sec) => (
                    <option key={sec} value={sec}>
                      {sec} seconds
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5">
                  Action When Volume Reaches 0%
                </label>
                <select
                  value={settings.fade.postFadeAction}
                  onChange={(e) =>
                    onUpdateSettings((p) => ({
                      ...p,
                      fade: {
                        ...p.fade,
                        postFadeAction: e.target.value as 'pause' | 'stop',
                      },
                    }))
                  }
                  className="w-full px-3 py-2 rounded-lg bg-[#0A0D14] border border-white/[0.09] text-xs text-white"
                >
                  <option value="pause">Pause Video (Keep Frame Ready)</option>
                  <option value="stop">Stop & Reset to Start</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5">
                  Auto Fade Out Before End
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={settings.fade.autoFadeAtEndEnabled}
                    onChange={(e) =>
                      onUpdateSettings((p) => ({
                        ...p,
                        fade: { ...p.fade, autoFadeAtEndEnabled: e.target.checked },
                      }))
                    }
                    className="rounded border-white/20 bg-[#0A0D14] text-[#5E6AD2]"
                  />
                  <select
                    value={settings.fade.autoFadeAtEndSec}
                    disabled={!settings.fade.autoFadeAtEndEnabled}
                    onChange={(e) =>
                      onUpdateSettings((p) => ({
                        ...p,
                        fade: {
                          ...p.fade,
                          autoFadeAtEndSec: Number(e.target.value) as 3 | 5 | 10 | 15,
                        },
                      }))
                    }
                    className="flex-1 px-2.5 py-2 rounded-lg bg-[#0A0D14] border border-white/[0.09] text-xs text-white disabled:opacity-40"
                  >
                    {[3, 5, 10, 15].map((sec) => (
                      <option key={sec} value={sec}>
                        {sec}s before end
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-white/[0.06]">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-400">Fade In Start Vol</span>
                  <span className="font-mono-tabular text-slate-200">
                    {settings.fade.fadeStartVolume}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={50}
                  value={settings.fade.fadeStartVolume}
                  onChange={(e) =>
                    onUpdateSettings((p) => ({
                      ...p,
                      fade: { ...p.fade, fadeStartVolume: Number(e.target.value) },
                    }))
                  }
                  className="w-full studio-slider"
                />
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-400">Fade Out End Vol</span>
                  <span className="font-mono-tabular text-slate-200">
                    {settings.fade.fadeEndVolume}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={30}
                  value={settings.fade.fadeEndVolume}
                  onChange={(e) =>
                    onUpdateSettings((p) => ({
                      ...p,
                      fade: { ...p.fade, fadeEndVolume: Number(e.target.value) },
                    }))
                  }
                  className="w-full studio-slider"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-white/[0.06]">
              <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.fade.crossfadeEnabled}
                  onChange={(e) =>
                    onUpdateSettings((p) => ({
                      ...p,
                      fade: { ...p.fade, crossfadeEnabled: e.target.checked },
                    }))
                  }
                  className="rounded border-white/20 bg-[#0A0D14] text-[#5E6AD2]"
                />
                <span>Audio Crossfade on Track Switch</span>
              </label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Duration:</span>
                <select
                  value={settings.fade.crossfadeDurationSec}
                  disabled={!settings.fade.crossfadeEnabled}
                  onChange={(e) =>
                    onUpdateSettings((p) => ({
                      ...p,
                      fade: { ...p.fade, crossfadeDurationSec: Number(e.target.value) },
                    }))
                  }
                  className="px-2.5 py-1.5 rounded-lg bg-[#0A0D14] border border-white/[0.09] text-xs text-white disabled:opacity-40"
                >
                  {[1, 2, 3, 5, 8, 10].map((s) => (
                    <option key={s} value={s}>
                      {s}s
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* 2. Dual Display / Projector & Audio Device */}
          <section className="bg-[#111622] border border-white/[0.08] rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Monitor className="w-4 h-4 text-sky-400" />
                <h2 className="font-display text-sm font-semibold text-white">
                  Dual Display & Audio Output
                </h2>
              </div>
              <button
                type="button"
                onClick={detectDisplays}
                className="px-2.5 py-1 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-xs text-slate-200 cursor-pointer"
              >
                Detect Displays
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">
                  Target Projector Screen
                </label>
                <select
                  value={settings.display.selectedScreenId}
                  onChange={(e) =>
                    onUpdateSettings((p) => ({
                      ...p,
                      display: { ...p.display, selectedScreenId: e.target.value },
                    }))
                  }
                  className="w-full px-3 py-2 rounded-lg bg-[#0A0D14] border border-white/[0.09] text-xs text-white"
                >
                  <option value="secondary">Secondary Monitor / Projector (Auto-Detect)</option>
                  {screens.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label} ({s.width}x{s.height}){s.isPrimary ? ' — Primary' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5 flex items-center gap-1.5">
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>Audio Output Device (when browser supports setSinkId)</span>
                </label>
                <select
                  value={settings.audioOutputDeviceId}
                  onChange={(e) =>
                    onUpdateSettings((p) => ({
                      ...p,
                      audioOutputDeviceId: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 rounded-lg bg-[#0A0D14] border border-white/[0.09] text-xs text-white"
                >
                  <option value="default">System Default Audio Output</option>
                  {audioOutputs.map((dev, idx) => (
                    <option key={dev.deviceId || idx} value={dev.deviceId}>
                      {dev.label || `Audio Output ${idx + 1}`}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.display.preserveAspectRatio}
                    onChange={(e) =>
                      onUpdateSettings((p) => ({
                        ...p,
                        display: { ...p.display, preserveAspectRatio: e.target.checked },
                      }))
                    }
                    className="rounded border-white/20 bg-[#0A0D14]"
                  />
                  <span>Preserve Video Aspect Ratio</span>
                </label>

                <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.display.showSubtitlesOnProjector}
                    onChange={(e) =>
                      onUpdateSettings((p) => ({
                        ...p,
                        display: { ...p.display, showSubtitlesOnProjector: e.target.checked },
                      }))
                    }
                    className="rounded border-white/20 bg-[#0A0D14]"
                  />
                  <span>Show SRT Subtitles on Projector</span>
                </label>
              </div>
            </div>
          </section>

          {/* 3. Background Music Rules */}
          <section className="bg-[#111622] border border-white/[0.08] rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <Music className="w-4 h-4 text-violet-400" />
              <h2 className="font-display text-sm font-semibold text-white">
                Background Music Automation
              </h2>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">
                  Dedicated Background Music Playlist
                </label>
                <select
                  value={settings.bgm.playlistId}
                  onChange={(e) =>
                    onUpdateSettings((p) => ({
                      ...p,
                      bgm: { ...p.bgm, playlistId: e.target.value },
                    }))
                  }
                  className="w-full px-3 py-2 rounded-lg bg-[#0A0D14] border border-white/[0.09] text-xs text-white"
                >
                  {playlists.map((pl) => (
                    <option key={pl.id} value={pl.id}>
                      {pl.name} ({pl.itemIds.length} items)
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2 pt-1">
                <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.bgm.autoFadeOutOnVideoStart}
                    onChange={(e) =>
                      onUpdateSettings((p) => ({
                        ...p,
                        bgm: { ...p.bgm, autoFadeOutOnVideoStart: e.target.checked },
                      }))
                    }
                    className="rounded border-white/20 bg-[#0A0D14]"
                  />
                  <span>Auto fade out BGM when main video starts</span>
                </label>

                <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.bgm.autoFadeInOnVideoEnd}
                    onChange={(e) =>
                      onUpdateSettings((p) => ({
                        ...p,
                        bgm: { ...p.bgm, autoFadeInOnVideoEnd: e.target.checked },
                      }))
                    }
                    className="rounded border-white/20 bg-[#0A0D14]"
                  />
                  <span>Auto fade in BGM after video finishes or stops</span>
                </label>

                <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.bgm.allowSimultaneousWithVideo}
                    onChange={(e) =>
                      onUpdateSettings((p) => ({
                        ...p,
                        bgm: { ...p.bgm, allowSimultaneousWithVideo: e.target.checked },
                      }))
                    }
                    className="rounded border-white/20 bg-[#0A0D14]"
                  />
                  <span>Allow BGM and main video audio simultaneously</span>
                </label>
              </div>
            </div>
          </section>

          {/* 4. Church Watermark Logo & Theme */}
          <section className="bg-[#111622] border border-white/[0.08] rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              <h2 className="font-display text-sm font-semibold text-white">
                Church Watermark Logo & Theme
              </h2>
            </div>

            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-lg bg-black border border-white/[0.1] overflow-hidden shrink-0 flex items-center justify-center">
                {settings.logo.imageUrl ? (
                  <img
                    src={settings.logo.imageUrl}
                    alt="Church Logo"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <span className="text-[10px] text-slate-500">No Logo</span>
                )}
              </div>

              <div className="flex-1 space-y-2">
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleLogoUpload(f);
                    e.target.value = '';
                  }}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => logoInputRef.current?.click()}
                    className="px-3 py-1.5 rounded-lg bg-[#5E6AD2] hover:bg-[#4F5BC0] text-white text-xs font-medium cursor-pointer"
                  >
                    Upload Church Logo
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateSettings((p) => ({
                        ...p,
                        logo: { ...p.logo, imageUrl: BUILTIN_CHURCH_LOGO },
                      }))
                    }
                    className="px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-slate-200 text-xs cursor-pointer"
                  >
                    Use Default Emblem
                  </button>
                  <label className="flex items-center gap-1.5 text-xs text-slate-200 cursor-pointer ml-1">
                    <input
                      type="checkbox"
                      checked={settings.logo.visible}
                      onChange={(e) =>
                        onUpdateSettings((p) => ({
                          ...p,
                          logo: { ...p.logo, visible: e.target.checked },
                        }))
                      }
                      className="rounded border-white/20 bg-[#0A0D14]"
                    />
                    <span>Show Watermark</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Corner Position</label>
                <select
                  value={settings.logo.position}
                  onChange={(e) =>
                    onUpdateSettings((p) => ({
                      ...p,
                      logo: { ...p.logo, position: e.target.value as LogoPosition },
                    }))
                  }
                  className="w-full px-2.5 py-1.5 rounded-lg bg-[#0A0D14] border border-white/[0.09] text-xs text-white"
                >
                  <option value="top-left">Top Left</option>
                  <option value="top-right">Top Right</option>
                  <option value="bottom-left">Bottom Left</option>
                  <option value="bottom-right">Bottom Right</option>
                </select>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-400">Size</span>
                  <span className="font-mono-tabular text-slate-200">{settings.logo.sizePx}px</span>
                </div>
                <input
                  type="range"
                  min={32}
                  max={160}
                  value={settings.logo.sizePx}
                  onChange={(e) =>
                    onUpdateSettings((p) => ({
                      ...p,
                      logo: { ...p.logo, sizePx: Number(e.target.value) },
                    }))
                  }
                  className="w-full studio-slider mt-2"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-400">Opacity</span>
                  <span className="font-mono-tabular text-slate-200">
                    {Math.round(settings.logo.opacity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={15}
                  max={100}
                  value={Math.round(settings.logo.opacity * 100)}
                  onChange={(e) =>
                    onUpdateSettings((p) => ({
                      ...p,
                      logo: { ...p.logo, opacity: Number(e.target.value) / 100 },
                    }))
                  }
                  className="w-full studio-slider mt-2"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/[0.06]">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Accent Color</label>
                <div className="flex gap-1.5">
                  {(['indigo', 'violet', 'cobalt'] as const).map((theme) => (
                    <button
                      key={theme}
                      type="button"
                      onClick={() => onUpdateSettings((p) => ({ ...p, accentTheme: theme }))}
                      className={`flex-1 py-1.5 rounded-md text-xs font-medium capitalize cursor-pointer border ${
                        settings.accentTheme === theme
                          ? 'bg-[#5E6AD2] text-white border-[#818CF8]'
                          : 'bg-[#0A0D14] text-slate-400 border-white/[0.08]'
                      }`}
                    >
                      {theme}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">Desktop Storage Mode</label>
                <div className="flex gap-1.5">
                  {(['portable', 'installation'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => onUpdateSettings((p) => ({ ...p, mode: m }))}
                      className={`flex-1 py-1.5 rounded-md text-xs font-medium capitalize cursor-pointer border ${
                        settings.mode === m
                          ? 'bg-[#5E6AD2] text-white border-[#818CF8]'
                          : 'bg-[#0A0D14] text-slate-400 border-white/[0.08]'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* 5. Keyboard Shortcuts Customizer */}
          <section className="bg-[#111622] border border-white/[0.08] rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <Keyboard className="w-4 h-4 text-indigo-400" />
              <h2 className="font-display text-sm font-semibold text-white">
                Customizable Operator Shortcuts
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {shortcutLabels.map(({ key, label }) => {
                const isRec = recordingKey === key;
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#0A0D14] border border-white/[0.07]"
                  >
                    <span className="text-xs text-slate-300">{label}</span>
                    <button
                      type="button"
                      onClick={() => setRecordingKey(isRec ? null : key)}
                      className={`px-2.5 py-1 rounded font-mono-tabular text-[11px] font-medium cursor-pointer ${
                        isRec
                          ? 'bg-indigo-500 text-white'
                          : 'bg-white/[0.07] hover:bg-white/[0.14] text-indigo-200'
                      }`}
                    >
                      {isRec ? 'Press Key...' : settings.shortcuts[key]}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 6. Startup & Windows Desktop Build Structure */}
          <section className="bg-[#111622] border border-white/[0.08] rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <FolderCog className="w-4 h-4 text-sky-400" />
              <h2 className="font-display text-sm font-semibold text-white">
                Startup & Windows Desktop Release Kit
              </h2>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.autoScanOnStartup}
                  onChange={(e) =>
                    onUpdateSettings((p) => ({ ...p, autoScanOnStartup: e.target.checked }))
                  }
                  className="rounded border-white/20 bg-[#0A0D14]"
                />
                <span>Auto-scan configured folders on startup</span>
              </label>

              <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.restoreLastPlaylistOnStartup}
                  onChange={(e) =>
                    onUpdateSettings((p) => ({
                      ...p,
                      restoreLastPlaylistOnStartup: e.target.checked,
                    }))
                  }
                  className="rounded border-white/20 bg-[#0A0D14]"
                />
                <span>Restore last active playlist and media position on launch</span>
              </label>
            </div>

            <div className="p-3.5 rounded-lg bg-[#0A0D14] border border-white/[0.07] space-y-2 text-xs text-slate-300">
              <p className="font-semibold text-slate-100">
                Lightweight Tauri v2 (Rust + WebView2) Windows Desktop Release Kit
              </p>
              <p className="text-slate-400 leading-relaxed">
                This application compiles natively via <code className="text-indigo-300 font-mono">src-tauri/</code>{' '}
                (Tauri v2 + Rust) using Windows WebView2 so the standalone Portable &amp; Setup
                EXEs stay compact (~5–15 MB) while matching this Operator Console 1:1. Tag a
                release like <code className="text-indigo-300 font-mono">v1.0.0</code> on GitHub to
                build and publish via{' '}
                <code className="text-indigo-300 font-mono">
                  .github/workflows/windows-build-release.yml
                </code>
                .
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
