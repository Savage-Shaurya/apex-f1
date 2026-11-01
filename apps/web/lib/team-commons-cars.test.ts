import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TEAM_COMMONS_CARS, teamCarAlt, teamCommonsCar } from './team-commons-cars';

test('TEAMS-3: historic teams have a hand-picked Commons car photo', () => {
  for (const id of ['team_lotus', 'lotus_f1', 'brabham', 'tyrrell', 'cooper', 'march', 'benetton', 'jordan', 'brawn']) {
    const car = teamCommonsCar(id);
    assert.ok(car, id);
    assert.match(car.file, /\.(jpe?g)$/i, `${id} is a raster photo`);
    assert.doesNotMatch(car.file, /^File:/, `${id} file name has no prefix`);
  }
});

test('TEAMS-3: current teams and unknown ids get no Commons photo (F1 media cars win)', () => {
  for (const id of ['ferrari', 'mclaren', 'mercedes', 'red_bull', 'williams', 'aston_martin', 'alpine', 'haas', 'rb', 'audi', 'cadillac', 'lotus', '', null, undefined, '__proto__', 'constructor', 'toString']) {
    assert.equal(teamCommonsCar(id as string), null, String(id));
  }
});

test('TEAMS-3: every pick is a photo file, unique, with a car name for the alt text', () => {
  const files = Object.values(TEAM_COMMONS_CARS).map((c) => c.file);
  assert.equal(new Set(files).size, files.length);
  for (const [id, c] of Object.entries(TEAM_COMMONS_CARS)) {
    assert.ok(c.car.length > 2, id);
    assert.doesNotMatch(c.file, /\.(svg|png|gif)$/i, id);
    assert.doesNotMatch(c.file, /logo/i, id);
  }
  assert.equal(teamCarAlt('Team Lotus', TEAM_COMMONS_CARS.team_lotus!), 'Lotus 72, a Team Lotus Formula 1 car');
});
