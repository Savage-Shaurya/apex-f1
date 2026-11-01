import "next/dist/server/node-environment";
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, type TestContext } from 'node:test';
import { getTeamCommonsCar } from './team-photo';

/**
 * Review 2026-11-01 (findings 1 and 2): the Commons car lookup is cached once
 * per team id (pages and /references read the same entry), and a failed
 * lookup is never cached. Runs the installed Next unstable_cache against an
 * in-memory store; Commons is a stubbed fetch (no network).
 */

type Entry = { value: { kind: string; data: { body: string }; revalidate: number } };

function nextStorage(t: TestContext) {
  const entries = new Map<string, Entry>();
  const original = Object.getOwnPropertyDescriptor(globalThis, '__incrementalCache');
  Object.defineProperty(globalThis, '__incrementalCache', {
    configurable: true,
    value: {
      generateSimpleCacheKey: async (key: string) => key,
      get: async (key: string) => (entries.has(key) ? { value: entries.get(key)!.value, isStale: false } : null),
      set: async (key: string, value: Entry['value']) => { entries.set(key, { value }); },
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, '__incrementalCache', original);
    else Reflect.deleteProperty(globalThis, '__incrementalCache');
  });
  return entries;
}

const commonsAnswer = () => new Response(JSON.stringify({
  query: { pages: [{
    title: 'File:Kimi_Raikkonen_2012_Malaysia_FP2.jpg',
    categories: [],
    imageinfo: [{
      width: 3000, height: 2000, mime: 'image/jpeg',
      descriptionurl: 'https://commons.wikimedia.org/wiki/File:Kimi_Raikkonen_2012_Malaysia_FP2.jpg',
      extmetadata: { Artist: { value: 'Morio' }, LicenseShortName: { value: 'CC BY-SA 3.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/3.0' } },
    }],
  }] },
}), { status: 200, headers: { 'content-type': 'application/json' } });

function stubCommons(t: TestContext, answers: Array<() => Response>) {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('https://commons.wikimedia.org/')) throw new Error(`unexpected request ${url}`);
    const answer = answers[Math.min(calls, answers.length - 1)]!;
    calls++;
    return answer();
  });
  return () => calls;
}

const noOutage = { onFailure: async () => {} };

test('finding 1: one Commons lookup per team id, whatever name the caller passes (team page, /references, champion card)', async (t) => {
  const entries = nextStorage(t);
  const calls = stubCommons(t, [commonsAnswer]);
  const onPage = await getTeamCommonsCar('lotus_f1', 'Lotus F1', noOutage);
  const onReferences = await getTeamCommonsCar('lotus_f1', 'Lotus E20', noOutage);
  const onCard = await getTeamCommonsCar('lotus_f1', 'Lotus', noOutage);
  assert.equal(calls(), 1, 'the same photo is looked up once');
  assert.equal(entries.size, 1, 'one cache entry per team');
  const key = [...entries.keys()][0]!;
  assert.match(key, /"lotus_f1"/);
  assert.doesNotMatch(key, /Lotus F1|Lotus E20/, 'the team name is not part of the key');
  // Same picture and credit everywhere; only the alt text follows the page.
  assert.ok(onPage && onReferences && onCard);
  assert.equal(onPage.src, onReferences.src);
  assert.deepEqual(onPage.credit, onCard.credit);
  assert.equal(onPage.alt, 'Lotus E20, a Lotus F1 Formula 1 car');
  assert.equal(onCard.alt, 'Lotus E20, a Lotus Formula 1 car');
});

test('finding 2: a failed Commons lookup (429) is not cached; the next render retries and gets the photo', async (t) => {
  const entries = nextStorage(t);
  const calls = stubCommons(t, [() => new Response('busy', { status: 429 }), commonsAnswer]);
  let outages = 0;
  const first = await getTeamCommonsCar('brabham', 'Brabham', { onFailure: async () => { outages++; } });
  assert.equal(first, null);
  assert.equal(entries.size, 0, 'the failure must not be stored for a day');
  assert.equal(outages, 1, 'the page render is told to keep itself only briefly (outageConnection)');
  const second = await getTeamCommonsCar('brabham', 'Brabham', noOutage);
  assert.ok(second, 'the retry reads Commons again');
  assert.equal(calls(), 2);
  assert.equal(entries.size, 1);
});

test('finding 2: /references and the team pages keep an incomplete render only briefly (outageConnection)', () => {
  const web = new URL('../../../', import.meta.url);
  const src = (p: string) => readFileSync(new URL(p, web), 'utf8');
  assert.match(src('app/references/page.tsx'), /if \(!photos\.complete\) await outageConnection\(\)/);
  const credits = src('components/info/photo-credits.ts');
  assert.match(credits, /teamCarPhoto\(id, pick\.car\)/);
  assert.match(credits, /if \(failed\) complete = false/);
  // The pages no longer swallow the lookup before team-photo can mark the render.
  for (const page of ['app/teams/[slug]/(profile)/page.tsx', 'app/teams/[slug]/history/page.tsx']) {
    assert.doesNotMatch(src(page), /getTeamCommonsCar\([^)]*\)\.catch/, page);
  }
});
