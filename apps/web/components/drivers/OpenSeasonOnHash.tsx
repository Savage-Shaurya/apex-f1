'use client';

import { useEffect } from 'react';

/**
 * Opens the folded season a link points at (#season-2012 from the profile's
 * career sheet), on arrival and on later hash changes, then brings it into
 * view. Without JavaScript the season is still reached and opens on click.
 */
export function OpenSeasonOnHash() {
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!/^season-\d{4}$/.test(id)) return;
      const target = document.getElementById(id);
      const details = target?.querySelector('details');
      if (!target || !details) return;
      if (!details.open) details.open = true;
      target.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, []);
  return null;
}
