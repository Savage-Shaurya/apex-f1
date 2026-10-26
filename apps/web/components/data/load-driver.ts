import { cache } from 'react';
import { readDriverIdentity } from '@/lib/public-sport';

/** Metadata and page share the same strict lookup during one server render. */
export const loadDriver = cache(readDriverIdentity);
