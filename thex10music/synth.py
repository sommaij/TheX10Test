"""ซินธิไซเซอร์ในตัว (pure NumPy) — เรนเดอร์ ``Note`` เป็นสัญญาณเสียง.

ออกแบบให้ *ไม่ต้องพึ่ง soundfont หรือโมเดลภายนอก* จึงรันได้ทันทีทุกเครื่อง.
สามารถสลับไปใช้ backend เป็นโมเดล generate ดนตรี (เช่น MusicGen) ได้ผ่าน
อินเทอร์เฟซ ``render_arrangement`` โดยไม่กระทบส่วนอื่นของ pipeline.
"""

from __future__ import annotations

from typing import List

import numpy as np

from .arranger import Arrangement, Note


def midi_to_hz(midi: int) -> float:
    return 440.0 * (2.0 ** ((midi - 69) / 12.0))


def _adsr(n: int, sr: int, a=0.01, d=0.1, s=0.7, r=0.2) -> np.ndarray:
    """สร้างเอนเวโลป ADSR ความยาว n แซมเปิล."""
    env = np.zeros(n, dtype=np.float32)
    ai = max(1, int(a * sr))
    di = max(1, int(d * sr))
    ri = max(1, int(r * sr))
    si = max(0, n - ai - di - ri)
    idx = 0
    env[idx : idx + ai] = np.linspace(0, 1, ai, endpoint=False)
    idx += ai
    env[idx : idx + di] = np.linspace(1, s, di, endpoint=False)
    idx += di
    if si > 0:
        env[idx : idx + si] = s
        idx += si
    end = min(n, idx + ri)
    env[idx:end] = np.linspace(s, 0, end - idx, endpoint=False)
    return env


def _render_tonal(note: Note, sr: int) -> np.ndarray:
    """เรนเดอร์เครื่องดนตรีมีระดับเสียง (pad/bass/pluck)."""
    n = max(1, int(note.duration * sr))
    t = np.arange(n) / sr
    f = midi_to_hz(note.pitch)

    if note.instrument == "pad":
        # ซอว์จูนเพี้ยนเล็กน้อยหลายตัว -> อบอุ่น กว้าง
        wave = np.zeros(n, dtype=np.float32)
        for detune in (-0.15, 0.0, 0.15):
            ff = f * (2 ** (detune / 12))
            phase = 2 * np.pi * ff * t
            saw = 2 * (phase / (2 * np.pi) % 1.0) - 1.0
            wave += saw.astype(np.float32)
        wave /= 3.0
        env = _adsr(n, sr, a=0.15, d=0.2, s=0.8, r=0.4)
    elif note.instrument == "bass":
        wave = np.sign(np.sin(2 * np.pi * f * t)) * 0.3 + np.sin(2 * np.pi * f * t)
        wave = wave.astype(np.float32)
        env = _adsr(n, sr, a=0.005, d=0.08, s=0.75, r=0.1)
    else:  # pluck
        wave = np.sin(2 * np.pi * f * t) + 0.4 * np.sin(2 * np.pi * 2 * f * t)
        wave = wave.astype(np.float32)
        env = _adsr(n, sr, a=0.002, d=0.15, s=0.25, r=0.15)

    return wave * env * note.velocity


def _render_drum(note: Note, sr: int) -> np.ndarray:
    """สังเคราะห์เสียงกลองแบบง่าย."""
    n = max(1, int(note.duration * sr))
    t = np.arange(n) / sr

    if note.instrument == "kick":
        # ความถี่กวาดลง + เอนเวโลปสั้น
        f = 120 * np.exp(-t * 30) + 45
        wave = np.sin(2 * np.pi * np.cumsum(f) / sr)
        env = np.exp(-t * 18)
    elif note.instrument == "snare":
        noise = np.random.uniform(-1, 1, n)
        tone = np.sin(2 * np.pi * 180 * t)
        wave = 0.7 * noise + 0.3 * tone
        env = np.exp(-t * 22)
    else:  # hat
        noise = np.random.uniform(-1, 1, n)
        # ไฮพาส แบบง่าย: หักลบค่าเฉลี่ยเคลื่อนที่
        wave = noise - np.convolve(noise, np.ones(8) / 8, mode="same")
        env = np.exp(-t * 60)

    return (wave * env * note.velocity).astype(np.float32)


def render_arrangement(arr: Arrangement, sr: int = 44100) -> np.ndarray:
    """รวมทุกโน้ตในการเรียบเรียงเป็นสัญญาณเสียง mono ตัวเดียว."""
    total_n = int((arr.total_duration + 1.0) * sr)
    buf = np.zeros(total_n, dtype=np.float32)

    for note in arr.notes:
        if note.instrument in ("kick", "snare", "hat"):
            sig = _render_drum(note, sr)
        else:
            sig = _render_tonal(note, sr)
        start = int(note.start * sr)
        end = min(total_n, start + len(sig))
        if end > start:
            buf[start:end] += sig[: end - start]

    # normalize กันคลิป
    peak = float(np.max(np.abs(buf))) or 1.0
    return (buf / peak * 0.9).astype(np.float32)
