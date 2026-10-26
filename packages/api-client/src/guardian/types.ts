/**
 * Raw response types for The Guardian Open Platform Content API.
 *
 * Docs: https://open-platform.theguardian.com/documentation/
 *
 * Base URL: https://content.guardianapis.com
 * Auth:     ?api-key=<GUARDIAN_API_KEY>  (query string)
 * Rate:     5,000 req/day on the dev tier
 *
 * Example call we wire below:
 *   GET /search
 *     ?q=formula+1
 *     &section=sport
 *     &tag=sport/formula-one
 *     &show-fields=trailText,thumbnail,byline,bodyText
 *     &page-size=20
 *     &order-by=newest
 *     &api-key=<key>
 *
 * Top-level envelope is always { response: {...} }. We keep field names
 * verbatim so the raw types document the wire shape exactly.
 */

/** Categorical labels Guardian assigns ('article', 'liveblog', 'gallery'...) */
export type GuardianContentType =
  | 'article'
  | 'liveblog'
  | 'gallery'
  | 'video'
  | 'audio'
  | 'interactive'
  | 'picture'
  | 'crossword';

/** Sort orders the /search endpoint accepts. */
export type GuardianOrderBy = 'newest' | 'oldest' | 'relevance';

/** Optional show-fields names we may request. Guardian returns whichever exist. */
export type GuardianShowField =
  | 'trailText'
  | 'thumbnail'
  | 'byline'
  | 'bodyText'
  | 'body'
  | 'headline'
  | 'standfirst'
  | 'main'
  | 'wordcount'
  | 'lastModified'
  | 'publication'
  | 'shortUrl';

/** The "fields" object on a result is sparse: only requested fields are present. */
export interface GuardianFields {
  trailText?: string;
  thumbnail?: string;
  byline?: string;
  bodyText?: string;
  body?: string;
  headline?: string;
  standfirst?: string;
  main?: string;
  wordcount?: string;
  lastModified?: string;
  publication?: string;
  shortUrl?: string;
}

/** Tag entries (sections, contributors, keywords). Useful for filtering. */
export interface GuardianTag {
  id: string;
  type: string;
  webTitle: string;
  webUrl: string;
  apiUrl: string;
  sectionId?: string;
  sectionName?: string;
}

/** A single content item in the search results. */
export interface GuardianContentItem {
  id: string;
  type: GuardianContentType;
  sectionId: string;
  sectionName: string;
  webPublicationDate: string; // ISO 8601
  webTitle: string;
  webUrl: string;
  apiUrl: string;
  isHosted: boolean;
  pillarId?: string;
  pillarName?: string;
  fields?: GuardianFields;
  tags?: GuardianTag[];
}

/** The "response" block inside the envelope. */
export interface GuardianSearchResponseBody {
  status: 'ok' | 'error';
  userTier: string;
  total: number;
  startIndex: number;
  pageSize: number;
  currentPage: number;
  pages: number;
  orderBy: GuardianOrderBy;
  results: GuardianContentItem[];
  message?: string; // present on error
}

/** Full top-level envelope: { response: {...} } */
export interface GuardianSearchEnvelope {
  response: GuardianSearchResponseBody;
}

/** Strongly-typed params for the /search endpoint. */
export interface GuardianSearchParams {
  q?: string;
  section?: string;
  tag?: string;
  pageSize?: number;
  page?: number;
  orderBy?: GuardianOrderBy;
  showFields?: GuardianShowField[];
  fromDate?: string; // YYYY-MM-DD
  toDate?: string; // YYYY-MM-DD
  lang?: string;
}
