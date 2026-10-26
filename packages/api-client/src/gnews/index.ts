// Public surface for `@apex/api-client/gnews`.
//
// Usage:
//   import { getGNewsF1News, mapGNewsArticles } from '@apex/api-client/gnews';
//   const raw = await getGNewsF1News({ pageSize: 10, revalidate: 900 });
//   const items = mapGNewsArticles(raw);
//
// See `client.ts` for the full free-tier constraints note (12h delay,
// 100 req/day, max 10 articles/request).

export * from './types';
export * from './client';
export * from './mappers';
