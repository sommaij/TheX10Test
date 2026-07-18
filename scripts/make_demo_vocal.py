"""สร้างไฟล์ "เสียงร้องเปล่า" จำลอง เพื่อทดสอบ pipeline โดยไม่ต้องมีไมค์.

รันได้: python scripts/make_demo_vocal.py outputs/demo_vocal.wav
มันจะร้องเมโลดี้สั้น ๆ ในคีย์ C major ด้วยเสียงคล้ายมนุษย์ (ฟอร์แมนต์ + vibrato).
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import soundfile as sf

SR = 44100


def note(midi: int, dur: float) -> np.ndarray:
    f = 440.0 * 2 ** ((midi - 69) / 12)
    t = np.arange(int(dur * SR)) / SR
    vibrato = 1 + 0.006 * np.sin(2 * np.pi * 5.5 * t)
    phase = 2 * np.pi * f * np.cumsum(vibrato) / SR
    # ฮาร์มอนิกเลียนเสียงร้อง (มีฟอร์แมนต์คร่าว ๆ)
    sig = (
        1.0 * np.sin(phase)
        + 0.5 * np.sin(2 * phase)
        + 0.3 * np.sin(3 * phase)
        + 0.15 * np.sin(4 * phase)
    )
    env = np.minimum(1, np.minimum(t / 0.03, (dur - t) / 0.05))
    env = np.clip(env, 0, 1)
    return (sig * env).astype(np.float32)


def main() -> int:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "outputs/demo_vocal.wav")
    out.parent.mkdir(parents=True, exist_ok=True)

    # เมโลดี้ใน C major: C D E G E D C ... (MIDI)
    melody = [60, 62, 64, 67, 64, 62, 60, 64, 65, 64, 62, 60]
    durs = [0.4, 0.4, 0.4, 0.8, 0.4, 0.4, 0.8, 0.4, 0.4, 0.4, 0.4, 0.8]
    parts = [note(m, d) for m, d in zip(melody, durs)]
    audio = np.concatenate(parts)
    audio = audio / (np.max(np.abs(audio)) or 1.0) * 0.85

    sf.write(str(out), audio, SR)
    print(f"เขียนเสียงร้องจำลอง -> {out}  ({len(audio)/SR:.1f} วินาที)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
