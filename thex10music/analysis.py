"""วิเคราะห์เสียงร้องเปล่า: คีย์, จังหวะ (BPM), ช่วงเสียง (register), และความยาว.

ผลลัพธ์คือ ``VocalAnalysis`` ซึ่งเป็น "พิมพ์เขียว" ให้ขั้นตอนเรียบเรียงดนตรี
สร้างเครื่องดนตรีที่ *เข้ากับเสียงร้อง* ได้อย่างแม่นยำ.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np

from .theory import Key, pc_to_note_name

# โปรไฟล์ Krumhansl-Schmuckler สำหรับตรวจจับคีย์
_KS_MAJOR = np.array(
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
)
_KS_MINOR = np.array(
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
)


@dataclass
class VocalAnalysis:
    """สรุปคุณสมบัติของเสียงร้องที่ตรวจจับได้."""

    sample_rate: int
    duration: float          # วินาที
    key: Key                 # คีย์ที่ตรวจจับได้
    tempo: float             # BPM
    median_pitch_hz: float   # ระดับเสียงกลางของเสียงร้อง
    voiced_ratio: float      # สัดส่วนช่วงที่มีการร้องจริง (0-1)
    key_confidence: float    # ความมั่นใจในการตรวจจับคีย์ (0-1)

    def summary(self) -> str:
        return (
            f"คีย์: {self.key.name} (มั่นใจ {self.key_confidence:.0%}) | "
            f"จังหวะ: {self.tempo:.1f} BPM | "
            f"เสียงกลาง: {self.median_pitch_hz:.0f} Hz "
            f"({_hz_to_note_name(self.median_pitch_hz)}) | "
            f"ความยาว: {self.duration:.1f} วิ | ร้องจริง {self.voiced_ratio:.0%}"
        )


def _hz_to_note_name(hz: float) -> str:
    if hz <= 0:
        return "-"
    midi = int(round(69 + 12 * np.log2(hz / 440.0)))
    return f"{pc_to_note_name(midi % 12)}{midi // 12 - 1}"


def _detect_key(chroma: np.ndarray) -> tuple[Key, float]:
    """ตรวจจับคีย์จาก chroma เฉลี่ย ด้วย Krumhansl-Schmuckler correlation."""
    profile = chroma.mean(axis=1)
    if profile.sum() > 0:
        profile = profile / profile.sum()

    best_score = -np.inf
    best_key = Key(0, "major")
    for tonic in range(12):
        for mode, ks in (("major", _KS_MAJOR), ("minor", _KS_MINOR)):
            rotated = np.roll(ks, tonic)
            # correlation coefficient ระหว่างโปรไฟล์กับ chroma
            score = float(np.corrcoef(rotated, profile)[0, 1])
            if score > best_score:
                best_score = score
                best_key = Key(tonic_pc=tonic, mode=mode)
    confidence = max(0.0, min(1.0, (best_score + 1) / 2))
    return best_key, confidence


def analyze_vocal(audio: np.ndarray, sample_rate: int) -> VocalAnalysis:
    """วิเคราะห์สัญญาณเสียงร้อง (mono, float32) แล้วคืน ``VocalAnalysis``."""
    import librosa

    if audio.ndim > 1:
        audio = librosa.to_mono(audio)
    audio = audio.astype(np.float32)
    duration = len(audio) / sample_rate

    # --- คีย์: ใช้ chroma จาก CQT (ทนต่อ timbre ของเสียงร้อง) ---
    chroma = librosa.feature.chroma_cqt(y=audio, sr=sample_rate)
    key, key_conf = _detect_key(chroma)

    # --- จังหวะ (BPM) ---
    tempo, _ = librosa.beat.beat_track(y=audio, sr=sample_rate)
    tempo = float(np.atleast_1d(tempo)[0])
    if not np.isfinite(tempo) or tempo <= 0:
        tempo = 100.0

    # --- ระดับเสียง (pitch) ด้วย pYIN ---
    f0, voiced_flag, _ = librosa.pyin(
        audio,
        fmin=float(librosa.note_to_hz("C2")),
        fmax=float(librosa.note_to_hz("C6")),
        sr=sample_rate,
    )
    voiced = f0[np.isfinite(f0)]
    median_pitch = float(np.median(voiced)) if voiced.size else 220.0
    voiced_ratio = (
        float(np.mean(voiced_flag)) if voiced_flag is not None and voiced_flag.size else 0.0
    )

    return VocalAnalysis(
        sample_rate=sample_rate,
        duration=duration,
        key=key,
        tempo=tempo,
        median_pitch_hz=median_pitch,
        voiced_ratio=voiced_ratio,
        key_confidence=key_conf,
    )
