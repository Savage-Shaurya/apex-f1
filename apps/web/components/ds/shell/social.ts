/**
 * Where to follow Apex and its maker (owner's list, 2026-10-26). Used by the
 * footer, About and Give back. No GitHub: the owner asked for it not to be
 * shown.
 */
export interface SocialLink {
  id: 'instagram' | 'x' | 'linkedin' | 'email';
  label: string;
  handle: string;
  href: string;
  /** Full accessible name, including that external links open a new tab. */
  accessibleName: string;
}

export const SOCIAL_LINKS: readonly SocialLink[] = [
  { id: 'instagram', label: 'Instagram', handle: '@snappy_leader', href: 'https://www.instagram.com/snappy_leader/', accessibleName: 'Instagram, @snappy_leader (opens in a new tab)' },
  { id: 'x', label: 'X', handle: '@SnappyLeader', href: 'https://x.com/SnappyLeader', accessibleName: 'X, @SnappyLeader (opens in a new tab)' },
  { id: 'linkedin', label: 'LinkedIn', handle: 'Shaurya Punj', href: 'https://www.linkedin.com/in/shaurya-punj-86a3b4444/', accessibleName: 'LinkedIn, Shaurya Punj (opens in a new tab)' },
  { id: 'email', label: 'Email', handle: 'shaurya@snappycrew.com', href: 'mailto:shaurya@snappycrew.com', accessibleName: 'Email shaurya@snappycrew.com' },
];

export const socialLink = (id: SocialLink['id']): SocialLink => SOCIAL_LINKS.find((s) => s.id === id)!;
