from __future__ import annotations

from dataclasses import dataclass


@dataclass
class FadeCurve:
    start_vol: int
    end_vol: int
    duration_sec: float

    def volume_at(self, elapsed_sec: float) -> int:
        if self.duration_sec <= 0:
            return max(0, min(100, int(self.end_vol)))
        progress = max(0.0, min(1.0, elapsed_sec / self.duration_sec))
        val = self.start_vol + (self.end_vol - self.start_vol) * progress
        return max(0, min(100, int(round(val))))

    def progress_at(self, elapsed_sec: float) -> float:
        if self.duration_sec <= 0:
            return 1.0
        return max(0.0, min(1.0, elapsed_sec / self.duration_sec))
