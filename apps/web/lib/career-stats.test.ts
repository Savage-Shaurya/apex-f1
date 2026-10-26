import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregateCareer, bestClassifiedFinish, careerInputForRace, fastestLapDisplay, primaryRaceResult, type CareerResultInput } from './career-stats';

const race = (season: number, position: number | null, extra: Partial<CareerResultInput> = {}): CareerResultInput => ({ season, position, grid: null, points: 0, fastestLapRank: null, ...extra });

test('totals count wins, podiums, P1 grid starts and points', () => {
  const totals = aggregateCareer([race(2010, 1, { grid: 1, points: 25, fastestLapRank: 1 }), race(2010, 3, { points: 15 }), race(2011, 12, { points: 0.5 })]);
  assert.deepEqual([totals.entries, totals.wins, totals.podiums, totals.gridP1Starts, totals.points], [3, 1, 2, 1, 40.5]);
  assert.deepEqual(totals.fastestLaps, { recorded: 1, coverage: 'full', entriesWithoutRecords: 0 });
  assert.deepEqual(fastestLapDisplay(totals, 99), { value: 1 });
});

test('a pre-2004 career never shows a false 0 fastest laps', () => {
  const senna = aggregateCareer([race(1988, 1), race(1993, 1)]);
  assert.equal(senna.fastestLaps.coverage, 'none');
  assert.equal(fastestLapDisplay(senna, 19).value, 19);
  assert.match(fastestLapDisplay(senna, 19).sub ?? '', /^Career total/);
  assert.doesNotMatch(fastestLapDisplay(senna, 19).sub ?? '', /Wikipedia|Jolpica/);
  assert.deepEqual(fastestLapDisplay(senna, null), { value: 'n/a', sub: 'Not recorded before 2004' });
});

test('a career spanning 2004 uses the infobox total when it covers the recorded laps, else a labelled partial count', () => {
  const schumacher = aggregateCareer([race(2000, 1), race(2004, 1, { fastestLapRank: 1 }), race(2004, 1, { fastestLapRank: 1 })]);
  assert.deepEqual(schumacher.fastestLaps, { recorded: 2, coverage: 'partial', entriesWithoutRecords: 1 });
  assert.equal(fastestLapDisplay(schumacher, 77).value, 77);
  assert.deepEqual(fastestLapDisplay(schumacher, 1), { value: 2, sub: '2004 onward only · earlier laps not recorded' });
  assert.deepEqual(fastestLapDisplay(schumacher, null).value, 2);
});

test('best season finish ignores retirements Jolpica still orders with a number', () => {
  // Senna 1994: three retirements carry Jolpica order positions (e.g. 13) with positionText "R".
  assert.equal(bestClassifiedFinish([{ position: 13, positionText: 'R' }, { position: 18, positionText: 'R' }]), null);
  assert.equal(bestClassifiedFinish([{ position: 12, positionText: 'R' }, { position: 4, positionText: '4' }, { position: null, positionText: '·' }]), 4);
  assert.equal(bestClassifiedFinish([{ position: 1, positionText: '1' }, { position: 3, positionText: '3' }]), 1);
  assert.equal(bestClassifiedFinish([]), null);
});

test('a shared drive counts once: best classified car, summed points, any P1 grid or fastest lap', () => {
  // Fangio, 1956 Argentine GP: own car retired (order 15, "R", grid 1); won in Musso's car (shared, 4 points).
  const own = { position: 15, positionText: 'R', grid: 1, points: 0, fastestLap: undefined };
  const swapped = { position: 1, positionText: '1', grid: 9, points: 4, fastestLap: { rank: 1 } };
  assert.equal(primaryRaceResult([own, swapped]), swapped);
  assert.deepEqual(careerInputForRace(1956, [own, swapped]), { season: 1956, position: 1, grid: 1, points: 4, fastestLapRank: 1 });
  const totals = aggregateCareer([careerInputForRace(1956, [own, swapped])!]);
  assert.deepEqual([totals.entries, totals.wins, totals.podiums, totals.gridP1Starts], [1, 1, 1, 1]);
});

test('an unclassified entry is never a win or podium even when Jolpica orders it 3rd', () => {
  const retired = careerInputForRace(1950, [{ position: 3, positionText: 'R', grid: 2, points: 0 }])!;
  assert.equal(retired.position, null);
  assert.equal(aggregateCareer([retired]).podiums, 0);
  assert.equal(careerInputForRace(1950, []), null);
  assert.equal(primaryRaceResult([{ position: 12, positionText: 'R' }, { position: 9, positionText: 'D' }])?.position, 9);
});
