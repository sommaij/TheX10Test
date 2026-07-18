"""เรียบเรียงดนตรีประกอบ: แปลงผลวิเคราะห์เสียงร้อง -> รายการ "โน้ตอีเวนต์".

โน้ตอีเวนต์ (``Note``) เป็นตัวแทนกลางที่ synth นำไปสังเคราะห์เสียง โดยไม่ผูก
กับเครื่องดนตรีจริง ทำให้สลับ backend (synth ในตัว หรือโมเดล AI ภายนอก) ได้ง่าย.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

from .analysis import VocalAnalysis
from .theory import Chord, Key, build_progression


@dataclass
class Note:
    """โน้ตหนึ่งตัวที่พร้อมส่งให้ synth."""

    start: float          # เวลาเริ่ม (วินาที)
    duration: float       # ความยาว (วินาที)
    pitch: int            # เลข MIDI
    velocity: float       # ความดัง 0-1
    instrument: str       # 'pad' | 'bass' | 'pluck' | 'kick' | 'snare' | 'hat'


@dataclass
class Arrangement:
    """ผลการเรียบเรียง: รายการโน้ต + เมทาดาทาสำหรับแสดงผล."""

    notes: List[Note] = field(default_factory=list)
    chords: List[Chord] = field(default_factory=list)
    bpm: float = 100.0
    bar_seconds: float = 2.4
    total_duration: float = 0.0

    def chord_sheet(self) -> str:
        return " | ".join(c.symbol for c in self.chords)


def _register_octave_for_pads(median_pitch_hz: float) -> int:
    """เลือกออกเทฟของแพดให้อยู่ "ใต้" เสียงร้อง เพื่อไม่ตีกับเมโลดี้."""
    import numpy as np

    if median_pitch_hz <= 0:
        return 3
    vocal_midi = 69 + 12 * np.log2(median_pitch_hz / 440.0)
    vocal_octave = int(vocal_midi // 12) - 1
    # วางคอร์ดต่ำกว่าเสียงร้องประมาณ 1 ออกเทฟ แต่คุมช่วงให้สมเหตุผล
    return max(2, min(4, vocal_octave - 1))


def arrange(
    analysis: VocalAnalysis,
    style: str = "pop",
    seventh: bool = False,
    intensity: str = "full",
) -> Arrangement:
    """สร้างการเรียบเรียงจากผลวิเคราะห์เสียงร้อง.

    Args:
        analysis: ผลวิเคราะห์เสียงร้อง.
        style: สไตล์คอร์ดโปรเกรสชัน (ดู theory.POPULAR_PROGRESSIONS).
        seventh: ใส่คอร์ด 7 เพื่อความ jazzy/นุ่มขึ้น.
        intensity: 'full' (ครบเครื่อง) | 'minimal' (แพด+เบส) | 'drums_off'.
    """
    key: Key = analysis.key
    bpm = analysis.tempo
    beat = 60.0 / bpm
    bar = beat * 4                      # สมมติ 4/4
    chords = build_progression(key, style=style, seventh=seventh)

    pad_octave = _register_octave_for_pads(analysis.median_pitch_hz)
    notes: List[Note] = []

    # เรียงคอร์ดวนซ้ำให้ครอบคลุมความยาวเสียงร้อง (+ หางไว้เล็กน้อย)
    total = max(analysis.duration, bar)
    n_bars = int(total / bar) + 1

    for bar_idx in range(n_bars):
        t0 = bar_idx * bar
        chord = chords[bar_idx % len(chords)]

        # 1) แพดคอร์ด (ค้างทั้งห้อง)
        for p in chord.midi_notes(octave=pad_octave):
            notes.append(Note(t0, bar, p, 0.32, "pad"))

        # 2) เบส (root ต้นห้อง + ย้ำครึ่งห้อง)
        bass = chord.bass_note(octave=2)
        notes.append(Note(t0, beat * 2, bass, 0.6, "bass"))
        notes.append(Note(t0 + beat * 2, beat * 2, bass, 0.5, "bass"))

        if intensity == "minimal":
            continue

        # 3) พลัค/อาร์เพจจิโอ ตามจังหวะเขบ็ต
        arp = chord.midi_notes(octave=pad_octave + 1)
        for i in range(4):
            p = arp[i % len(arp)]
            notes.append(Note(t0 + i * beat, beat * 0.9, p, 0.28, "pluck"))

        if intensity == "drums_off":
            continue

        # 4) กลอง: kick ที่ 1&3, snare ที่ 2&4, hihat ทุกครึ่งเขบ็ต
        notes.append(Note(t0, 0.15, 36, 0.9, "kick"))
        notes.append(Note(t0 + beat * 2, 0.15, 36, 0.85, "kick"))
        notes.append(Note(t0 + beat, 0.15, 38, 0.7, "snare"))
        notes.append(Note(t0 + beat * 3, 0.15, 38, 0.7, "snare"))
        for i in range(8):
            notes.append(Note(t0 + i * (beat / 2), 0.05, 42, 0.35, "hat"))

    return Arrangement(
        notes=notes,
        chords=chords,
        bpm=bpm,
        bar_seconds=bar,
        total_duration=n_bars * bar,
    )
