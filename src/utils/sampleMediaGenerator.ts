import { MediaItem, SubtitleCue } from '../types/media';

export const BUILTIN_SANCTUARY_IMG = '/src/assets/images/worship_motion_still_1795760653092.jpg';
export const BUILTIN_SUNRISE_IMG = '/src/assets/images/easter_sunrise_still_1795760652771.jpg';
export const BUILTIN_CHURCH_LOGO = '/src/assets/images/church_watermark_logo_1795760653647.jpg';

const blobCache = new Map<string, string>();

/**
 * Generates a real playable 16-bit PCM WAV Blob URL with warm worship harmonic chords.
 */
export function generateWorshipWavUrl(
  preset: 'pad-c' | 'piano-g' | 'strings-f',
  durationSec = 18
): string {
  const cacheKey = `wav_${preset}_${durationSec}`;
  const existing = blobCache.get(cacheKey);
  if (existing) return existing;

  const sampleRate = 22050;
  const numSamples = Math.floor(sampleRate * durationSec);
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true);  // PCM format
  view.setUint16(22, 1, true);  // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  // Frequencies for lush worship voicings (root + 5th + major 9th + octave)
  const chordMap: Record<typeof preset, number[]> = {
    'pad-c': [130.81, 196.0, 261.63, 293.66, 329.63], // C2, G2, C3, D3, E3 (Cadd9)
    'piano-g': [196.0, 293.66, 392.0, 440.0, 493.88],  // G3, D4, G4, A4, B4 (Gadd9)
    'strings-f': [174.61, 261.63, 349.23, 440.0, 523.25], // F3, C4, F4, A4, C5 (Fmaj7)
  };

  const freqs = chordMap[preset];
  const fadeInSamples = Math.floor(sampleRate * 1.2);
  const fadeOutSamples = Math.floor(sampleRate * 1.5);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let sample = 0;

    for (let fIdx = 0; fIdx < freqs.length; fIdx++) {
      const f = freqs[fIdx];
      const slowDetune = 1 + Math.sin(t * (0.3 + fIdx * 0.11)) * 0.0022;
      const harmonic =
        Math.sin(2 * Math.PI * f * slowDetune * t) * 0.55 +
        Math.sin(2 * Math.PI * f * 2 * t) * 0.14;

      if (preset === 'piano-g') {
        // Gentle arpeggiated piano shimmer every 3 seconds
        const pulsePhase = (t + fIdx * 0.45) % 3.0;
        const pulseEnv = Math.exp(-pulsePhase * 1.35) * 0.8 + 0.2;
        sample += harmonic * pulseEnv;
      } else {
        // Slow breathing swell for pads & strings
        const swell = 0.72 + 0.28 * Math.sin(2 * Math.PI * 0.12 * t + fIdx);
        sample += harmonic * swell;
      }
    }

    sample /= freqs.length;

    // Smooth boundary envelope
    let env = 1.0;
    if (i < fadeInSamples) env = i / fadeInSamples;
    else if (i > numSamples - fadeOutSamples) env = (numSamples - i) / fadeOutSamples;

    const clamped = Math.max(-0.92, Math.min(0.92, sample * env * 0.75));
    view.setInt16(44 + i * 2, Math.floor(clamped * 32767), true);
  }

  const blob = new Blob([buffer], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  blobCache.set(cacheKey, url);
  return url;
}

/**
 * Generates a real playable WebM video Blob from a generated high-res backdrop
 * with gentle atmospheric light sweep so video transport, freeze-frame, and projector sync work immediately.
 */
export async function generateWorshipWebmUrl(
  imageSrc: string,
  title: string,
  durationSec = 10
): Promise<string | null> {
  const cacheKey = `webm_${imageSrc}_${durationSec}`;
  const existing = blobCache.get(cacheKey);
  if (existing) return existing;

  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) {
    return null;
  }

  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
      ? 'video/webm;codecs=vp8'
      : MediaRecorder.isTypeSupported('video/webm')
        ? 'video/webm'
        : '';

  if (!mimeType) return null;

  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = imageSrc;
    });

    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const stream = canvas.captureStream(24);
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 1_800_000,
    });

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    const completed = new Promise<string>((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        blobCache.set(cacheKey, url);
        resolve(url);
      };
    });

    recorder.start(250);
    const startMs = performance.now();
    const totalMs = durationSec * 1000;

    await new Promise<void>((resolveFrameLoop) => {
      const renderFrame = () => {
        const elapsed = performance.now() - startMs;
        const progress = Math.min(1, elapsed / totalMs);

        // Subtle Ken Burns zoom & atmospheric glow sweep
        const scale = 1.0 + progress * 0.045;
        const w = canvas.width * scale;
        const h = canvas.height * scale;
        const dx = (canvas.width - w) / 2;
        const dy = (canvas.height - h) / 2;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, dx, dy, w, h);

        // Soft moving light sweep
        const beamX = canvas.width * (0.2 + 0.6 * Math.sin(progress * Math.PI));
        const grad = ctx.createRadialGradient(beamX, 180, 20, beamX, 240, 420);
        grad.addColorStop(0, 'rgba(139, 92, 246, 0.18)');
        grad.addColorStop(1, 'rgba(10, 13, 20, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Bottom subtle scrim for clean projection readability
        const scrim = ctx.createLinearGradient(0, canvas.height - 160, 0, canvas.height);
        scrim.addColorStop(0, 'rgba(0,0,0,0)');
        scrim.addColorStop(1, 'rgba(5,7,12,0.55)');
        ctx.fillStyle = scrim;
        ctx.fillRect(0, canvas.height - 160, canvas.width, 160);

        if (elapsed < totalMs) {
          requestAnimationFrame(renderFrame);
        } else {
          recorder.stop();
          resolveFrameLoop();
        }
      };
      requestAnimationFrame(renderFrame);
    });

    // Silence title lint
    void title;
    return await completed;
  } catch {
    return null;
  }
}

