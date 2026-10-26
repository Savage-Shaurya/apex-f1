/**
 * Currents API raw response shapes.
 * Docs: https://currentsapi.services/en/docs/
 */

export interface CurrentsNewsItem {
  id: string;
  title: string;
  description: string;
  url: string;
  author?: string;
  image?: string;
  /** ISO 639-1 e.g. "en" / "it" / "es" / "de" / "fr" / "pt" */
  language: string;
  /** Array of strings · F1 items typically include "sports" */
  category: string[];
  /** Source domain key, e.g. "espn-com" */
  source_category?: string;
  /** ISO timestamp e.g. "2026-06-21 18:45:00 +0000" */
  published: string;
}

export interface CurrentsSearchEnvelope {
  status: 'ok' | 'error';
  news: CurrentsNewsItem[];
  page?: number;
}

export interface CurrentsSearchParams {
  /** Search keyword query string. */
  keywords?: string;
  /** ISO 639-1 language code. */
  language?: string;
  /** ISO 3166 country code. */
  country?: string;
  /** Category filter · Currents uses single string here, e.g. "sports". */
  category?: string;
  /** Domain filter. */
  domain?: string;
  /** Inclusive ISO date e.g. "2026-06-01". */
  startDate?: string;
  endDate?: string;
  /** 1-indexed page; Currents defaults to 1. */
  page?: number;
}
