'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function SessionTime({ iso }: { iso: string }) {
  const local = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const date = new Date(iso);
  if (!iso || !Number.isFinite(date.getTime())) return <span>Time to be confirmed</span>;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const day = date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    return <time dateTime={iso}>{day} · Start time unknown</time>;
  }
  const text = date.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: local ? undefined : 'UTC',
    timeZoneName: 'short',
  });
  return <time dateTime={iso} title={local ? 'Your local timezone' : 'UTC until local time is available'}>{text}</time>;
}
