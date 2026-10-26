# Quality gate

One command that turns every class of problem found in review (layout,
images, accessibility, keyboard, data accuracy, links) into automatic checks
that fail loudly if the problem comes back.

## Run it

```bash
# from the repo root, with the site running
APEX_QA_BASE_URL=http://localhost:3000 \
APEX_QA_JOLPICA_URL=http://127.0.0.1:4777/jolpica \
pnpm qa:gate                 # everything (about 10-20 min on a dev server)

APEX_QA_BASE_URL=http://localhost:3000 pnpm qa:gate:quick   # what CI runs (2-4 min)

pnpm --filter @apex/web qa:gate -- --only=matrix,a11y        # some checks
pnpm --filter @apex/web qa:gate:selftest                     # prove the gate still catches bugs
```

- `APEX_QA_BASE_URL`: site to test (default `http://localhost:3000`).
- `APEX_QA_JOLPICA_URL`: Jolpica base for the data check. Default is the public
  API (one request per second). Locally use the shared cache so the gate never
  spends the 500/hour budget.
- `APEX_QA_CONCURRENCY`: parallel browser pages (default 4).
- Browser: Playwright Chromium (`pnpm --filter @apex/web exec playwright install chromium`).

Exit code 1 on any failure. A JSON report is written to
`apps/web/tests/quality-gate/.reports/` (gitignored). Nothing is skipped: a
check that cannot run is reported as an `error` failure.

## Checks

| Check | What fails it | Where |
|---|---|---|
| `static` | Forbidden patterns in `apps/web/{app,components,lib}`: start gantry, decorative dots, custom cursor, the owner's GitHub (link or handle), Unsplash/Giphy/placeholder images, lorem, provider names or pipeline mechanics in visible copy (outside `/references`, `/legal`), retired contact values | `lib/forbidden.mjs`, `lib/static-scan.mjs` |
| `unit` | `forbidden.test.mjs` (each rule catches a broken sample and ignores the legitimate look-alike; repo scan) and `time.test.ts` (fake-clock phases, season rollover on 2026-12-10 / 2027-01-15 / 2027-03-20, DST weekends; every case in 5 time zones). Both also run in `pnpm test`. | `*.test.*` |
| `selftest` | The gate itself: Local fixture pages, one clean and one deliberately broken per bug class. Every broken page must fail its check and the clean pages must pass. | `lib/fixtures.mjs` |
| `matrix` | Every route group (real slugs read from Jolpica) at 320, 390, 768, 820, 1024, 1440, 1920 (touch at 1024 and below): HTTP status, horizontal overflow, clipped text, negative letter-spacing under 24px, broken images, hard crops and portraits cropped through the face, console errors, CLS > 0.02, missing header/primary nav/menu, Give back not reachable (header or menu), primary controls under 44px, content left hidden by reveals. At 1440 and 390 also the rendered forbidden rules: exact four footer socials, no link to or mention of the owner's GitHub (ShAuRyA-Noodle, Savage-Shaurya; third-party credit links to github.com on /references are allowed), no credit/licence text in the footer, no `Photo:/Outline:/Data:/Source:` captions outside `/references`, no provider copy, no stock images, no gantry, no `cursor:none`, no retired contact values. | `lib/browser.mjs`, `lib/forbidden.mjs` |
| `a11y` | axe-core WCAG 2.2 AA, zero serious or critical, every route at 1440 and 390 | `lib/browser.mjs` |
| `keyboard` | Tab reaches the menu button with a visible focus ring; Enter opens, focus stays in the menu, Escape closes and returns focus; typing "Leclerc" + Enter in `/search` puts a result naming him first (a designed outage state is reported as "could not exercise", never a pass); tabs move with arrow keys | `lib/flows.mjs` |
| `history` | Menu, search overlay and video overlay never reopen on Back/Forward or a later visit; a cleared search stays cleared after Back (`/drivers/all`, `/teams/all`, `/search`) | `lib/flows.mjs` |
| `data` | Current driver and constructor standings (order and points), the last race classification order, the next race link on home and `/schedule`, every driver who changed team mid-season linked to their latest team (Lawson case) and listed on it, and the 1976, 2008, 2018 standings top 10, all against Jolpica | `lib/data-truth.mjs` |
| `links` | Internal crawl from `/` (up to 120 pages, 3 at a time) with no 4xx/5xx; deterministic sample of 30 external links (HEAD, GET fallback). 401/403/429/999 are reported as bot-blocked, not dead. | `lib/flows.mjs` |

`qa:gate:quick` = `static`, `unit`, `selftest`, and `matrix` on 7 key routes at
1440 and 390. CI runs it on every push and pull request against the production
build (`.github/workflows/ci.yml`, job `build`).

## Proof that the checks catch their bug class

- Browser checks: `qa:gate:selftest` must pass 39/39. Each fixture in
  `lib/fixtures.mjs` breaks exactly one thing.
- Static rules and data comparison: `forbidden.test.mjs` asserts each rule on a
  broken sample and on a legitimate look-alike.
- Time: mutating the real code (removing "next after under way", setting the
  season-finish grace to 0, forcing zone offsets to UTC, doubling the result-in
  window) makes `time.test.ts` fail; the restored code passes.

## Adding a check

1. Add the measurement (browser) or rule (static).
2. Add a broken fixture in `lib/fixtures.mjs` (or a unit sample) and confirm the
   self-test fails without your check and passes with it.
3. Never loosen a rule to make the site pass: fix the site.
