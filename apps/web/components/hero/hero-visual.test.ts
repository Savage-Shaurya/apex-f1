import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickHeroTiles, pickHeroTilesFrom, teamHeroVisual, type HeroTile } from './hero-visual';

const story = (n: number, imageUrl: string | null, href = `https://x.test/${n}`) => ({ n, imageUrl, href, title: `Story ${n}` });
const toTile = (s: ReturnType<typeof story>): HeroTile | null => (s.imageUrl ? { key: s.href, src: s.imageUrl, href: s.href, title: s.title } : null);

test('HNV-3: the hero takes the newest stories that have a picture, never an empty hero when one exists', () => {
  const items = [story(1, null), story(2, 'https://img.test/2.jpg'), story(3, null), story(4, 'https://img.test/4.jpg'), story(5, 'https://img.test/5.jpg'), story(6, 'https://img.test/6.jpg')];
  assert.deepEqual(pickHeroTiles(items, toTile).map((t) => t.title), ['Story 2', 'Story 4', 'Story 5']);
  assert.equal(pickHeroTiles([story(1, null), story(2, 'https://img.test/2.jpg')], toTile).length, 1);
});

test('HNV-3: no picture at all gives no tiles (the hero falls back to type, it never invents one)', () => {
  assert.deepEqual(pickHeroTiles([story(1, null), story(2, null)], toTile), []);
  assert.deepEqual(pickHeroTiles([story(1, 'javascript:alert(1)')], toTile), []);
});

test('HNV-3: syndicated copies (same picture or same link) appear once', () => {
  const items = [story(1, 'https://img.test/a.jpg'), story(2, 'https://img.test/a.jpg'), story(3, 'https://img.test/c.jpg', 'https://x.test/1')];
  assert.equal(pickHeroTiles(items, toTile).length, 1);
});

test('HNV-3: a thin first pool is topped up from the next one', () => {
  const tiles = pickHeroTilesFrom([[story(1, 'https://img.test/1.jpg')], [story(7, 'https://img.test/7.jpg'), story(8, 'https://img.test/8.jpg')]], toTile);
  assert.deepEqual(tiles.map((t) => t.title), ['Story 1', 'Story 7', 'Story 8']);
});

test('TEAMS-2/3: a team hero always has a visual: F1 car, else Commons photo, else the livery emblem', () => {
  assert.equal(teamHeroVisual({ car: 'https://media.formula1.com/car.webp', photo: '/media/commons/x.jpg' }), 'car');
  assert.equal(teamHeroVisual({ car: null, photo: '/media/commons/x.jpg' }), 'photo');
  assert.equal(teamHeroVisual({ car: null, photo: null }), 'emblem');
});
