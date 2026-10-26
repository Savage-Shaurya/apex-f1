import { cache } from 'react';
import { getF1NewsFeed } from '@apex/api-client/rss';

/**
 * Shared home-page RSS loader.
 *
 * The hero (5 leads), the wire rail (5 items), and Editors' Picks all draw from
 * the same F1 news feed. Wrapping the fetch in React `cache()` collapses what
 * used to be three separate aggregations into ONE per request · every consumer
 * awaits the same promise and slices what it needs. Combined with the Suspense
 * boundaries around the consuming sections, each region can stream as its
 * data resolves. Shell streaming is owned by its own layout boundaries.
 */
export const getHomeFeed = cache(() => getF1NewsFeed({ limit: 40, revalidate: 300, enrichImages: false }));
