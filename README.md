# TheX10 Music 🎤➜🎶

สร้าง **ดนตรีประกอบจากเสียงร้องเปล่า (a cappella)** ด้วย AI/DSP — ใส่เสียงร้องที่มีแค่การร้องเข้าไป
ระบบจะ *วิเคราะห์คีย์และจังหวะ* แล้ว *generate ดนตรีที่เข้ากับเสียง* จากนั้น *มิกซ์และปรับคีย์*
ให้ออกมาเป็นเพลงสมบูรณ์โดยอัตโนมัติ

> ตรงตามโจทย์: เอาเสียงร้องเปล่า → ให้ AI สร้างดนตรีที่เข้ากัน → มิกซ์และปรับคีย์ให้เข้ากับดนตรี

---

## ภาพรวมการทำงาน (Pipeline)

```
 เสียงร้องเปล่า (.wav)
        │
        ▼
 ① วิเคราะห์เสียงร้อง        analysis.py
     • ตรวจจับคีย์ (Krumhansl-Schmuckler จาก chroma)
     • ตรวจจับจังหวะ BPM (beat tracking)
     • ตรวจช่วงเสียง/register (pYIN)
        │
        ▼
 ② เรียบเรียงดนตรี           theory.py + arranger.py
     • เลือกคอร์ดโปรเกรสชันในคีย์ที่เจอ (I–V–vi–IV ฯลฯ)
     • วางแพด / เบส / พลัค / กลอง ให้ตรง BPM และไม่ตีกับเมโลดี้
        │
        ▼
 ③ สังเคราะห์เสียงดนตรี      synth.py
     • ซินธ์ pure-NumPy (ไม่ต้องใช้ soundfont) เรนเดอร์เป็นสัญญาณเสียง
        │
        ▼
 ④ มิกซ์ + ปรับคีย์          mixer.py
     • เลื่อนคีย์เสียงร้อง (pitch-shift) ให้ตรงกับดนตรี/คีย์เป้าหมาย
     • ปรับบาลานซ์เสียงร้อง-ดนตรี, ใส่ reverb, ลิมิตเตอร์กันคลิป
        │
        ▼
 เพลงสมบูรณ์ (final_mix.wav) + ดนตรีล้วน (music_only.wav)
```

## ติดตั้ง

```bash
pip install -r requirements.txt
```

## ใช้งานอย่างเร็ว

```bash
# 1) (ทางเลือก) สร้างเสียงร้องจำลองไว้ทดสอบ
python scripts/make_demo_vocal.py outputs/demo_vocal.wav

# 2) สร้างเพลงจากเสียงร้อง
python -m thex10music outputs/demo_vocal.wav -o outputs --style lofi --seventh
```

ผลลัพธ์:
```
🎤 วิเคราะห์เสียงร้อง:
   คีย์: C major (มั่นใจ 92%) | จังหวะ: 100.0 BPM | เสียงกลาง: 295 Hz (D4) | ...
🎹 คอร์ดที่เรียบเรียง:
   Cmaj7 | Fmaj7 | Amin7 | Gdom7
💾 เพลงมิกซ์สมบูรณ์: outputs/final_mix.wav
```

### ใช้เสียงร้องจริงของคุณ

อัดเสียงร้องเปล่า ๆ (ไม่มีดนตรี) เป็นไฟล์ `.wav`/`.mp3` แล้ว:
```bash
python -m thex10music my_vocal.wav -o outputs --style ballad
```

## ตัวเลือก (options)

| ตัวเลือก | ความหมาย |
|---|---|
| `--style` | สไตล์คอร์ด: `pop` / `ballad` / `sad` / `cycle` / `lofi` |
| `--seventh` | ใช้คอร์ด 7 (นุ่ม/แจ๊สขึ้น) |
| `--intensity` | ความแน่น: `full` / `minimal` / `drums_off` |
| `--target-key` | **ปรับคีย์ทั้งเพลง** เช่น `"G major"` — ระบบจะย้ายคอร์ดและเลื่อนคีย์เสียงร้องให้ตาม |
| `--music-gain` / `--vocal-gain` | บาลานซ์ระดับดนตรี / เสียงร้อง |
| `--reverb` | ปริมาณ reverb ของเสียงร้อง |

## ใช้เป็นไลบรารี (Python API)

```python
from thex10music import generate_song, PipelineConfig

result = generate_song(
    "my_vocal.wav",
    output_dir="outputs",
    config=PipelineConfig(style="lofi", seventh=True, target_key="A minor"),
)
print(result.report())
print("คอร์ด:", result.arrangement.chord_sheet())
```

## โครงสร้างโค้ด

| ไฟล์ | หน้าที่ |
|---|---|
| `thex10music/analysis.py` | วิเคราะห์คีย์ / จังหวะ / ช่วงเสียงจากเสียงร้อง |
| `thex10music/theory.py` | สเกล, คอร์ดไดอะโทนิก, คอร์ดโปรเกรสชัน |
| `thex10music/arranger.py` | แปลงผลวิเคราะห์เป็น "โน้ตอีเวนต์" ของแต่ละเครื่อง |
| `thex10music/synth.py` | ซินธ์ NumPy เรนเดอร์โน้ตเป็นเสียง |
| `thex10music/mixer.py` | ปรับคีย์เสียงร้อง + มิกซ์ + เอฟเฟกต์ |
| `thex10music/pipeline.py` | ต่อทุกขั้นตอนเข้าด้วยกัน |
| `thex10music/cli.py` | คำสั่ง command line |

## หมายเหตุเรื่อง "AI generate"

เวอร์ชันนี้ใช้เครื่องยนต์เรียบเรียงเชิงทฤษฎีดนตรี + ซินธ์ในตัว เพื่อให้ **รันได้ทันทีทุกเครื่อง**
โดยไม่ต้องดาวน์โหลดโมเดลหนัก ๆ จุดต่อขยายถูกออกแบบไว้แล้ว: ฟังก์ชัน `render_arrangement()`
ใน `synth.py` สามารถสลับไปเรียกโมเดล generate ดนตรี (เช่น MusicGen / Stable Audio) ได้
โดยไม่กระทบขั้นตอนวิเคราะห์และมิกซ์ ดูรายละเอียดใน [`docs/DESIGN.md`](docs/DESIGN.md)
