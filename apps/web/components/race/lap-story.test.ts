import assert from 'node:assert/strict';
import test from 'node:test';

const drv = (id: string) => ({ id, firstName: id, lastName: id.toUpperCase(), slug: id });

test('lap story joins lap timings with the classification; retirements end the line, nothing is interpolated', async () => {
  const { buildLapStory, lapsRun, placesFromGrid, lapStoryFacts } = await import('./lap-story');
  const laps = [
    { number: '2', Timings: [{ driverId: 'b', position: '1' }, { driverId: 'a', position: '2' }] },
    { number: '1', Timings: [{ driverId: 'a', position: '1' }, { driverId: 'b', position: '2' }, { driverId: 'c', position: '3' }] },
    { number: '3', Timings: [{ driverId: 'b', position: '1' }, { driverId: 'a', position: '2' }] },
  ];
  const results = [
    { driver: drv('b'), positionText: '1', grid: 2 },
    { driver: drv('a'), positionText: '2', grid: 1 },
    { driver: drv('c'), positionText: 'R', grid: 0 },
  ];
  const story = buildLapStory(laps, results, [{ driverId: 'a', lap: '2' }, { driverId: 'a', lap: 'x' }])!;
  assert.equal(story.laps, 3);
  assert.deepEqual(story.drivers.map((d) => d.id), ['b', 'a', 'c']);
  assert.deepEqual(story.drivers[2]!.positions, [3, null, null]);
  assert.equal(lapsRun(story.drivers[2]!), 1);
  assert.deepEqual(story.drivers[1]!.pitLaps, [2]);
  assert.equal(placesFromGrid(story.drivers[0]!, story.field), 1);
  // A pit-lane start counts from the back of the field.
  assert.equal(placesFromGrid(story.drivers[2]!, story.field), 0);
  assert.deepEqual(lapStoryFacts(story), { leaders: ['a', 'b'], leadChanges: 1 });
});

test('no laps from the provider means no lap story', async () => {
  const { buildLapStory } = await import('./lap-story');
  assert.equal(buildLapStory([], [{ driver: drv('a'), positionText: '1', grid: 1 }]), null);
});
