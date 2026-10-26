import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL;

if (!url) {
  // Drizzle-kit reads this file at CLI time; allow falsy in CI / dry builds.
  // eslint-disable-next-line no-console
  console.warn('[drizzle.config] DATABASE_URL not set. Generate/migrate will fail until provided.');
}

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url: url ?? '' },
  strict: true,
  verbose: true,
});
