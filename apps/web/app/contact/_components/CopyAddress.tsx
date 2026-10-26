'use client';

import { useState } from 'react';
import { Button } from '@/components/ds';

/** Copies the inbox address; reports success or failure in words, never assumes it worked. */
export function CopyAddress({ address }: { address: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setState('copied');
    } catch {
      setState('failed');
    }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-2">
      <Button variant="secondary" leadingIcon={state === 'copied' ? 'check' : undefined} onClick={copy}>
        {state === 'copied' ? 'Address copied' : 'Copy address'}
      </Button>
      <span role="status" className="font-text text-small text-fg-2">
        {state === 'failed' ? 'Your browser blocked copying. Select the address above instead.' : ''}
      </span>
    </span>
  );
}
