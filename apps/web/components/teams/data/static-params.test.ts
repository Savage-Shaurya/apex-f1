import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ProviderError } from '../../../../../packages/api-client/src/transport';
import { currentTeamParams } from './static-params';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../app');

test('the current season teams are prebuilt (cached from the first visit, kept through an outage)', async () => {
  const provider = { getConstructors: async () => [{ constructorId: 'mclaren' }, { constructorId: 'red_bull' }, { constructorId: 'mclaren' }, { constructorId: 'bad id!' }] } as never;
  assert.deepEqual(await currentTeamParams(provider), [{ slug: 'mclaren' }, { slug: 'red_bull' }]);
});

const noWait = { sleep: async () => {} };

test('an unreadable team list (after the bounded retry) prebuilds nothing instead of failing the build', async () => {
  let calls = 0;
  const provider = { getConstructors: async () => { calls++; throw new ProviderError('jolpica', 'rate-limit', 429); } } as never;
  assert.deepEqual(await currentTeamParams(provider, noWait), []);
  assert.equal(calls, 3, 'three bounded tries');
});

test('a transient failure while listing teams is retried, so no team (red_bull, rb) is skipped from the prebuild', async () => {
  let calls = 0;
  const provider = { getConstructors: async () => { calls++; if (calls < 3) throw new ProviderError('jolpica', 'http', 503); return [{ constructorId: 'red_bull' }, { constructorId: 'rb' }]; } } as never;
  assert.deepEqual(await currentTeamParams(provider, noWait), [{ slug: 'red_bull' }, { slug: 'rb' }]);
});

for (const file of ['teams/[slug]/(profile)/page.tsx', 'teams/[slug]/history/page.tsx']) {
  test(`${file} prebuilds the current teams`, () => {
    assert.match(readFileSync(path.join(app, file), 'utf8'), /generateStaticParams\(\) \{\s*return currentTeamParams\(\);/);
  });
}

test('team routes have a designed, full-height outage screen at route level and for the layout throw', () => {
  for (const file of ['teams/error.tsx', 'teams/[slug]/error.tsx']) assert.match(readFileSync(path.join(app, file), 'utf8'), /<TeamError /, file);
  const screen = readFileSync(path.join(app, '../components/teams/TeamError.tsx'), 'utf8');
  assert.match(screen, />Team page unavailable</);
  assert.match(screen, /min-h-\[100svh\]/);
  assert.doesNotMatch(screen, />[^<{]*\b(Jolpica|OpenF1|Ergast)\b/i, 'no provider names in visible copy');
});

test('the [slug] layout keeps throwing on an outage (ISR serves the last good page) but never fails a build', () => {
  const layout = readFileSync(path.join(app, 'teams/[slug]/layout.tsx'), 'utf8');
  // Runtime: throw (ISR keeps the last good page). Build: render the honest state on a short
  // revalidate instead of failing the deploy or making the route dynamic (F-01/F-03).
  assert.match(layout, /if \(record\.state === 'unavailable'\) \{(?:\s*\/\/[^\n]*\n)*\s*if \(await outageDuringBuild\(\)\) return children;\s*throw new PeopleSourceOutage/);
  assert.doesNotMatch(layout, /outageConnection/);
});

test('F-01: a team whose record cannot be read during the build is left out of the prebuild instead of failing or going dynamic', async () => {
  const provider = { getConstructors: async () => [{ constructorId: 'ferrari' }, { constructorId: 'mclaren' }, { constructorId: 'haas' }] } as never;
  const probe = async ({ slug }: { slug: string }) => slug !== 'mclaren';
  assert.deepEqual(await currentTeamParams(provider, noWait, probe), [{ slug: 'ferrari' }, { slug: 'haas' }]);
});
