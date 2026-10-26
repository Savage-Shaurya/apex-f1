"""Static WOFF instances of the committed brand faces for share images.

Share images are drawn by next/og (Satori), which reads TTF, OTF and WOFF but
not WOFF2 and cannot drive variable axes. This pins each face at the one
instance the cards use, from the committed ../../../app/fonts/*.woff2 (OFL,
same coverage), and writes WOFF next to this script:

  uv run --with fonttools --with brotli python lib/og/fonts/make-og-fonts.py
"""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

HERE = Path(__file__).resolve().parent
SRC = HERE.parent.parent.parent / "app" / "fonts"
JOBS = [
    ("anybody-wdth-wght.woff2", "anybody-display.woff", {"wdth": 122, "wght": 780}),
    ("hanken-grotesk-var.woff2", "hanken-grotesk-500.woff", {"wght": 500}),
    ("hanken-grotesk-var.woff2", "hanken-grotesk-700.woff", {"wght": 700}),
    ("jetbrains-mono-500.woff2", "jetbrains-mono-500.woff", None),
]

for src, out, pin in JOBS:
    font = TTFont(SRC / src)
    if pin:
        font = instancer.instantiateVariableFont(font, pin, updateFontNames=False)
    font.flavor = "woff"
    font.save(HERE / out)
    print(out, (HERE / out).stat().st_size // 1024, "KB")
