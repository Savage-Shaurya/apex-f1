import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge taught the Apex theme. Without this, custom type steps such
 * as `text-display-xl` look like colours and get dropped when a colour class
 * (`text-fg`) follows, and the Anybody width classes (`font-wide`) look like a
 * font family and evict `font-display`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        'display-xl', 'display-l', 'display-m', 'heading-l', 'heading-m', 'heading-s',
        'lead', 'body', 'ui', 'small', 'caption', 'label', 'label-l', 'stat-xl', 'stat-l', 'stat-m',
        'mega', 'giant', 'huge', 'title',
      ],
      font: ['display', 'headline', 'text', 'body', 'editorial', 'data', 'timing'],
      tracking: ['text', 'label'],
    },
    classGroups: {
      'font-stretch': ['font-condensed', 'font-normal-width', 'font-semi-wide', 'font-wide', 'font-ultrawide'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
