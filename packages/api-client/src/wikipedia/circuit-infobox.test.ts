import assert from 'node:assert/strict';
import { test } from 'node:test';
import { circuitFactsForSeason, cleanWikiValue, getCircuitInfoboxes, parseCircuitInfobox, wikipediaTitleFromUrl } from './circuit-infobox';

// Excerpts of the live English Wikipedia infoboxes (read 2026-10-25).
const LUSAIL = `{{Infobox motorsport venue
|name              = Lusail International Circuit
|layout            = Grand Prix Circuit (2023–present)
|length_km         = 5.419
|layout2           = Short Circuit (2023–present)
|length2_km        = 3.701
|layout3           = Club Circuit (2023–present)
|length3_km        = 2.446
|layout4           = Original Grand Prix Circuit (2004–2022)
|length4_km        = 5.380
}}`;

const MADRING = `{{Infobox motorsport venue
| name              = Madring
| layout            = Grand Prix Circuit (2026)
| length_km         = 5.414
}}`;

const MONACO = `{{Infobox motorsport venue
|name           = Circuit de Monaco
|layout         = Grand Prix Circuit (2015–present) (Tabac slightly moved)
|length_km      = 3.337
|layout2        = Extended Formula E Circuit (2021) (changes in Nouvelle Chicane)
|length2_km     = 3.318
|layout3        = Original Formula E Circuit (2015–2019)
|length3_km     = 1.765
|layout4        = 6th Variation (2003–2014) (tightened, slower chicane at exit of swimming pool section)
|length4_km     = 3.340
|layout6        = 4th Variation (1986–1996) (Nouvelle chicane added)
|length6_km     = 3.328
}}`;

const SOCHI = `{{Infobox motorsport venue
| layout             = Permanent Circuit (2014–present)
| length_km          = 2.313
| layout2            = Grand Prix Circuit (2014–2023)
| length2_km         = 5.848
}}`;

const RED_BULL_RING = `| layout            = Red Bull Ring Grand Prix Circuit (2025–present){{efn|name=GP|A1-Ring (1996–2004) has the same configuration.}}
| length_km         = 4.326
| layout4           = Red Bull Ring Grand Prix Circuit<br>(August 2016–2024){{efn|name=GP}}
| length4_km        = 4.318
| layout5           = Red Bull Ring (2011–July 2016)<br>A1-Ring (1996–2004){{efn|name=GP}}
| length5_km        = 4.326`;

const VEGAS_RACE = `{{Infobox F1 race
| name = Las Vegas Grand Prix
| circuit_length_km = 6.201
| first_held = [[2023 Las Vegas Grand Prix|2023]]
| last_held =
}}`;

const SILVERSTONE = `| layout         = Arena Grand Prix Circuit (2011–present)
| length_km      = 5.891
| layout5        = Arena Grand Prix Circuit (2010)<ref>{{cite news|title=New circuit}}</ref>
| length5_km     = 5.901
| layout6        = Bridge Grand Prix Circuit (1997–2010)
| length6_km     = 5.141`;

const facts = (wikitext: string, season: number, currentYear = 2026) => circuitFactsForSeason(parseCircuitInfobox(wikitext), season, currentYear);

test('Losail reads 5.419 km today and 5.380 km on the original layout', () => {
  assert.deepEqual(facts(LUSAIL, 2026), { lengthKm: 5.419, layoutName: 'Grand Prix Circuit (2023–present)', primaryLayout: true });
  assert.equal(facts(LUSAIL, 2021).lengthKm, 5.38);
  assert.equal(facts(LUSAIL, 2021).primaryLayout, false);
});

test('Madring reads 5.414 km, including next season before the article adds "present"', () => {
  assert.equal(facts(MADRING, 2026).lengthKm, 5.414);
  assert.equal(facts(MADRING, 2027, 2027).lengthKm, 5.414);
  assert.equal(facts(MADRING, 2027, 2027).primaryLayout, true);
});

test('1990 Monaco gets its own length and is not drawn with the modern outline', () => {
  const monaco1990 = facts(MONACO, 1990);
  assert.equal(monaco1990.lengthKm, 3.328);
  assert.equal(monaco1990.primaryLayout, false);
  // Formula E layouts never stand in for the Grand Prix circuit.
  assert.equal(facts(MONACO, 2021).lengthKm, 3.337);
  assert.equal(facts(MONACO, 2021).primaryLayout, true);
});

test('a dated Grand Prix layout wins over another configuration of the same years', () => {
  assert.equal(facts(SOCHI, 2018).lengthKm, 5.848);
});

