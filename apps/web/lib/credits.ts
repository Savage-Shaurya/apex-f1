import { F1_RSS_SOURCES } from '@apex/api-client/rss';

/**
 * Every credit Apex owes, in one place. Rendered in full on /references
 * (app/references/page.tsx), which the footer and About link to; pages no
 * longer name providers in their body copy.
 *
 * Licence names are only stated where the provider publishes one (checked
 * 2026-10-25): Open-Meteo "API data are offered under CC BY 4.0"; openf1.org
 * "Licensed under CC BY-NC-SA 4.0"; Wikipedia text CC BY-SA 4.0; Wikidata CC0;
 * bacinger/f1-circuits outlines MIT (the MIT notice requires the copyright
 * line, so it is shown here); Commons licences vary per file and are shown
 * per photograph under Photographs on /references. Library licences are read from each package's
 * package.json; font licences from app/fonts/*-OFL.txt.
 */

export interface Credit {
  /** Who is credited. */
  name: string;
  /** What they supply, in reader language. */
  role: string;
  href: string;
  license?: { name: string; href: string };
}

export interface CreditGroup {
  /** Anchor on /references. */
  id: string;
  title: string;
  /** One sentence under the group title. */
  intro: string;
  credits: readonly Credit[];
}

/** The brand line used in the footer, metadata and About. */
export const BRAND_STATEMENT = 'Apex is an independent, fan-built Formula 1 platform.';

/** Full non-affiliation statement (About, /references). */
export const NON_AFFILIATION_STATEMENT =
  'Apex is not affiliated with, endorsed by or associated with Formula 1, the FIA, Formula One Management, Formula One Licensing B.V., any team or any driver.';

export const TRADEMARK_NOTICE =
  'F1, Formula 1, Formula One, FIA Formula One World Championship, Grand Prix and related names and marks are trademarks of Formula One Licensing B.V. Team names, logos and liveries belong to their owners. They are used here only to identify the teams, drivers and races being described.';

const CC_BY_NC_SA = { name: 'CC BY-NC-SA 4.0', href: 'https://creativecommons.org/licenses/by-nc-sa/4.0/' };
const CC_BY = { name: 'CC BY 4.0', href: 'https://creativecommons.org/licenses/by/4.0/' };
const CC_BY_SA = { name: 'CC BY-SA 4.0', href: 'https://creativecommons.org/licenses/by-sa/4.0/' };
const CC0 = { name: 'CC0 1.0', href: 'https://creativecommons.org/publicdomain/zero/1.0/' };
const MIT = { name: 'MIT', href: 'https://opensource.org/license/mit' };
const APACHE_2 = { name: 'Apache 2.0', href: 'https://www.apache.org/licenses/LICENSE-2.0' };
const OFL = { name: 'SIL OFL 1.1', href: 'https://openfontlicense.org' };

export const DATA_CREDITS: readonly Credit[] = [
  {
    name: 'Jolpica F1',
    role: 'Calendar, results, standings and the championship archive back to 1950.',
    href: 'https://github.com/jolpica/jolpica-f1',
  },
  {
    name: 'OpenF1',
    role: 'Final session timing, race control messages, lap traces and the driver roster.',
    href: 'https://openf1.org',
    license: CC_BY_NC_SA,
  },
  {
    name: 'Open-Meteo',
    role: 'Race-weekend weather.',
    href: 'https://open-meteo.com',
    license: CC_BY,
  },
  {
    name: 'Wikipedia contributors',
    role: 'Driver biographies and career summaries.',
    href: 'https://www.wikipedia.org',
    license: CC_BY_SA,
  },
  {
    name: 'Wikidata',
    role: 'Driver profile facts such as birthplace and date of birth.',
    href: 'https://www.wikidata.org',
    license: CC0,
  },
  {
    name: 'bacinger/f1-circuits',
    role: 'Circuit outlines, © 2019-2025 Tomislav Bacinger.',
    href: 'https://github.com/bacinger/f1-circuits',
    license: { name: 'MIT', href: 'https://github.com/bacinger/f1-circuits/blob/master/LICENSE.md' },
  },
  {
    name: 'YouTube',
    role: 'Videos, played in YouTube’s own player. Each video belongs to its channel.',
    href: 'https://www.youtube.com',
  },
];

export const IMAGE_CREDITS: readonly Credit[] = [
  {
    name: 'Formula One Licensing B.V. / F1 media',
    role: 'Driver portraits, team cars and team logos, © Formula One Licensing B.V. (formula1.com).',
    href: 'https://www.formula1.com',
  },
  {
    name: 'Wikimedia Commons contributors',
    role: 'Circuit photographs and portraits. Each one is listed under Photographs below, with its photographer and licence.',
    href: 'https://commons.wikimedia.org',
  },
];

