import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  byDecade, careerRecords, careerSeasons, cleanName, finishBand, formatPoints, indexLetter, ordinal,
  placeLabel, raceLabel, regularPair, searchKey, surnameStep, teamMateDuel, teamsLine, yearRuns, type RaceRow, type RaceRows,
} from './people';

const row = (driver: string, position: number | null, extra: Omit<Partial<RaceRow>, 'constructor'> = {}): RaceRow => ({
  position,
  positionText: position === null ? 'R' : String(position),
  points: 0,
  grid: null,
  status: position === null ? 'Retired' : 'Finished',
  driver: { slug: driver, fullName: driver.toUpperCase() },
  constructor: { slug: 'mclaren', name: 'McLaren' },
  ...extra,
});
const race = (season: number, round: number, rows: RaceRow[], raceName = `Race ${round}`): RaceRows => ({ season, round, raceName, country: 'X', rows });

test('careerSeasons groups by season, counts shared drives once and sums their points', () => {
  const seasons = careerSeasons(
    [
      race(1951, 2, [row('fangio', 1, { points: 8, grid: 1 })]),
      race(1951, 1, [row('fangio', 4, { points: 1.5 }), row('fangio', 2, { points: 3 })]),
      race(1952, 1, [row('fangio', null)]),
    ],
    () => '#ff8000',
  );
  assert.equal(seasons.length, 2);
  assert.deepEqual(seasons.map((s) => s.year), [1951, 1952]);
  const first = seasons[0]!;
  assert.equal(first.starts, 2);
  assert.equal(first.wins, 1);
  assert.equal(first.podiums, 2);
  assert.equal(first.points, 12.5);
  assert.equal(first.best, 1);
  assert.deepEqual(first.races.map((r) => r.round), [1, 2]);
  assert.equal(first.races[0]!.finish, 2);
  assert.equal(seasons[1]!.best, null);
  assert.equal(first.teams[0]!.color, '#ff8000');
});

test('finishBand names every outcome', () => {
  assert.equal(finishBand({ finish: 1, points: 25 }), 'win');
  assert.equal(finishBand({ finish: 3, points: 15 }), 'podium');
  assert.equal(finishBand({ finish: 10, points: 1 }), 'points');
  assert.equal(finishBand({ finish: 7, points: 0 }), 'points');
  assert.equal(finishBand({ finish: 14, points: 0 }), 'finish');
  assert.equal(finishBand({ finish: null, points: 0 }), 'out');
});

test('careerRecords finds the first win, first P1 start, best season and points streak', () => {
  const seasons = careerSeasons(
    [
      race(2020, 1, [row('x', 5, { points: 10 })]),
      race(2020, 2, [row('x', 1, { points: 25, grid: 1 })]),
      race(2020, 3, [row('x', null)]),
      race(2021, 1, [row('x', 1, { points: 25 })]),
      race(2021, 2, [row('x', 1, { points: 25 })]),
      race(2021, 3, [row('x', 2, { points: 18 })]),
    ],
    () => '#000',
  );
  const r = careerRecords(seasons);
  assert.equal(r.firstWin?.season, 2020);
  assert.equal(r.firstWin?.round, 2);
  assert.equal(r.firstStartP1?.round, 2);
  assert.equal(r.bestSeason?.year, 2021);
  assert.equal(r.longestPointsStreak, 3);
});

