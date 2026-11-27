import React, { useEffect, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { DEFAULT_SETTINGS } from '../services/storage';
import { ProjectorSyncState } from '../types/media';
import { ProjectorStage } from './ProjectorStage';

const INITIAL_PROJECTOR_STATE: ProjectorSyncState = {
  active: true,
  mediaId: null,
  mediaName: '',
  mediaKind: null,
  mediaUrl: null,
  thumbnailUrl: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  playbackRate: 1,
  blackScreen: false,
  freezeFrame: false,
  freezeFrameDataUrl: null,
  subtitleText: '',
  showSubtitles: true,
  preserveAspectRatio: true,
  logo: DEFAULT_SETTINGS.logo,
  countdownRemainingSec: 300,
  countdownRunning: false,
  countdownVisibleOnProjector: false,
  countdownLabel: 'Ibadah Segera Dimulai',
  updatedAt: Date.now(),
};

export const ProjectorWindowApp: React.FC = () => {
  const [stageState, setStageState] = useState<ProjectorSyncState>(() => {
    try {
      const saved = localStorage.getItem('gendev_projector_snapshot');
      if (saved) return JSON.parse(saved) as ProjectorSyncState;
    } catch {
      // ignore
    }
    return INITIAL_PROJECTOR_STATE;
  });
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  useEffect(() => {
    document.title = 'GENDEV Projector Output (Monitor 2)';

    const channel = new BroadcastChannel('gendev_projector_v1');
    channel.onmessage = (ev: MessageEvent) => {
      if (ev.data?.type === 'SYNC_STATE' && ev.data.payload) {
        setStageState(ev.data.payload as ProjectorSyncState);
      } else if (ev.data?.type === 'EXIT_PROJECTOR') {
        window.close();
      }
    };

    // Request immediate state sync from Operator Console
    channel.postMessage({ type: 'PROJECTOR_READY' });

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'gendev_projector_snapshot' && e.newValue) {
        try {
          setStageState(JSON.parse(e.newValue) as ProjectorSyncState);
        } catch {
          // ignore
        }
      }
    };

    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    window.addEventListener('storage', onStorage);
    document.addEventListener('fullscreenchange', onFsChange);

    return () => {
      channel.postMessage({ type: 'PROJECTOR_CLOSED' });
      channel.close();
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('fullscreenchange', onFsChange);
    };
  }, []);

  const enterFullscreen = async () => {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // ignore if user agent restricts
    }
  };

  return (
    <div
      className="relative w-screen h-screen bg-black overflow-hidden cursor-none"
      style={{ cursor: isFullscreen ? 'none' : 'pointer' }}
      onDoubleClick={enterFullscreen}
    >
      <ProjectorStage state={stageState} muted={true} />

      {!isFullscreen && (
        <button
          type="button"
          onClick={enterFullscreen}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 px-5 py-2.5 rounded-lg bg-[#161C2C]/90 hover:bg-[#5E6AD2] text-white text-sm font-medium border border-white/15 shadow-2xl transition-colors cursor-pointer"
        >
          <Maximize2 className="w-4 h-4" />
          <span>Click or Double-Click for Fullscreen Projector (Monitor 2)</span>
        </button>
      )}
    </div>
  );
};
