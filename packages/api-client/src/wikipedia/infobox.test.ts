import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractF1DriverInfobox, getF1InfoboxCareer, parseF1InfoboxFastestLaps } from './infobox';

// Shapes copied from the live articles' section 0 (trimmed).
const senna = `{{Infobox person
| name = Ayrton Senna
| module             = {{Infobox F1 driver|embed=yes
| years = {{F1|1984}}–{{F1|1994}}
| poles = 65
| fastest_laps  = 19
| first_race = [[1984 Brazilian Grand Prix]]
}}
}}
'''Ayrton Senna da Silva''' was a Brazilian racing driver.`;
const andretti = `{{Infobox person
| module = {{Infobox racing driver
| fastest_laps = 99
}}
| module2 = {{Infobox F1 driver
| fastest_laps  = 10<ref>{{cite web|url=https://example.org}}</ref>
}}
| module3 = {{Infobox Champ Car driver
| fastest_laps = 50
}}
}}`;

test('reads fastest laps from the F1 module only', () => {
  assert.equal(parseF1InfoboxFastestLaps(senna), 19);
  assert.equal(parseF1InfoboxFastestLaps(andretti), 10);
  assert.ok(extractF1DriverInfobox(andretti)?.startsWith('{{Infobox F1 driver'));
});

test('absent, blank or non-numeric fields are null, never 0', () => {
  assert.equal(parseF1InfoboxFastestLaps('{{Infobox person | name = X }}'), null);
  assert.equal(parseF1InfoboxFastestLaps('{{Infobox F1 driver\n| fastest_laps = \n}}'), null);
  assert.equal(parseF1InfoboxFastestLaps('{{Infobox F1 driver\n| fastest_laps = n/a\n}}'), null);
  assert.equal(parseF1InfoboxFastestLaps('{{Infobox F1 driver\n| fastest_laps = 0\n}}'), 0);
});

test('fetches section 0 by article title and fails soft', async () => {
  let requested = '';
  const fetchImpl = (async (url: string) => { requested = url; return Response.json({ parse: { title: 'Ayrton Senna', wikitext: senna } }); }) as unknown as typeof fetch;
  const career = await getF1InfoboxCareer('http://en.wikipedia.org/wiki/Ayrton_Senna', { fetchImpl });
  assert.deepEqual(career, { fastestLaps: 19, sourceUrl: 'https://en.wikipedia.org/wiki/Ayrton_Senna' });
  const params = new URL(requested).searchParams;
  assert.equal(params.get('page'), 'Ayrton_Senna');
  assert.equal(params.get('section'), '0');
  const failing = (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;
  assert.equal(await getF1InfoboxCareer('http://en.wikipedia.org/wiki/Ayrton_Senna', { fetchImpl: failing }), null);
});

test('a live {{F1stat|XXX|fastestlaps}} field is expanded by Wikipedia; an empty expansion stays null', async () => {
  const alonso = '{{Infobox F1 driver\n| poles = {{F1stat|ALO|poles}}\n| fastest_laps       = {{F1stat|ALO|fastestlaps}}\n}}';
  assert.equal(parseF1InfoboxFastestLaps(alonso), null);
  const requested: string[] = [];
  const expansion = (value: string) => (async (url: string) => {
    requested.push(url);
    const params = new URL(url).searchParams;
    return params.get('action') === 'parse' ? Response.json({ parse: { title: 'Fernando Alonso', wikitext: alonso } }) : Response.json({ expandtemplates: { wikitext: value } });
  }) as unknown as typeof fetch;
  assert.deepEqual(await getF1InfoboxCareer('https://en.wikipedia.org/wiki/Fernando_Alonso', { fetchImpl: expansion('26') }), { fastestLaps: 26, sourceUrl: 'https://en.wikipedia.org/wiki/Fernando_Alonso' });
  const expand = new URL(requested[1]!).searchParams;
  assert.equal(expand.get('action'), 'expandtemplates');
  assert.equal(expand.get('text'), '{{F1stat|ALO|fastestlaps}}');
  assert.equal((await getF1InfoboxCareer('https://en.wikipedia.org/wiki/Fernando_Alonso', { fetchImpl: expansion('') }))?.fastestLaps, null);
  // Other templates are never sent for expansion.
  const other = '{{Infobox F1 driver\n| fastest_laps = {{subst:evil}}\n}}';
  let calls = 0;
  const once = (async () => { calls++; return Response.json({ parse: { title: 'X', wikitext: other } }); }) as unknown as typeof fetch;
  assert.equal((await getF1InfoboxCareer('https://en.wikipedia.org/wiki/X', { fetchImpl: once }))?.fastestLaps, null);
  assert.equal(calls, 1);
});