test('teamMateDuel compares only shared races and labels grid and finish separately', () => {
  const races = [
    race(2026, 1, [row('ant', 1, { points: 25, grid: 2 }), row('rus', 2, { points: 18, grid: 1 })]),
    race(2026, 2, [row('ant', null, { grid: 0, laps: 12 }), row('rus', 4, { points: 12, grid: 5 })]),
    race(2026, 3, [row('ant', 3, { points: 15, grid: 3 })]),
  ];
  const duel = teamMateDuel(races, 'ant', 'rus')!;
  assert.equal(duel.races, 2);
  assert.equal(duel.bothClassified, 1);
  assert.equal(duel.a.finishAhead, 1);
  assert.equal(duel.b.finishAhead, 0);
  assert.equal(duel.bothGridded, 2);
  assert.equal(duel.a.gridAhead, 0);
  assert.equal(duel.b.gridAhead, 2, 'a pit-lane start (grid 0) counts as behind');
  assert.equal(duel.a.points, 40, 'points include races the other driver missed');
  assert.equal(duel.a.wins, 1);
  assert.equal(duel.b.best, 2);
  assert.equal(teamMateDuel(races, 'ant', 'nobody'), null);
  // R3-DATA-3: grid 0 with no lap run is a non-starter (no grid slot), not a pit-lane start.
  const nonStarter = teamMateDuel([race(1994, 3, [row('barrichello', null, { grid: 0, laps: 0, status: 'Injury' }), row('brundle', 3, { grid: 14, laps: 58 })])], 'barrichello', 'brundle')!;
  assert.equal(nonStarter.bothGridded, 0);
  assert.equal(nonStarter.b.gridAhead, 0);
});

test('regularPair picks the two drivers with most starts', () => {
  const races = [
    race(2026, 1, [row('a', 1), row('b', 2)]),
    race(2026, 2, [row('a', 1), row('c', 2)]),
    race(2026, 3, [row('a', 1), row('b', 2)]),
  ];
  assert.deepEqual(regularPair(races), ['a', 'b']);
  assert.equal(regularPair([race(2026, 1, [row('a', 1)])]), null);
});

test('yearRuns writes title runs the way a programme does', () => {
  assert.equal(yearRuns([2020, 2008, 2014, 2015, 2017, 2018, 2019]), '2008, 2014–15, 2017–20');
  assert.equal(yearRuns([1999, 2000, 2001]), '1999–2001');
  assert.equal(yearRuns([1950]), '1950');
  assert.equal(yearRuns([]), '');
});

test('byDecade orders newest decade and year first', () => {
  const groups = byDecade([{ year: 1950 }, { year: 2025 }, { year: 2021 }, { year: 1959 }]);
  assert.deepEqual(groups.map((g) => g.decade), [2020, 1950]);
  assert.deepEqual(groups[0]!.rows.map((r) => r.year), [2025, 2021]);
});

test('indexLetter files particles and accents under the main surname letter', () => {
  assert.equal(indexLetter('de Graffenried'), 'G');
  assert.equal(indexLetter('Hülkenberg'), 'H');
  assert.equal(indexLetter('Ödegaard'), 'O');
  assert.equal(indexLetter('van der Garde'), 'G');
  assert.equal(indexLetter('Montgomerie-Charrington'), 'M');
});

test('searchKey folds accents and punctuation', () => {
  assert.equal(searchKey('Kimi Räikkönen'), 'kimi raikkonen');
  assert.equal(searchKey('  Jean-Éric  Vergne '), 'jean eric vergne');
});

test('surnameStep steps long surnames down so they never clip', () => {
  assert.equal(surnameStep('Norris'), 'display-xl');
  assert.equal(surnameStep('Verstappen'), 'display-l');
  assert.equal(surnameStep('Antonelli'), 'display-xl');
  assert.equal(surnameStep('Montgomerie-Charrington'), 'display-l');
  assert.equal(surnameStep('Fotheringhamparker'), 'display-m');
});

test('text helpers keep provider names whole and decoded', () => {
  assert.equal(cleanName('Lotus-Pratt &amp; Whitney'), 'Lotus-Pratt & Whitney');
  assert.equal(raceLabel('Bahrain Grand Prix in Malaysia'), 'Bahrain Grand Prix in Malaysia');
  assert.equal(ordinal(1), '1st');
  assert.equal(ordinal(12), '12th');
  assert.equal(ordinal(22), '22nd');
  assert.equal(formatPoints(12), '12');
  assert.equal(formatPoints(4.5), '4.5');
  assert.equal(formatPoints(0.14), '0.14');
});

