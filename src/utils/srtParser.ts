import { SubtitleCue } from '../types/media';

function parseTimestamp(raw: string): number {
  const clean = raw.trim().replace(',', '.');
  const parts = clean.split(':');
  if (parts.length === 3) {
    const h = parseFloat(parts[0]) || 0;
    const m = parseFloat(parts[1]) || 0;
    const s = parseFloat(parts[2]) || 0;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const m = parseFloat(parts[0]) || 0;
    const s = parseFloat(parts[1]) || 0;
    return m * 60 + s;
  }
  return parseFloat(clean) || 0;
}

export function parseSubtitles(content: string): SubtitleCue[] {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) return [];

  // Strip optional WEBVTT header
  const body = normalized.replace(/^WEBVTT[^\n]*\n+/i, '');
  const blocks = body.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    const timingIdx = lines.findIndex((l) => l.includes('-->'));
    if (timingIdx === -1) continue;

    const timingLine = lines[timingIdx];
    const [startRaw, endRawWithMeta] = timingLine.split('-->');
    if (!startRaw || !endRawWithMeta) continue;

    const endRaw = endRawWithMeta.trim().split(/\s+/)[0];
    const startSec = parseTimestamp(startRaw);
    const endSec = parseTimestamp(endRaw);
    const textLines = lines.slice(timingIdx + 1);
    const text = textLines
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .trim();

    if (text && endSec >= startSec) {
      cues.push({ startSec, endSec, text });
    }
  }

  return cues.sort((a, b) => a.startSec - b.startSec);
}

export function findActiveSubtitle(cues: SubtitleCue[] | undefined, timeSec: number): string {
  if (!cues || cues.length === 0) return '';
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    if (timeSec >= cue.startSec && timeSec <= cue.endSec) {
      return cue.text;
    }
  }
  return '';
}
