"""ทฤษฎีดนตรีพื้นฐาน: สเกล, คอร์ดไดอะโทนิก, การสร้างคอร์ดโปรเกรสชัน.

โมดูลนี้แปลง "คีย์" (เช่น C major, A minor) ให้กลายเป็นชุดคอร์ดที่ใช้เรียบเรียง
ดนตรีประกอบได้จริง โดยอ้างอิงเลข MIDI (C4 = 60).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List

# ชื่อโน้ต 12 ตัวใน 1 ออกเทฟ (ใช้ sharp เป็นหลัก)
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# สูตรระยะขั้น (semitone) ของสเกล
MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11]
MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10]  # natural minor

# คุณภาพคอร์ดของแต่ละขั้นในสเกล (diatonic triads)
MAJOR_QUALITIES = ["maj", "min", "min", "maj", "maj", "min", "dim"]
MINOR_QUALITIES = ["min", "dim", "maj", "min", "min", "maj", "maj"]

# โครงสร้าง interval ของแต่ละชนิดคอร์ด (จาก root)
CHORD_INTERVALS = {
    "maj": [0, 4, 7],
    "min": [0, 3, 7],
    "dim": [0, 3, 6],
    "maj7": [0, 4, 7, 11],
    "min7": [0, 3, 7, 10],
    "dom7": [0, 4, 7, 10],
}

# โปรเกรสชันยอดนิยม อ้างอิงเป็น "ขั้นของสเกล" (0-based: 0=I, 4=V ...)
POPULAR_PROGRESSIONS = {
    "pop": [0, 4, 5, 3],       # I – V – vi – IV (เพลงป๊อปคลาสสิก)
    "ballad": [0, 5, 3, 4],    # I – vi – IV – V (50s / บัลลาด)
    "sad": [5, 3, 0, 4],       # vi – IV – I – V
    "cycle": [0, 3, 4, 0],     # I – IV – V – I
    "lofi": [0, 3, 5, 4],      # I – IV – vi – V
}


def note_name_to_pc(name: str) -> int:
    """แปลงชื่อโน้ต (เช่น 'C', 'F#', 'Bb') เป็น pitch class 0-11."""
    name = name.strip()
    flats = {"Db": 1, "Eb": 3, "Gb": 6, "Ab": 8, "Bb": 10}
    if name in flats:
        return flats[name]
    return NOTE_NAMES.index(name)


def pc_to_note_name(pc: int) -> str:
    return NOTE_NAMES[pc % 12]


@dataclass
class Chord:
    """คอร์ดหนึ่งตัวพร้อมข้อมูลที่จำเป็นต่อการเรียบเรียง."""

    root_pc: int          # pitch class ของ root (0-11)
    quality: str          # 'maj' / 'min' / 'dim' / ...
    degree: int           # ขั้นในสเกล (0-based) ใช้แสดงผล
    symbol: str           # ชื่อคอร์ดสำหรับแสดง เช่น 'Cmaj', 'Amin'

    def midi_notes(self, octave: int = 4) -> List[int]:
        """คืนเลข MIDI ของโน้ตในคอร์ด โดยวาง root ที่ออกเทฟที่กำหนด."""
        root_midi = 12 * (octave + 1) + self.root_pc  # MIDI: C-1 = 0
        return [root_midi + iv for iv in CHORD_INTERVALS[self.quality]]

    def bass_note(self, octave: int = 2) -> int:
        return 12 * (octave + 1) + self.root_pc


@dataclass
class Key:
    """คีย์ของเพลง = tonic + โหมด."""

    tonic_pc: int
    mode: str  # 'major' หรือ 'minor'

    @property
    def name(self) -> str:
        return f"{pc_to_note_name(self.tonic_pc)} {self.mode}"

    def scale_pcs(self) -> List[int]:
        steps = MAJOR_STEPS if self.mode == "major" else MINOR_STEPS
        return [(self.tonic_pc + s) % 12 for s in steps]

    def diatonic_chord(self, degree: int, seventh: bool = False) -> Chord:
        """สร้างคอร์ดไดอะโทนิกที่ขั้น degree (0-based)."""
        steps = MAJOR_STEPS if self.mode == "major" else MINOR_STEPS
        quals = MAJOR_QUALITIES if self.mode == "major" else MINOR_QUALITIES
        degree = degree % 7
        root_pc = (self.tonic_pc + steps[degree]) % 12
        quality = quals[degree]
        if seventh:
            seventh_map = {"maj": "maj7", "min": "min7", "dim": "min7"}
            # ขั้น V ในเมเจอร์มักใช้ dominant7
            if self.mode == "major" and degree == 4:
                quality = "dom7"
            else:
                quality = seventh_map.get(quality, quality)
        symbol = f"{pc_to_note_name(root_pc)}{quality}"
        return Chord(root_pc=root_pc, quality=quality, degree=degree, symbol=symbol)


def build_progression(key: Key, style: str = "pop", seventh: bool = False) -> List[Chord]:
    """สร้างชุดคอร์ด 4 ตัวจากคีย์และสไตล์ที่เลือก."""
    degrees = POPULAR_PROGRESSIONS.get(style, POPULAR_PROGRESSIONS["pop"])
    return [key.diatonic_chord(d, seventh=seventh) for d in degrees]
