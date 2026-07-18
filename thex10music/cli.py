"""คอมมานด์ไลน์: สร้างเพลงจากเสียงร้องเปล่าในคำสั่งเดียว.

ตัวอย่าง:
    python -m thex10music my_vocal.wav -o outputs --style lofi --seventh
    python -m thex10music my_vocal.wav --target-key "G major"
"""

from __future__ import annotations

import argparse
import sys

from .pipeline import PipelineConfig, generate_song


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="thex10music",
        description="สร้างดนตรีประกอบจากเสียงร้องเปล่า (a cappella) แล้วมิกซ์ให้อัตโนมัติ",
    )
    p.add_argument("vocal", help="ไฟล์เสียงร้องเปล่า (wav/mp3/flac)")
    p.add_argument("-o", "--output-dir", default="outputs", help="โฟลเดอร์ผลลัพธ์")
    p.add_argument(
        "--style",
        default="pop",
        choices=["pop", "ballad", "sad", "cycle", "lofi"],
        help="สไตล์คอร์ดโปรเกรสชัน",
    )
    p.add_argument("--seventh", action="store_true", help="ใช้คอร์ด 7 (นุ่ม/แจ๊สขึ้น)")
    p.add_argument(
        "--intensity",
        default="full",
        choices=["full", "minimal", "drums_off"],
        help="ความแน่นของการเรียบเรียง",
    )
    p.add_argument("--music-gain", type=float, default=0.7, help="ระดับดนตรี (0-1)")
    p.add_argument("--vocal-gain", type=float, default=1.0, help="ระดับเสียงร้อง (0-1)")
    p.add_argument("--reverb", type=float, default=0.18, help="ปริมาณ reverb เสียงร้อง")
    p.add_argument(
        "--target-key",
        default=None,
        help='ย้ายคีย์ทั้งเพลง เช่น "G major" หรือ "A minor"',
    )
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    config = PipelineConfig(
        style=args.style,
        seventh=args.seventh,
        intensity=args.intensity,
        music_gain=args.music_gain,
        vocal_gain=args.vocal_gain,
        reverb=args.reverb,
        target_key=args.target_key,
    )
    try:
        result = generate_song(args.vocal, args.output_dir, config)
    except FileNotFoundError:
        print(f"ไม่พบไฟล์เสียงร้อง: {args.vocal}", file=sys.stderr)
        return 1
    print(result.report())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
