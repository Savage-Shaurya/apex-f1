import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CIRCUIT_TIME_ZONES } from './circuits/timezones';
import { KNOWN_CIRCUIT_IDS } from './circuits/known-ids';
import { circuitTimeZone } from '../components/race/circuit-timezones';

test('every Jolpica circuit id has a valid IANA zone', () => {
  for (const id of KNOWN_CIRCUIT_IDS) {
    const zone = CIRCUIT_TIME_ZONES[id];
    assert.ok(zone, id);
    assert.doesNotThrow(() => new Intl.DateTimeFormat('en-GB', { timeZone: zone }), id);
  }
});

test('R3-CODE-6: pages resolve every circuit through the one table, with no country needed', () => {
  for (const id of KNOWN_CIRCUIT_IDS) assert.equal(circuitTimeZone(id), CIRCUIT_TIME_ZONES[id], id);
  // A circuit Jolpica adds before the table knows it still falls back by country.
  assert.equal(circuitTimeZone('new_street_circuit', 'Singapore'), 'Asia/Singapore');
  assert.equal(circuitTimeZone('nowhere', 'Atlantis'), null);
});