test('month-qualified ranges, footnotes and line breaks are understood', () => {
  const layouts = parseCircuitInfobox(RED_BULL_RING);
  assert.deepEqual(layouts.map((l) => l.index), [1, 4, 5]);
  assert.deepEqual(layouts[1]!.segments[0]!.ranges, [{ from: 2016, to: 2024 }]);
  assert.deepEqual(layouts[2]!.segments.map((s) => s.ranges), [[{ from: 2011, to: 2016 }], [{ from: 1996, to: 2004 }]]);
  assert.equal(facts(RED_BULL_RING, 2000).lengthKm, 4.326);
});

test('race articles use circuit_length_km from the first year held', () => {
  assert.equal(facts(VEGAS_RACE, 2024).lengthKm, 6.201);
  assert.equal(facts(VEGAS_RACE, 1982).lengthKm, null);
});

test('overlapping candidates with different lengths are not guessed', () => {
  assert.deepEqual(facts(SILVERSTONE, 2010), { lengthKm: null, layoutName: null, primaryLayout: false });
  assert.equal(facts(SILVERSTONE, 2005).lengthKm, 5.141);
});

test('a season with no dated layout has no published length', () => {
  assert.equal(facts(LUSAIL, 1999).lengthKm, null);
  assert.deepEqual(parseCircuitInfobox('{{Infobox settlement\n| name = Dallas\n}}'), []);
});

test('wikitext cleaning keeps the visible text only', () => {
  assert.equal(cleanWikiValue("Grand Prix Circuit<br />(1986–1996)<!-- note --><ref name=x/>"), 'Grand Prix Circuit (1986–1996)');
  assert.equal(cleanWikiValue('{{convert|5.419|km|mi}}'), '5.419');
  assert.equal(cleanWikiValue("[[Monte Carlo|Monte-Carlo]] '''GP'''"), 'Monte-Carlo GP');
});

test('only English Wikipedia article URLs are accepted', () => {
  assert.equal(wikipediaTitleFromUrl('https://en.wikipedia.org/wiki/Lusail_International_Circuit'), 'Lusail International Circuit');
  assert.equal(wikipediaTitleFromUrl('http://en.wikipedia.org/wiki/Aut%C3%B3dromo_Jos%C3%A9_Carlos_Pace'), 'Autódromo José Carlos Pace');
  assert.equal(wikipediaTitleFromUrl('https://en.wikipedia.org/wiki/Las_Vegas_Grand_Prix#Circuit'), 'Las Vegas Grand Prix');
  assert.equal(wikipediaTitleFromUrl('https://evil.example/wiki/Monaco'), null);
  assert.equal(wikipediaTitleFromUrl(''), null);
});

test('one batched request maps redirected titles back to each Jolpica URL', async () => {
  const requests: URL[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    return new Response(JSON.stringify({
      query: {
        redirects: [{ from: 'Losail International Circuit', to: 'Lusail International Circuit' }],
        pages: [
          { title: 'Lusail International Circuit', revisions: [{ slots: { main: { content: LUSAIL } } }] },
          { title: 'Madring', revisions: [{ slots: { main: { content: MADRING } } }] },
          { title: 'Nowhere Ring', missing: true },
        ],
      },
    }), { headers: { 'content-type': 'application/json' } });
  };
  const losail = 'http://en.wikipedia.org/wiki/Losail_International_Circuit';
  const madring = 'https://en.wikipedia.org/wiki/Madring';
  const missing = 'https://en.wikipedia.org/wiki/Nowhere_Ring';
  const result = await getCircuitInfoboxes([losail, madring, missing, 'https://example.com/x'], { fetchImpl, strict: true });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.hostname, 'en.wikipedia.org');
  assert.equal(requests[0]!.searchParams.get('rvsection'), '0');
  assert.equal(requests[0]!.searchParams.get('titles'), 'Losail International Circuit|Madring|Nowhere Ring');
  assert.equal(circuitFactsForSeason(result.get(losail)!, 2026, 2026).lengthKm, 5.419);
  assert.equal(circuitFactsForSeason(result.get(madring)!, 2026, 2026).lengthKm, 5.414);
  assert.deepEqual(result.get(missing), []);
  assert.deepEqual(result.get('https://example.com/x'), []);
});

test('a failed read throws in strict mode so callers can say "Unavailable"', async () => {
  const fetchImpl: typeof fetch = async () => new Response('busy', { status: 429 });
  await assert.rejects(getCircuitInfoboxes(['https://en.wikipedia.org/wiki/Madring'], { fetchImpl, strict: true }));
  assert.equal((await getCircuitInfoboxes(['https://en.wikipedia.org/wiki/Madring'], { fetchImpl })).size, 0);
});
