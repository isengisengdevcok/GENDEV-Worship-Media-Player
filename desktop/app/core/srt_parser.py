from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class SubtitleCue:
    start_sec: float
    end_sec: float
    text: str


def _parse_ts(raw: str) -> float:
    clean = raw.strip().replace(",", ".")
    parts = clean.split(":")
    if len(parts) == 3:
        return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
    if len(parts) == 2:
        return float(parts[0]) * 60 + float(parts[1])
    return float(clean)


def parse_srt(content: str) -> list[SubtitleCue]:
    normalized = content.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        return []
    blocks = re.split(r"\n{2,}", normalized)
    cues: list[SubtitleCue] = []
    for block in blocks:
        lines = [ln.strip() for ln in block.split("\n") if ln.strip()]
        timing_idx = next((i for i, ln in enumerate(lines) if "-->" in ln), -1)
        if timing_idx == -1:
            continue
        start_raw, end_raw = lines[timing_idx].split("-->", 1)
        start_sec = _parse_ts(start_raw)
        end_sec = _parse_ts(end_raw.split()[0])
        text = re.sub(r"<[^>]+>", "", "\n".join(lines[timing_idx + 1 :])).strip()
        if text and end_sec >= start_sec:
            cues.append(SubtitleCue(start_sec=start_sec, end_sec=end_sec, text=text))
    return sorted(cues, key=lambda c: c.start_sec)
