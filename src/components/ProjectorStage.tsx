import React, { useEffect, useRef } from 'react';
import { ProjectorSyncState } from '../types/media';
import { formatDuration } from '../utils/formatters';

interface ProjectorStageProps {
  state: ProjectorSyncState;
  isPreview?: boolean;
  muted?: boolean;
}

export const ProjectorStage: React.FC<ProjectorStageProps> = ({
  state,
  isPreview = false,
  muted = true,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const freezeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [videoError, setVideoError] = React.useState(false);

  useEffect(() => {
    setVideoError(false);
  }, [state.mediaUrl, state.mediaId]);

  const isVideoFile =
    state.mediaKind === 'video' &&
    Boolean(state.mediaUrl) &&
    !videoError &&
    !state.mediaUrl?.endsWith('.jpg') &&
    !state.mediaUrl?.endsWith('.png');

  // Sync video source & playback state when rendering the secondary projector window
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isVideoFile || !state.mediaUrl) return;

    if (video.getAttribute('data-src') !== state.mediaUrl) {
      video.setAttribute('data-src', state.mediaUrl);
      video.src = state.mediaUrl;
    }

    video.playbackRate = state.playbackRate || 1;
    video.muted = muted;

    // Keep projector video time aligned with operator deck
    if (Number.isFinite(state.currentTime) && Math.abs(video.currentTime - state.currentTime) > 0.28) {
      try {
        video.currentTime = state.currentTime;
      } catch {
        // Ignore seek before metadata ready
      }
    }

    if (state.isPlaying && !state.freezeFrame) {
      if (video.paused) {
        void video.play().catch(() => {});
      }
    } else if (!video.paused) {
      video.pause();
    }
  }, [
    isVideoFile,
    muted,
    state.currentTime,
    state.freezeFrame,
    state.isPlaying,
    state.mediaUrl,
    state.playbackRate,
  ]);

  // Capture local video frame onto freeze canvas if freezeFrameDataUrl wasn't already supplied
  useEffect(() => {
    if (!state.freezeFrame || state.freezeFrameDataUrl) return;
    const video = videoRef.current;
    const canvas = freezeCanvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    }
  }, [state.freezeFrame, state.freezeFrameDataUrl]);

  const logoPosClass: Record<string, string> = {
    'top-left': 'top-5 left-5',
    'top-right': 'top-5 right-5',
    'bottom-left': 'bottom-5 left-5',
    'bottom-right': 'bottom-5 right-5',
  };

  const fitClass = state.preserveAspectRatio ? 'object-contain' : 'object-cover';

  return (
    <div className="relative w-full h-full bg-black overflow-hidden select-none">
      {/* Media Layer */}
      {isVideoFile && state.mediaUrl ? (
        <video
          ref={videoRef}
          className={`w-full h-full ${fitClass}`}
          playsInline
          muted={muted}
          preload="auto"
          onError={() => setVideoError(true)}
        />
      ) : state.thumbnailUrl ? (
        <img
          src={state.thumbnailUrl}
          alt={state.mediaName || 'Worship Stage'}
          referrerPolicy="no-referrer"
          className={`w-full h-full ${fitClass}`}
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center bg-[#05070C]">
          {state.mediaKind === 'audio' && state.mediaName ? (
            <div className="text-center px-6">
              <p className="text-xs uppercase tracking-[0.22em] text-indigo-400/80 mb-2">
                Audio Playback
              </p>
              <p className="font-display text-lg md:text-2xl font-semibold text-white/90">
                {state.mediaName}
              </p>
            </div>
          ) : (
            <div className="text-center px-6">
              <p className="font-display text-sm tracking-[0.25em] uppercase text-white/25">
                GENDEV STAGE READY
              </p>
            </div>
          )}
        </div>
      )}

      {/* Freeze Frame Overlay */}
      {state.freezeFrame && (
        <div className="absolute inset-0 z-10 bg-black">
          {state.freezeFrameDataUrl ? (
            <img
              src={state.freezeFrameDataUrl}
              alt="Frozen Frame"
              className={`w-full h-full ${fitClass}`}
            />
          ) : (
            <canvas ref={freezeCanvasRef} className={`w-full h-full ${fitClass}`} />
          )}
        </div>
      )}

      {/* Subtitle Overlay */}
      {state.showSubtitles && state.subtitleText && !state.blackScreen && (
        <div
          className={`absolute inset-x-0 z-20 flex justify-center px-6 pointer-events-none ${
            isPreview ? 'bottom-4' : 'bottom-12'
          }`}
        >
          <div className="max-w-4xl bg-black/75 backdrop-blur-sm px-5 py-2.5 rounded-lg border border-white/10 text-center shadow-lg">
            <p
              className={`font-display font-semibold text-white leading-snug whitespace-pre-line ${
                isPreview ? 'text-xs md:text-sm' : 'text-xl md:text-3xl'
              }`}
            >
              {state.subtitleText}
            </p>
          </div>
        </div>
      )}

      {/* Countdown Timer Overlay */}
      {state.countdownVisibleOnProjector && !state.blackScreen && (
        <div className="absolute inset-0 z-25 flex items-center justify-center bg-black/45 backdrop-blur-[2px] pointer-events-none">
          <div className="text-center px-8 py-6 rounded-2xl bg-black/65 border border-white/15">
            <p
              className={`font-display font-medium text-indigo-200/90 tracking-wide mb-2 ${
                isPreview ? 'text-xs' : 'text-lg md:text-2xl'
              }`}
            >
              {state.countdownLabel || 'Ibadah Segera Dimulai'}
            </p>
            <div
              className={`font-mono-tabular font-bold text-white tracking-tight ${
                isPreview ? 'text-3xl' : 'text-6xl md:text-8xl'
              }`}
            >
              {formatDuration(state.countdownRemainingSec)}
            </div>
          </div>
        </div>
      )}

      {/* Church Logo Watermark */}
      {state.logo.visible && state.logo.imageUrl && !state.blackScreen && (
        <div
          className={`absolute z-30 pointer-events-none ${
            logoPosClass[state.logo.position] || 'bottom-5 right-5'
          }`}
          style={{ opacity: state.logo.opacity }}
        >
          <img
            src={state.logo.imageUrl}
            alt="Church Watermark"
            referrerPolicy="no-referrer"
            style={{
              width: isPreview ? Math.max(24, state.logo.sizePx * 0.45) : state.logo.sizePx,
              height: isPreview ? Math.max(24, state.logo.sizePx * 0.45) : state.logo.sizePx,
            }}
            className="object-contain rounded-md"
          />
        </div>
      )}

      {/* Black Screen Curtain */}
      <div
        className="absolute inset-0 z-40 bg-black pointer-events-none transition-opacity"
        style={{
          opacity: state.blackScreen ? 1 : 0,
          transitionDuration: '400ms',
        }}
      />
    </div>
  );
};
