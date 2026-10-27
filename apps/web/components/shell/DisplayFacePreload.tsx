'use client';

import { preload } from 'react-dom';
import { usePathname } from 'next/navigation';
import { DISPLAY_FACE_URL, preloadsDisplayFace } from './display-face';

/** Preloads the display face in the server HTML of every route except home (see display-face.ts). */
export function DisplayFacePreload() {
  const pathname = usePathname();
  if (preloadsDisplayFace(pathname)) {
    preload(DISPLAY_FACE_URL, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  }
  return null;
}
