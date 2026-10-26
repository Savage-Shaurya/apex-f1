// Public surface for @apex/api-client/newsapi.
//
// SERVER-ONLY. Do not import from a "use client" component. NewsAPI's free
// tier rejects browser-originated requests with CORS preflight failures and
// blocks production-domain Origin headers with `corsNotAllowed`. See
// ./client.ts for the full caveat.

export { getNewsAPIF1News } from './client';
export {
  mapNewsAPIArticleToUi,
  mapNewsAPIArticlesToUi,
  type UiNewsItem,
} from './mappers';
export {
  NEWSAPI_F1_QUERY,
  type NewsAPIArticle,
  type NewsAPIEverythingError,
  type NewsAPIEverythingOk,
  type NewsAPIEverythingResponse,
  type NewsAPISortBy,
  type NewsAPISource,
  type NewsAPIStatus,
  type GetNewsAPIF1NewsOptions,
} from './types';
