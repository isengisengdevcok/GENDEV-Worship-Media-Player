/**
 * Real Web Audio API DSP Engine for GENDEV Worship Media Player.
 * Drives genuine GainNode ramps for Fade Out, Fade In, Auto-Fade at End,
 * Crossfade, Master Volume, Mute, and Background Music Auto-Ducking.
 */

interface ConnectedChannel {
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  analyser: AnalyserNode;
}

class GendevAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private channels = new WeakMap<HTMLMediaElement, ConnectedChannel>();
  private activeFadeTimer: number | null = null;
  private bgmFadeTimer: number | null = null;
  private meterBuffer = new Uint8Array(64);

  public ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.limiter = this.ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -3;
      this.limiter.knee.value = 12;
      this.limiter.ratio.value = 6;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.15;

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 1;

      this.masterGain.connect(this.limiter);
      this.limiter.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  public attachElement(el: HTMLMediaElement, initialGain = 1): ConnectedChannel | null {
    try {
      const ctx = this.ensureContext();
      const existing = this.channels.get(el);
      if (existing) {
        return existing;
      }
      const source = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;

      gain.gain.setValueAtTime(Math.max(0, Math.min(1, initialGain)), ctx.currentTime);
      source.connect(gain);
      gain.connect(analyser);
      analyser.connect(this.masterGain!);

      const ch: ConnectedChannel = { source, gain, analyser };
      this.channels.set(el, ch);
      return ch;
    } catch {
      return null;
    }
  }

  public setElementGainImmediate(el: HTMLMediaElement | null, gainValue: number): void {
    if (!el) return;
    const clamped = Math.max(0, Math.min(1, gainValue));
    const ch = this.channels.get(el);
    if (ch && this.ctx) {
      const now = this.ctx.currentTime;
      ch.gain.gain.cancelScheduledValues(now);
      ch.gain.gain.setValueAtTime(clamped, now);
    } else {
      el.volume = clamped;
    }
  }

  public setMasterGain(volume01: number, muted: boolean): void {
    const ctx = this.ensureContext();
    if (!this.masterGain) return;
    const target = muted ? 0 : Math.max(0, Math.min(1, volume01));
    const now = ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(target, now, 0.02);
  }

  /**
   * Smoothly ramps a media element's GainNode from `fromGain` to `toGain` over `durationSec`.
   * Calls `onTick(currentGain01)` via RAF so the UI slider/indicator reflects the live audio ramp.
   */
  public rampElementGain(
    el: HTMLMediaElement,
    fromGain: number,
    toGain: number,
    durationSec: number,
    options?: {
      isBgm?: boolean;
      onTick?: (currentGain: number, progress: number) => void;
      onComplete?: () => void;
    }
  ): void {
    const ctx = this.ensureContext();
    const ch = this.attachElement(el, fromGain);
    const dur = Math.max(0.1, durationSec);
    const now = ctx.currentTime;

    if (ch) {
      ch.gain.gain.cancelScheduledValues(now);
      ch.gain.gain.setValueAtTime(Math.max(0, Math.min(1, fromGain)), now);
      ch.gain.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, toGain)), now + dur);
    }

    if (options?.isBgm) {
      if (this.bgmFadeTimer !== null) cancelAnimationFrame(this.bgmFadeTimer);
    } else {
      if (this.activeFadeTimer !== null) cancelAnimationFrame(this.activeFadeTimer);
    }

    const startMs = performance.now();
    const totalMs = dur * 1000;

    const step = () => {
      const elapsed = performance.now() - startMs;
      const progress = Math.min(1, elapsed / totalMs);
      const current = fromGain + (toGain - fromGain) * progress;

      if (!ch) {
        el.volume = Math.max(0, Math.min(1, current));
      }

      options?.onTick?.(current, progress);

      if (progress < 1) {
        const raf = requestAnimationFrame(step);
        if (options?.isBgm) this.bgmFadeTimer = raf;
        else this.activeFadeTimer = raf;
      } else {
        if (options?.isBgm) this.bgmFadeTimer = null;
        else this.activeFadeTimer = null;
        options?.onComplete?.();
      }
    };

    const raf = requestAnimationFrame(step);
    if (options?.isBgm) this.bgmFadeTimer = raf;
    else this.activeFadeTimer = raf;
  }

  public cancelMainFade(): void {
    if (this.activeFadeTimer !== null) {
      cancelAnimationFrame(this.activeFadeTimer);
      this.activeFadeTimer = null;
    }
  }

  public getLiveLevel(el: HTMLMediaElement | null): number {
    if (!el) return 0;
    const ch = this.channels.get(el);
    if (!ch) return el.paused ? 0 : 0.25;
    ch.analyser.getByteTimeDomainData(this.meterBuffer);
    let sumSq = 0;
    for (let i = 0; i < this.meterBuffer.length; i++) {
      const normalized = (this.meterBuffer[i] - 128) / 128;
      sumSq += normalized * normalized;
    }
    const rms = Math.sqrt(sumSq / this.meterBuffer.length);
    return Math.min(1, rms * 2.8);
  }

  public async setAudioOutputDevice(
    elements: Array<HTMLMediaElement | null>,
    deviceId: string
  ): Promise<boolean> {
    if (!deviceId || deviceId === 'default') return true;
    try {
      for (const el of elements) {
        if (!el) continue;
        const sinkEl = el as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };
        if (typeof sinkEl.setSinkId === 'function') {
          await sinkEl.setSinkId(deviceId);
        }
      }
      return true;
    } catch {
      return false;
    }
  }
}

export const audioEngine = new GendevAudioEngine();