export const SAMPLE_WORSHIP_CUES: SubtitleCue[] = [
  { startSec: 0.5, endSec: 4.5, text: 'Selamat datang di Ibadah Minggu\nMarilah kita persiapkan hati untuk menyembah Tuhan' },
  { startSec: 4.8, endSec: 9.5, text: 'Mazmur 100:4 — Masuklah melalui pintu gerbang-Nya dengan nyanyian syukur' },
];

export function createBuiltinLibraryItems(): MediaItem[] {
  const now = Date.now();
  return [
    {
      id: 'builtin-sanctuary-loop',
      name: 'Sanctuary Light Beams (Worship Loop)',
      kind: 'video',
      format: 'WEBM',
      sizeBytes: 2_180_000,
      durationSec: 10,
      resolution: '1280x720',
      folderId: 'folder-builtin',
      folderName: 'GENDEV Built-In Sanctuary Pack',
      relativePath: 'Built-In/Sanctuary Light Beams.webm',
      absolutePath: 'GENDEV://MediaLibrary/Sanctuary_Light_Beams.webm',
      sourceType: 'builtin',
      thumbnailUrl: BUILTIN_SANCTUARY_IMG,
      url: BUILTIN_SANCTUARY_IMG,
      subtitleCues: SAMPLE_WORSHIP_CUES,
      subtitleName: 'welcome_ibadah.srt',
      builtinPreset: 'sanctuary-video',
      addedAt: now - 5000,
    },
    {
      id: 'builtin-easter-sunrise',
      name: 'Dawn Over Still Water (Liturgical Backdrop)',
      kind: 'video',
      format: 'WEBM',
      sizeBytes: 1_940_000,
      durationSec: 10,
      resolution: '1280x720',
      folderId: 'folder-builtin',
      folderName: 'GENDEV Built-In Sanctuary Pack',
      relativePath: 'Built-In/Dawn Over Still Water.webm',
      absolutePath: 'GENDEV://MediaLibrary/Dawn_Over_Still_Water.webm',
      sourceType: 'builtin',
      thumbnailUrl: BUILTIN_SUNRISE_IMG,
      url: BUILTIN_SUNRISE_IMG,
      builtinPreset: 'sunrise-video',
      addedAt: now - 4000,
    },
    {
      id: 'builtin-pad-c',
      name: 'Grace Ambient Pad — C Major (Pre-Service)',
      kind: 'audio',
      format: 'WAV',
      sizeBytes: 793_844,
      durationSec: 18,
      folderId: 'folder-builtin',
      folderName: 'GENDEV Built-In Sanctuary Pack',
      relativePath: 'Built-In/Audio/Grace Ambient Pad C.wav',
      absolutePath: 'GENDEV://MediaLibrary/Audio/Grace_Ambient_Pad_C.wav',
      sourceType: 'builtin',
      url: generateWorshipWavUrl('pad-c', 18),
      builtinPreset: 'pad-c',
      addedAt: now - 3000,
    },
    {
      id: 'builtin-piano-g',
      name: 'Sanctuary Prayer Piano — G Major',
      kind: 'audio',
      format: 'WAV',
      sizeBytes: 793_844,
      durationSec: 18,
      folderId: 'folder-builtin',
      folderName: 'GENDEV Built-In Sanctuary Pack',
      relativePath: 'Built-In/Audio/Sanctuary Prayer Piano G.wav',
      absolutePath: 'GENDEV://MediaLibrary/Audio/Sanctuary_Prayer_Piano_G.wav',
      sourceType: 'builtin',
      url: generateWorshipWavUrl('piano-g', 18),
      builtinPreset: 'piano-g',
      addedAt: now - 2000,
    },
    {
      id: 'builtin-strings-f',
      name: 'Benediction Warm Strings — F Major',
      kind: 'audio',
      format: 'WAV',
      sizeBytes: 793_844,
      durationSec: 18,
      folderId: 'folder-builtin',
      folderName: 'GENDEV Built-In Sanctuary Pack',
      relativePath: 'Built-In/Audio/Benediction Warm Strings F.wav',
      absolutePath: 'GENDEV://MediaLibrary/Audio/Benediction_Warm_Strings_F.wav',
      sourceType: 'builtin',
      url: generateWorshipWavUrl('strings-f', 18),
      builtinPreset: 'strings-f',
      addedAt: now - 1000,
    },
  ];
}
