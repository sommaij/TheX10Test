"""TheX10 Music — สร้างดนตรีประกอบจากเสียงร้องเปล่า (a cappella) ด้วย AI/DSP.

Pipeline ภาพรวม:
    เสียงร้องเปล่า  ->  วิเคราะห์ (คีย์/จังหวะ/เมโลดี้)  ->  เรียบเรียงคอร์ด+เครื่องดนตรี
                    ->  สังเคราะห์เสียงดนตรี  ->  มิกซ์ + ปรับคีย์  ->  ไฟล์เพลงสมบูรณ์
"""

from .analysis import VocalAnalysis, analyze_vocal
from .pipeline import PipelineConfig, generate_song

__all__ = [
    "VocalAnalysis",
    "analyze_vocal",
    "PipelineConfig",
    "generate_song",
]

__version__ = "0.1.0"
