"""ท่อประกอบ (pipeline) หลัก: เสียงร้องเปล่า -> เพลงสมบูรณ์.

    วิเคราะห์  ->  เรียบเรียง  ->  สังเคราะห์ดนตรี  ->  มิกซ์ + ปรับคีย์  ->  เขียนไฟล์
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np
import soundfile as sf

from .analysis import VocalAnalysis, analyze_vocal
from .arranger import Arrangement, arrange
from .mixer import mix
from .synth import render_arrangement
from .theory import Key, note_name_to_pc


@dataclass
class PipelineConfig:
    """พารามิเตอร์ควบคุมการสร้างเพลง."""

    style: str = "pop"            # สไตล์คอร์ด: pop/ballad/sad/cycle/lofi
    seventh: bool = False         # ใช้คอร์ด 7
    intensity: str = "full"       # full/minimal/drums_off
    music_gain: float = 0.7       # ระดับดนตรีเทียบเสียงร้อง
    vocal_gain: float = 1.0
    reverb: float = 0.18
    target_key: Optional[str] = None  # เช่น "G major" -> ย้ายคีย์ทั้งเพลง
    sample_rate: int = 44100


@dataclass
class SongResult:
    """ผลลัพธ์การสร้างเพลง."""

    analysis: VocalAnalysis
    arrangement: Arrangement
    mixed_path: Path
    music_path: Path
    applied_semitones: float

    def report(self) -> str:
        lines = [
            "🎤 วิเคราะห์เสียงร้อง:",
            "   " + self.analysis.summary(),
            "🎹 คอร์ดที่เรียบเรียง:",
            "   " + self.arrangement.chord_sheet(),
            f"🎚️  ปรับคีย์เสียงร้อง: {self.applied_semitones:+.0f} semitone",
            f"💾 ดนตรีอย่างเดียว : {self.music_path}",
            f"💾 เพลงมิกซ์สมบูรณ์: {self.mixed_path}",
        ]
        return "\n".join(lines)


def _parse_target_key(text: str) -> Key:
    parts = text.strip().split()
    tonic = note_name_to_pc(parts[0])
    mode = parts[1].lower() if len(parts) > 1 else "major"
    if mode not in ("major", "minor"):
        mode = "major"
    return Key(tonic_pc=tonic, mode=mode)


def _load_audio(path: str | Path, target_sr: int) -> tuple[np.ndarray, int]:
    import librosa

    audio, sr = librosa.load(str(path), sr=target_sr, mono=True)
    return audio.astype(np.float32), sr


def generate_song(
    vocal_path: str | Path,
    output_dir: str | Path = "outputs",
    config: Optional[PipelineConfig] = None,
) -> SongResult:
    """สร้างเพลงจากไฟล์เสียงร้องเปล่า.

    Returns:
        ``SongResult`` พร้อม path ของไฟล์ดนตรีและไฟล์มิกซ์.
    """
    config = config or PipelineConfig()
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    # 1) โหลด + วิเคราะห์
    vocal, sr = _load_audio(vocal_path, config.sample_rate)
    analysis = analyze_vocal(vocal, sr)

    # 2) ตัดสินใจเรื่องคีย์: ถ้าระบุ target_key ให้ย้ายคีย์ทั้งเพลง
    applied_semitones = 0.0
    if config.target_key:
        target = _parse_target_key(config.target_key)
        applied_semitones = float((target.tonic_pc - analysis.key.tonic_pc + 6) % 12 - 6)
        # เรียบเรียงดนตรีในคีย์เป้าหมาย, แล้วเลื่อนเสียงร้องให้ตาม
        analysis.key = target

    # 3) เรียบเรียง + สังเคราะห์ดนตรี
    arrangement = arrange(
        analysis,
        style=config.style,
        seventh=config.seventh,
        intensity=config.intensity,
    )
    music = render_arrangement(arrangement, sr=sr)

    # 4) มิกซ์ + ปรับคีย์เสียงร้อง
    mixed = mix(
        vocal,
        music,
        sr,
        vocal_gain=config.vocal_gain,
        music_gain=config.music_gain,
        vocal_semitones=applied_semitones,
        reverb=config.reverb,
    )

    # 5) เขียนไฟล์
    music_path = out / "music_only.wav"
    mixed_path = out / "final_mix.wav"
    sf.write(str(music_path), music, sr)
    sf.write(str(mixed_path), mixed, sr)

    return SongResult(
        analysis=analysis,
        arrangement=arrangement,
        mixed_path=mixed_path,
        music_path=music_path,
        applied_semitones=applied_semitones,
    )
