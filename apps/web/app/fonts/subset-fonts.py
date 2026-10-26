"""Rebuild the committed web fonts from the upstream google/fonts OFL masters.

Usage (fonttools + brotli; nothing is installed into the project):
  uv run --with fonttools --with brotli python subset-fonts.py <dir-with-upstream-ttfs>

Upstream files (https://github.com/google/fonts, ofl/<family>/):
  Anybody[wdth,wght].ttf, HankenGrotesk[wght].ttf, HankenGrotesk-Italic[wght].ttf,
  EBGaramond[wght].ttf, EBGaramond-Italic[wght].ttf, JetBrainsMono[wght].ttf

Coverage is Google Fonts' "latin" + "latin-ext" sets plus arrows, so driver,
circuit and publisher names with Latin Extended-A letters (l-stroke, s/z/c/r-caron,
g-breve, s-cedilla, o-double-acute, dotted I) render in the brand faces instead of
falling back to a system font. Layout features used by the design system are kept:
kerning, ligatures, case-sensitive forms, fractions and tabular/proportional figures.
"""
import sys
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

UNICODES = (
    "U+0000-024F,U+0259,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0300-0308,U+0329,"
    "U+1E00-1E9F,U+1EF2-1EFF,U+2000-206F,U+2070-209F,U+20A0-20CF,U+2113,U+2116,"
    "U+2122,U+2190-2199,U+2212,U+2215,U+FEFF,U+FFFD"
)
FEATURES = "kern,liga,clig,calt,ccmp,locl,mark,mkmk,case,frac,numr,dnom,sups,tnum,pnum,lnum,onum,ss01,ss02,ss03"

# (upstream, output, pinned axes). Accent faces are pinned to the one weight the
# design system uses, which keeps them small; the two working faces stay variable.
JOBS = [
    ("Anybody[wdth,wght].ttf", "anybody-wdth-wght.woff2", None),
    ("HankenGrotesk[wght].ttf", "hanken-grotesk-var.woff2", None),
    ("HankenGrotesk-Italic[wght].ttf", "hanken-grotesk-italic-var.woff2", None),
    ("EBGaramond[wght].ttf", "eb-garamond-400.woff2", {"wght": 400}),
    ("EBGaramond-Italic[wght].ttf", "eb-garamond-italic-400.woff2", {"wght": 400}),
    ("JetBrainsMono[wght].ttf", "jetbrains-mono-500.woff2", {"wght": 500}),
]


def main(src_dir: str) -> None:
    src = Path(src_dir)
    out = Path(__file__).resolve().parent
    for upstream, target, pin in JOBS:
        options = subset.Options()
        options.flavor = "woff2"
        options.layout_features = FEATURES.split(",")
        options.name_IDs = ["*"]
        options.name_languages = ["*"]
        options.notdef_outline = True
        options.hinting = False
        options.desubroutinize = True
        font = TTFont(src / upstream)
        if pin:
            font = instancer.instantiateVariableFont(font, pin)
        sub = subset.Subsetter(options)
        sub.populate(unicodes=subset.parse_unicodes(UNICODES))
        sub.subset(font)
        font.flavor = "woff2"
        font.save(out / target)
        print(f"{target}: {(out / target).stat().st_size // 1024} KB")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
