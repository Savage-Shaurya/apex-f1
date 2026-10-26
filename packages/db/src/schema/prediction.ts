import {
  pgTable,
  text,
  uuid,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { race } from './race';

/** Driver picks for the four scorable questions. Values are Jolpica driverIds. */
export interface PredictionPicks {
  pole?: string;
  winner?: string;
  fastest_lap?: string;
  podium?: string;
}

/**
 * One anonymous fan's prediction for one race. Identity is a random cookie id
 * (apex_pid) — no login required. `score` is null until the race is scored
 * against the real Jolpica result.
 */
export const prediction = pgTable(
  'prediction',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: text('client_id').notNull(),
    handle: text('handle'),
    season: integer('season').notNull(),
    round: integer('round').notNull(),
    raceSlug: text('race_slug').notNull(),
    picks: jsonb('picks').$type<PredictionPicks>().notNull(),
    score: integer('score'),
    scoredAt: timestamp('scored_at', { withTimezone: true }),
    // Version of the authoritative result/qualifying inputs used to grade.
    // A score and its timestamp are meaningful only alongside this version.
    scoreSourceVersion: text('score_source_version'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    clientRaceUq: uniqueIndex('prediction_client_race_uq').on(t.clientId, t.season, t.round),
    raceIdx: index('prediction_race_idx').on(t.season, t.round),
    raceCursorIdx: index('prediction_race_cursor_idx').on(t.season, t.round, t.id),
    scoreIdx: index('prediction_score_idx').on(t.score),
    raceFk: foreignKey({
      name: 'prediction_season_round_race_fk',
      columns: [t.season, t.round],
      foreignColumns: [race.seasonYear, race.round],
    }).onDelete('restrict'),
    scoreLifecycleCheck: check(
      'prediction_score_lifecycle_check',
      sql`(
        (${t.score} IS NULL AND ${t.scoredAt} IS NULL AND ${t.scoreSourceVersion} IS NULL)
        OR (${t.score} IS NOT NULL AND ${t.score} >= 0 AND ${t.score} <= 13 AND ${t.scoredAt} IS NOT NULL
          AND ${t.scoreSourceVersion} IS NOT NULL AND length(btrim(${t.scoreSourceVersion})) > 0)
      )`,
    ),
    identityCheck: check('prediction_identity_check', sql`length(${t.clientId}) between 1 and 128 and ${t.season} between 1950 and 2200 and ${t.round} between 1 and 40 and length(${t.raceSlug}) between 1 and 160 and (${t.handle} is null or length(${t.handle}) <= 64)`),
    picksCheck: check('prediction_picks_check', sql`jsonb_typeof(${t.picks}) = 'object'
      and (${t.picks} - array['pole','winner','podium','fastest_lap']) = '{}'::jsonb
      and (not (${t.picks} ? 'pole') or (jsonb_typeof(${t.picks}->'pole')='string' and length(${t.picks}->>'pole') between 1 and 64))
      and (not (${t.picks} ? 'winner') or (jsonb_typeof(${t.picks}->'winner')='string' and length(${t.picks}->>'winner') between 1 and 64))
      and (not (${t.picks} ? 'podium') or (jsonb_typeof(${t.picks}->'podium')='string' and length(${t.picks}->>'podium') between 1 and 64))
      and (not (${t.picks} ? 'fastest_lap') or (jsonb_typeof(${t.picks}->'fastest_lap')='string' and length(${t.picks}->>'fastest_lap') between 1 and 64))`),
  }),
);
