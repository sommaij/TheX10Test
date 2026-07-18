"""เทสต์แกนทฤษฎีดนตรี (ไม่พึ่ง numpy/librosa) — รันเร็ว ใช้ตรวจ CI ได้.

รัน: python -m pytest tests/  หรือ  python tests/test_theory.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from thex10music.theory import (  # noqa: E402
    Key,
    build_progression,
    note_name_to_pc,
    pc_to_note_name,
)


def test_note_name_roundtrip():
    for pc in range(12):
        assert note_name_to_pc(pc_to_note_name(pc)) == pc


def test_flats_map_correctly():
    assert note_name_to_pc("Bb") == 10
    assert note_name_to_pc("Eb") == 3


def test_c_major_scale():
    key = Key(tonic_pc=0, mode="major")
    assert key.scale_pcs() == [0, 2, 4, 5, 7, 9, 11]
    assert key.name == "C major"


def test_a_minor_diatonic_chords():
    key = Key(tonic_pc=9, mode="minor")  # A minor
    prog = build_progression(key, style="pop")
    # I–V–vi–IV ของ A minor = Amin, Emin, Fmaj, Dmin
    assert [c.symbol for c in prog] == ["Amin", "Emin", "Fmaj", "Dmin"]


def test_seventh_dominant_on_five_in_major():
    key = Key(tonic_pc=0, mode="major")  # C major
    five = key.diatonic_chord(4, seventh=True)  # G
    assert five.quality == "dom7"
    assert five.symbol == "Gdom7"


def test_chord_midi_notes_c_major():
    key = Key(tonic_pc=0, mode="major")
    c = key.diatonic_chord(0)  # C major triad
    assert c.midi_notes(octave=4) == [60, 64, 67]  # C4 E4 G4


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print(f"ok - {fn.__name__}")
    print(f"\nผ่านทั้งหมด {len(fns)} เทสต์")
