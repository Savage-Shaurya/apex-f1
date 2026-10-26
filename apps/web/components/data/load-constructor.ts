import { cache } from 'react';
import { readConstructorIdentity } from '@/lib/public-sport';

/** One constructor lookup shared by metadata and page content for this render. */
export const loadConstructor = cache(readConstructorIdentity);
