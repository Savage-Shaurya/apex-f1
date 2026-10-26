import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NEUTRAL_TEAM_COLOUR, normaliseTeamColour, teamColoursFromTiming } from './team-colours';
import { teamColorBySlug } from './format';

test('constructor colours come from the timing feed via driver codes', () => {
  const colours = teamColoursFromTiming(
    [{ constructorSlug: 'mclaren', code: 'NOR' }, { constructorSlug: 'mclaren', code: 'PIA' }, { constructorSlug: 'cadillac', code: 'BOT' }, { constructorSlug: 'haas', code: 'OCO' }],
    [{ name_acronym: 'NOR', team_colour: 'F47600' }, { name_acronym: 'PIA', team_colour: 'F47600' }, { name_acronym: 'BOT', team_colour: '909090' }, { name_acronym: 'OCO', team_colour: 'not-a-colour' }],
  );
  assert.deepEqual(colours, { mclaren: '#F47600', cadillac: '#909090' });
  assert.equal(teamColorBySlug('mclaren', colours), '#F47600');
  // No live colour (invalid feed value, historical team or no map): neutral, never a guess.
  assert.equal(teamColorBySlug('haas', colours), NEUTRAL_TEAM_COLOUR);
  assert.equal(teamColorBySlug('brawn', colours), NEUTRAL_TEAM_COLOUR);
  assert.equal(teamColorBySlug('mclaren'), NEUTRAL_TEAM_COLOUR);
  assert.equal(teamColorBySlug(undefined, colours), NEUTRAL_TEAM_COLOUR);
});

test('team colour values are validated hex', () => {
  assert.equal(normaliseTeamColour('00d7b6'), '#00D7B6');
  assert.equal(normaliseTeamColour('#ED1131'), '#ED1131');
  assert.equal(normaliseTeamColour('red'), null);
  assert.equal(normaliseTeamColour(null), null);
});
