'use client';

import { useEffect, useRef, type ReactNode } from 'react';

type ScrollWindow = Window & {
  __apexScrollLocks?: number;
  __apexPreviousOverflow?: string;
};

/** Shared by overlays so closing one cannot unlock another. */
export function lockPageScroll(): () => void {
  const page = window as ScrollWindow;
  if (!page.__apexScrollLocks) {
    page.__apexPreviousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  page.__apexScrollLocks = (page.__apexScrollLocks ?? 0) + 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    page.__apexScrollLocks = Math.max(0, (page.__apexScrollLocks ?? 1) - 1);
    if (!page.__apexScrollLocks) {
      document.body.style.overflow = page.__apexPreviousOverflow ?? '';
      delete page.__apexPreviousOverflow;
    }
  };
}

/** Native top-layer dialog supplies focus containment and background inertness. */
export function ModalDialog({
  children,
  label,
  onClose,
}: {
  children: ReactNode;
  label: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const unlock = lockPageScroll();
    dialog.showModal();
    return () => {
      dialog.close();
      unlock();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-y-auto border-0 bg-transparent p-0 text-on-background backdrop:bg-background/70"
    >
      {children}
    </dialog>
  );
}
