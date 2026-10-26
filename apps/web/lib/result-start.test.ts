import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapResult, type JolpicaResultEntry } from '@apex/api-client/jolpica';
import { gapText, placesGained } from '../components/race/weekend';
import { didNotStart, hasNoGridSlot, isPitLaneStart, resultStatusOf } from './format';

// Real Jolpica rows (docs/audit/2026-10-26/round3/data/withdrawn-gridzero-provider.json and
// /2026/18/results.json), reduced to the fields these rules read.
const row = (driverId: string, positionText: string, grid: string, laps: string, status: string, extra: Partial<JolpicaResultEntry> = {}) =>
  mapResult({ position: '0', positionText, points: '0', grid, laps, status, Driver: { driverId, givenName: driverId, familyName: driverId }, ...extra } as JolpicaResultEntry);

const lauda1976 = row('lauda', 'W', '3', '2', 'Withdrew');
const fittipaldi1976 = row('emerson_fittipaldi', 'W', '23', '9', 'Withdrew');
const comas1994 = row('comas', 'W', '18', '5', 'Withdrew');
const ratzenberger1994 = row('ratzenberger', 'W', '0', '0', 'Accident');
const barrichello1994 = row('barrichello', 'R', '0', '0', 'Injury');
const ireland1961 = row('ireland', 'W', '0', '0', 'Withdrew');
const modena1988 = row('modena', 'D', '0', '0', 'Excluded');
const dns2026 = row('perez', 'W', '0', '0', 'Did not start');

test('R3-DATA-2: a driver who withdrew after laps run started: WD, never DNS (Lauda, Fuji 1976, 2 laps)', () => {
  for (const r of [lauda1976, fittipaldi1976, comas1994]) {
    assert.equal(didNotStart(r), false, r.driver.slug);
    assert.deepEqual(resultStatusOf(r), { short: 'WD', long: 'Withdrew during the race' });
  }
});

test('R3-DATA-2: DNS only for cars that never started', () => {
  for (const r of [ratzenberger1994, barrichello1994, ireland1961, dns2026]) {
    assert.equal(didNotStart(r), true, r.driver.slug);
    assert.equal(resultStatusOf(r).short, 'DNS', r.driver.slug);
  }
  // A lap-1 retirement from a grid slot started the race.
  assert.equal(resultStatusOf(row('bearman', 'R', '13', '0', 'Collision')).short, 'RET');
  assert.equal(resultStatusOf(row('bearman', 'R', '13', '24', 'Retired')).short, 'RET');
  // An exclusion keeps the provider's code.
  assert.equal(resultStatusOf(modena1988).short, 'DSQ');
});

test('R3-DATA-3: grid 0 with no lap run is no grid slot, not a pit-lane start', () => {
  for (const r of [ratzenberger1994, barrichello1994, ireland1961, modena1988]) {
    assert.equal(isPitLaneStart(r), false, r.driver.slug);
    assert.equal(hasNoGridSlot(r), true, r.driver.slug);
    assert.equal(placesGained(r), null);
  }
  const pitLane = row('stroll', '15', '0', '55', 'Lapped');
  assert.equal(isPitLaneStart(pitLane), true);
  assert.equal(hasNoGridSlot(pitLane), false);
  assert.equal(isPitLaneStart(row('x', '1', '5', '56', 'Finished')), false);
});

test('lapped cars show "+1 lap", never the provider\'s time-like gap (2026 United States GP)', () => {
  const winnerLaps = 56;
  const lindblad = row('arvid_lindblad', '12', '14', '55', 'Lapped', { position: '12', Time: { millis: '', time: '+6.344' } } as Partial<JolpicaResultEntry>);
  const leclerc = row('leclerc', '2', '4', '56', 'Finished', { position: '2', Time: { millis: '', time: '+13.078' } } as Partial<JolpicaResultEntry>);
  const bottas = row('bottas', 'R', '19', '48', 'Retired');
  assert.deepEqual(gapText(lindblad, winnerLaps), { text: '+1 lap', timing: false });
  assert.deepEqual(gapText(leclerc, winnerLaps), { text: '+13.078', timing: true });
  assert.deepEqual(gapText(bottas, winnerLaps), { text: 'Retired', timing: false });
});