/** Newsrooms whose headlines appear on Apex. Built from the live feed list so it never drifts. */
export const NEWS_PUBLISHERS: readonly Credit[] = [
  ...F1_RSS_SOURCES.map((s) => ({ name: s.name, role: 'Formula 1 news.', href: s.homepage })),
  { name: 'The Guardian', role: 'Formula 1 news.', href: 'https://www.theguardian.com/sport/formulaone' },
];

/** Services that help find Formula 1 stories from other newsrooms. */
export const NEWS_SERVICES: readonly Credit[] = [
  { name: 'GNews', role: 'Story discovery.', href: 'https://gnews.io' },
  { name: 'NewsData.io', role: 'Story discovery and automatic tone labels.', href: 'https://newsdata.io' },
  { name: 'NewsAPI', role: 'Story discovery.', href: 'https://newsapi.org' },
  { name: 'Currents', role: 'Story discovery.', href: 'https://currentsapi.services' },
];

export const COMMUNITY_CREDITS: readonly Credit[] = [
  { name: 'r/formula1 on Reddit', role: 'Fan threads on the home page. Each thread belongs to its author.', href: 'https://www.reddit.com/r/formula1/' },
];

export const SOFTWARE_CREDITS: readonly Credit[] = [
  { name: 'Next.js', role: 'Web framework, by Vercel.', href: 'https://nextjs.org', license: MIT },
  { name: 'React', role: 'Interface library, by Meta.', href: 'https://react.dev', license: MIT },
  { name: 'Tailwind CSS', role: 'Styling, by Tailwind Labs.', href: 'https://tailwindcss.com', license: MIT },
  { name: 'GSAP', role: 'Animation, by GreenSock (Webflow).', href: 'https://gsap.com', license: { name: 'GSAP Standard Licence', href: 'https://gsap.com/standard-license' } },
  { name: 'Lenis', role: 'Smooth scrolling, by darkroom.engineering.', href: 'https://lenis.darkroom.engineering', license: MIT },
  { name: 'Motion (Framer Motion)', role: 'Interface animation.', href: 'https://motion.dev', license: MIT },
  { name: 'three.js', role: '3D rendering.', href: 'https://threejs.org', license: MIT },
  { name: 'React Three Fiber and drei', role: '3D in React, by Poimandres.', href: 'https://r3f.docs.pmnd.rs', license: MIT },
  { name: 'Fuse.js', role: 'Search.', href: 'https://www.fusejs.io', license: APACHE_2 },
  { name: 'Drizzle ORM', role: 'Database toolkit.', href: 'https://orm.drizzle.team', license: APACHE_2 },
  { name: 'clsx and tailwind-merge', role: 'Class name utilities.', href: 'https://github.com/lukeed/clsx', license: MIT },
];

export const FONT_CREDITS: readonly Credit[] = [
  { name: 'Anybody', role: 'Display type, © 2020 The Anybody Project Authors (Etcetera Type Co).', href: 'https://github.com/Etcetera-Type-Co/Anybody', license: OFL },
  { name: 'Hanken Grotesk', role: 'Text and interface type, © 2021 The Hanken Grotesk Project Authors.', href: 'https://github.com/marcologous/hanken-grotesk', license: OFL },
  { name: 'EB Garamond', role: 'Quotations, © 2017 The EB Garamond Project Authors.', href: 'https://github.com/octaviopardo/EBGaramond12', license: OFL },
  { name: 'JetBrains Mono', role: 'Lap times and gaps, © 2020 The JetBrains Mono Project Authors.', href: 'https://github.com/JetBrains/JetBrainsMono', license: OFL },
];

/** The /references page, in reading order. */
export const REFERENCE_GROUPS: readonly CreditGroup[] = [
  { id: 'data', title: 'Data', intro: 'The results, timing, weather and facts behind every page.', credits: DATA_CREDITS },
  { id: 'images', title: 'Images', intro: 'Photographs, portraits, cars and logos, and who they belong to.', credits: IMAGE_CREDITS },
  { id: 'news', title: 'News', intro: 'Headlines link to the newsroom that wrote them. Their words and pictures remain theirs.', credits: [...NEWS_PUBLISHERS, ...NEWS_SERVICES] },
  { id: 'community', title: 'Community', intro: 'Conversation from the wider Formula 1 fan community.', credits: COMMUNITY_CREDITS },
  { id: 'software', title: 'Open-source software', intro: 'Apex stands on the work of these open-source projects.', credits: SOFTWARE_CREDITS },
  { id: 'type', title: 'Typefaces', intro: 'Every face is open source. No Formula 1 proprietary typeface is used or imitated.', credits: FONT_CREDITS },
];
