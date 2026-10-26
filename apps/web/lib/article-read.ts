import { cache } from 'react';
import { getArticleBySlug } from '@apex/db';

// React cache is scoped to one server render, never a persistent visibility cache.
export const getRequestArticleBySlug = cache(getArticleBySlug);
