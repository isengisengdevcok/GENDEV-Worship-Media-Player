import React, { useEffect, useState } from 'react';
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

/**
 * Pure zero-UI Dual Display Projector Output (Monitor 2).
 * Never renders operator controls, playlists, or floating buttons over the video.
 * Double-click anywhere on the stage to toggle OS fullscreen.
 */
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

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) {
        channel.postMessage({ type: 'PROJECTOR_CLOSED' });
        window.close();
        // If browser blocks closing a non-scripted tab, navigate cleanly back to Operator Console
        window.setTimeout(() => {
          if (!window.closed) {
            window.location.href = window.location.pathname;
          }
        }, 120);
      }
    };

    const onBeforeUnload = () => {
      channel.postMessage({ type: 'PROJECTOR_CLOSED' });
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('fullscreenchange', onFsChange);

    return () => {
      channel.postMessage({ type: 'PROJECTOR_CLOSED' });
      channel.close();
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('fullscreenchange', onFsChange);
    };
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // ignore if user agent restricts without gesture
    }
  };

  return (
    <div
      className="relative w-screen h-screen bg-black overflow-hidden"
      style={{ cursor: isFullscreen ? 'none' : 'default' }}
      onDoubleClick={toggleFullscreen}
      title="Double-click for Fullscreen · Press ESC to return"
    >
      <ProjectorStage state={stageState} muted={true} />
    </div>
  );
};
