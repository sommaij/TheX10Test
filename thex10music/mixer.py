"""มิกซ์เสียงร้อง + ดนตรี และ "ปรับคีย์" ให้เข้ากัน.

หน้าที่หลัก:
    * ปรับคีย์ (transpose) เสียงร้องหรือดนตรีให้ตรงกัน
    * จัดความยาวสองแทร็กให้เท่ากัน
    * ปรับระดับเสียง (balance), ใส่ reverb เบา ๆ ให้เสียงร้อง
    * รวมเป็นแทร็กเดียว + ลิมิตเตอร์กันคลิป
"""

from __future__ import annotations

import numpy as np


def pitch_shift(audio: np.ndarray, sr: int, semitones: float) -> np.ndarray:
    """เลื่อนระดับเสียงเป็นจำนวน semitone (บวก=สูงขึ้น) โดยคงความยาวเดิม."""
    if abs(semitones) < 1e-6:
        return audio.astype(np.float32)
    import librosa

    return librosa.effects.pitch_shift(
        y=audio.astype(np.float32), sr=sr, n_steps=semitones
    ).astype(np.float32)


def _simple_reverb(audio: np.ndarray, sr: int, amount: float = 0.18) -> np.ndarray:
    """reverb แบบ feedback-delay สั้น ๆ ให้เสียงร้องมีมิติ."""
    if amount <= 0:
        return audio
    out = audio.astype(np.float32).copy()
    for delay_ms, gain in ((37, 0.5), (61, 0.35), (89, 0.22)):
        d = int(sr * delay_ms / 1000)
        if d < len(out):
            echo = np.zeros_like(out)
            echo[d:] = out[:-d] * gain
            out += echo * amount
    peak = float(np.max(np.abs(out))) or 1.0
    return (out / peak * float(np.max(np.abs(audio)) or 1.0)).astype(np.float32)


def _match_length(a: np.ndarray, b: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    n = max(len(a), len(b))
    a2 = np.zeros(n, dtype=np.float32)
    b2 = np.zeros(n, dtype=np.float32)
    a2[: len(a)] = a
    b2[: len(b)] = b
    return a2, b2


def _limiter(audio: np.ndarray, ceiling: float = 0.97) -> np.ndarray:
    peak = float(np.max(np.abs(audio))) or 1.0
    if peak > ceiling:
        audio = audio / peak * ceiling
    return audio.astype(np.float32)


def mix(
    vocal: np.ndarray,
    music: np.ndarray,
    sr: int,
    vocal_gain: float = 1.0,
    music_gain: float = 0.7,
    vocal_semitones: float = 0.0,
    reverb: float = 0.18,
) -> np.ndarray:
    """มิกซ์เสียงร้องกับดนตรีเป็นแทร็กเดียว.

    Args:
        vocal_semitones: จำนวน semitone ที่ต้องการเลื่อนเสียงร้อง (สำหรับ
            ปรับคีย์เสียงร้องให้ตรงกับดนตรี หรือย้ายคีย์ทั้งเพลง).
    """
    if vocal.ndim > 1:
        vocal = vocal.mean(axis=1)
    if music.ndim > 1:
        music = music.mean(axis=1)

    vocal = pitch_shift(vocal, sr, vocal_semitones)
    vocal = _simple_reverb(vocal, sr, amount=reverb)

    vocal, music = _match_length(vocal, music)
    bus = vocal * vocal_gain + music * music_gain
    return _limiter(bus)
