# Apex news policy

Apex is a Formula 1 fan site. Every headline and video on it must be about the **FIA Formula 1 World Championship**. This page is the checklist. The code that enforces it is `packages/api-client/src/news-policy/index.ts`, tested with real headlines in `news-policy.test.ts`. If you change one, change the other.

Applies to `/latest`, the home page Wire, `/video`, the home video rails, `/api/news/headlines` and anything else that reads `getF1NewsFeed`, `getAggregatedF1NewsResult` or `getF1Videos`.

## 1. What may appear

A story qualifies when its headline is about one of these:

- [x] Formula 1 drivers: racing, contracts, form, injuries, penalties, statements, and their F1 careers (including past champions).
- [x] Formula 1 teams and power-unit makers: cars, upgrades, staff, results, ownership.
- [x] Formula 1 race weekends: practice, sprint, qualifying, race, grid, results, standings, calendar, circuits.
- [x] FIA rules for Formula 1: technical and sporting regulations, stewards' decisions, the cost cap, the F1 Commission.
- [x] The Formula 1 business: FOM/Liberty Media, broadcasting deals, race-hosting contracts, new teams, attendance.
- [x] F1 history and culture published by an F1 newsroom (documentaries, anniversaries).

Driver names, team names and "Grand Prix" alone are not enough from a general news site. The headline must name F1, or the summary must name F1 and the headline must use F1 vocabulary.

## 2. What may not appear

Reject the story if its headline (or its category tags) is about:

- [ ] **Other championships**: F2, F3, F1 Academy, Formula 4, Formula Regional, Formula E, IndyCar and Indy NXT, NASCAR, MotoGP/Moto2/Moto3, WorldSBK, WEC/Le Mans, IMSA/Daytona, WRC and rallies, Dakar, DTM, Supercars, Super Formula, Super GT, BTCC, Extreme E, GT3/GT4, Porsche Supercup, karting. A headline that names both F1 and another series ("F1 team signs Formula 2 champion") is allowed.
- [ ] **Other sports**: football/soccer (including F1 drivers picking football winners), cricket, rugby, baseball/World Series, NFL, NBA, NHL, tennis, golf, boxing, UFC, high-school sport.
- [ ] **Gambling, calculators and affiliate guides**: betting odds and tips, sportsbooks, promo codes, tip/gratuity calculators, "how to watch / live stream" guides.
- [ ] **Discussion threads and forums**: Reddit and similar.
- [ ] **Local news, lifestyle, products and anything else not about F1**: road cars, cameras, "formula" in another sense, court cases, celebrity gossip without an F1 angle.

## 3. Where stories may come from

**Curated F1 feeds** are trusted to be about F1, subject to section 2:

| Feed | Why trusted |
|---|---|
| Motorsport.com F1 RSS | F1 category feed |
| Autosport F1 RSS | F1 category feed |
| The Race F1 RSS | F1 category feed |
| RaceFans RSS | Mostly F1; its category tags mark other series (IndyCar), which are rejected |
| The Guardian (Formula One tag) | Tag-filtered by the API |

**Keyword-search APIs** (NewsAPI, NewsData, GNews, Currents) match body text, so their rows must also come from a publisher on the allowlist (`NEWS_PUBLISHER_ALLOWLIST`). Each allowlisted publisher has a scope:

| Scope | Examples | Extra rule |
|---|---|---|
| `f1` | Formula1.com, PlanetF1, GPblog, RacingNews365, F1i, GPFans | none |
| `motorsport` | Motorsport.com, Autosport, The Race, RaceFans, RACER, Crash.net, FIA | headline needs an F1 signal |
| `general` | BBC Sport, Sky Sports, ESPN, Reuters, AP, The Guardian, Marca | headline must name F1 / Grand Prix, or the summary names F1 and the headline uses F1 vocabulary |

API rows are shown under the publisher's real name (for example "ESPN", not "Currents" or "GNews · ESPN").

**Blocked hosts** (`NEWS_BLOCKED_HOSTS`) are never shown, whatever feed delivers them:

| Host | Reason (observed 2026-10-25 unless noted) |
|---|---|
| USA TODAY Network sites (usatoday.com, cincinnati.com, courierpress.com, jconline.com, …) | HTTP 402 paywall |
| ndtv.com, ndtvimg.com | HTTP 403 to readers; images blocked cross-origin |
| yahoo.com | Redirects EU readers to a consent wall |
| news.google.com, msn.com | Wrapper links, not the publisher; consent wall |
| reddit.com | Discussion threads; HTTP 403 |
| nytimes.com/The Athletic, wsj.com, ft.com, The Times, The Telegraph, Bloomberg, The Economist | Hard paywall |

To add a publisher: confirm its F1 stories open without a paywall or consent wall from the UK/EU and US, pick the scope, add it to the allowlist and add one of its real headlines to the test.

## 4. Duplicates

- [x] Same URL (ignoring `www.` and tracking parameters) or the same normalised headline: keep the first copy.
- [x] Near-duplicate headlines (60%+ of significant words shared, published within 48 hours): keep the first copy.
- [x] Priority when choosing which copy to keep: curated RSS, then the Guardian, then NewsAPI, NewsData, GNews, Currents.
- [x] An API row from a newsroom whose own curated feed is already on the page (for example a NewsAPI copy of an Autosport story) is dropped. The feed is the canonical copy.

## 5. Images

- [x] A story with no image is shown as a text card or text row. Never a placeholder frame or stock photo.
- [x] An image that fails to load is never shown broken or as a placeholder. Image-led cards (feature, standard) are removed from the page; compact rows fall back to their text-only form (`components/ui/NewsCard.tsx`).
- [x] Images are the publisher's own (feed enclosure, media tag or og:image). Apex never substitutes a stock or generated image.

## 6. Links

- [x] Only absolute `http(s)` links without embedded credentials.
- [x] Paywalled (HTTP 402), forbidden (HTTP 403) and consent-walled links are excluded by host (section 3). When a new one is found, add the host to the blocklist with the evidence.
- [x] Links open the publisher's article in a new tab. Apex does not copy article text.

## 7. Sources that fail

- [x] A source that errors or times out is reported as temporarily unavailable; the page names it and shows the rest.
- [x] A source that rejects our credentials (HTTP 401/403, for example the Guardian key on 2026-10-25) is reported as **offline until its access is renewed**, not as a temporary blip, and contributes nothing.
- [x] Counts in copy ("N stories from N newsrooms via N live feeds", the home Wire's "N newsrooms") are computed from what actually answered on that render. Never a constant.

## 8. Video

- [x] Only channels whose output is Formula 1, each verified with the YouTube Data API (`channels.list` title plus recent uploads) before it is added. The list and verification date live in `packages/api-client/src/youtube/index.ts`.
- [x] Channel names shown on the site come from `channels.list snippet.title` (or the Atom feed's author name on the no-key path), never a hard-coded label.
- [x] Video titles naming another series or sport (for example "F1 Academy … Highlights" on Sky Sports F1) are left out.
- [x] Removed 2026-10-25: channel `UCDxm-FbK9nmZKqHI19j-DOw`, previously labelled "WTF1", is now "RAFA TV" (GT4/NASCAR films). Replaced with Sky Sports F1 (`UC3kxJQ9RfaS5CKeYbbFMi4Q`).

## 9. Maintenance

- The F1 vocabulary list in the classifier includes the 2026 grid's surnames and team names. It only helps admit stories from multi-series and general outlets, so a stale entry lowers recall and never mislabels anything. Refresh it when the grid changes.
- Review this checklist when a new provider is added, and add its off-topic headlines to the tests.