test('teamsLine lists teams in the order first driven for, folding extras', () => {
  const s = (year: number, ...names: string[]) => ({ year, teams: names.map((n) => ({ slug: n.toLowerCase(), name: n, color: '#888888' })), races: [], starts: 0, wins: 0, podiums: 0, points: 0, best: null });
  assert.equal(teamsLine([s(1984, 'Toleman'), s(1985, 'Lotus'), s(1988, 'McLaren'), s(1994, 'Williams')]), 'Toleman, Lotus, McLaren, Williams');
  assert.equal(teamsLine([s(1, 'A', 'B'), s(2, 'B', 'C'), s(3, 'D', 'E'), s(4, 'F')]), 'A, B, C, D and 2 more');
});

test('placeLabel keeps the city from a building-level Wikidata birthplace', () => {
  assert.equal(placeLabel('maternity hospital of São Paulo'), 'São Paulo');
  assert.equal(placeLabel('Stevenage'), 'Stevenage');
  assert.equal(placeLabel('  '), null);
  assert.equal(placeLabel(null), null);
});

test('careerSeasons passes the season to the colour lookup', () => {
  const seen: Array<[string, number]> = [];
  careerSeasons([race(2010, 1, [row('a', 1)]), race(2026, 1, [row('a', 2)])], (slug, season) => { seen.push([slug, season]); return season === 2026 ? '#FF8000' : '#8A8D91'; });
  assert.deepEqual(seen, [['mclaren', 2010], ['mclaren', 2026]]);
});

test('secureReferenceUrl upgrades Wikimedia links to https and leaves others alone (SEO-9)', async () => {
  const { secureReferenceUrl } = await import('./people');
  assert.equal(secureReferenceUrl('http://en.wikipedia.org/wiki/Lando_Norris'), 'https://en.wikipedia.org/wiki/Lando_Norris');
  assert.equal(secureReferenceUrl('http://www.wikidata.org/wiki/Q123'), 'https://www.wikidata.org/wiki/Q123');
  assert.equal(secureReferenceUrl('https://en.wikipedia.org/wiki/Kimi_R%C3%A4ikk%C3%B6nen'), 'https://en.wikipedia.org/wiki/Kimi_R%C3%A4ikk%C3%B6nen');
  assert.equal(secureReferenceUrl('http://example.com/x'), 'http://example.com/x');
  assert.equal(secureReferenceUrl(''), null);
  assert.equal(secureReferenceUrl(null), null);
});

test('resultWords never calls a classified retirement a finish (D2-DATA-TRUTH-7)', async () => {
  const { resultWords, tookTheFlag } = await import('./people');
  assert.equal(resultWords({ finish: 20, status: 'Retired', positionText: '20' }), 'Classified P20, retired');
  assert.equal(resultWords({ finish: 4, status: 'Finished', positionText: '4' }), 'Finished P4');
  assert.equal(resultWords({ finish: 12, status: '+1 Lap', positionText: '12' }), 'Finished P12');
  assert.equal(resultWords({ finish: null, status: 'Engine', positionText: 'R' }), 'Engine');
  assert.equal(tookTheFlag('+3 Laps'), true);
  assert.equal(tookTheFlag('Collision'), false);
});

test('directorySearch keeps the directory filters in the URL (D2-CLICK-PATHS-1)', async () => {
  const { directorySearch } = await import('./people');
  assert.equal(directorySearch(new URLSearchParams(''), { q: 'senna', letter: '', nationality: '' }), '?q=senna');
  assert.equal(directorySearch(new URLSearchParams('q=old&utm=x'), { q: '', letter: 'S', nationality: 'Brazilian' }), '?utm=x&letter=S&nationality=Brazilian');
  assert.equal(directorySearch(new URLSearchParams('q=a'), { q: '', letter: '', nationality: '' }), '');
});
