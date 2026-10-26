# Apex web fonts

All faces are SIL Open Font License 1.1 (licence text next to each file). They are
committed and loaded with `next/font/local`, so no build or page view depends on a
font CDN. No Formula 1 proprietary typeface is used or imitated.

| File | Role | Upstream master (google/fonts, `ofl/`) | Upstream SHA-256 |
|---|---|---|---|
| `anybody-wdth-wght.woff2` | Display (wdth 50-150, wght 100-900) | `anybody/Anybody[wdth,wght].ttf` | `b184bd7e6ca8348bbaecec98951565729d7e89b7872d4898a1f9981342b5b64c` |
| `hanken-grotesk-var.woff2` | Text and UI (wght 100-900, figures are tabular by default) | `hankengrotesk/HankenGrotesk[wght].ttf` | `813b3f8fa0965405669a89b38e51bbefd95eef6b8e20d1cb2d8c10cce062662f` |
| `hanken-grotesk-italic-var.woff2` | Real emphasis inside running text | `hankengrotesk/HankenGrotesk-Italic[wght].ttf` | `ae5731726ff75301a3cb63f2e98d1babc77d55ab09fb8e229ca75f5bd46fbe32` |
| `eb-garamond-400.woff2` | Editorial voice: article standfirst and pull quotes (wght pinned at 400) | `ebgaramond/EBGaramond[wght].ttf` | `ef9512f92f6d579e5dc75af59a5a4b1b8b47d2eda89e00b954d44520e5369027` |
| `eb-garamond-italic-400.woff2` | Titles of works inside editorial text | `ebgaramond/EBGaramond-Italic[wght].ttf` | `bba2c4499c93c9612b90b9825d32b07da52fce2fe57562a1eb6b833553f93c4e` |
| `jetbrains-mono-500.woff2` | Timing values only (lap times, gaps) and code (wght pinned at 500) | `jetbrainsmono/JetBrainsMono[wght].ttf` | `48715a42ec242c21e9f02692891e147d022299a52e48d5e413e1a942193ffeda` |

Coverage: Google Fonts "latin" + "latin-ext" plus arrows, so names such as
Kubica-era Polish, Czech, Turkish, Hungarian and Romanian spellings render in the
brand faces. Rebuild with:

```bash
uv run --with fonttools --with brotli python subset-fonts.py <folder with the upstream TTFs>
```

Retrieved 2026-10-25 from `https://raw.githubusercontent.com/google/fonts/main/ofl/`.
