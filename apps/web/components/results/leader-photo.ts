import { mapDriverStanding } from '@apex/api-client/jolpica';
import { championPortraits } from '@/components/drivers/data/champion-portraits';
import { getTeamCommonsCar } from '@/components/teams/data/team-photo';

export interface LeaderPhoto {
  src: string;
  /** "photo" of a person, or a "car" photograph (constructors). */
  kind: 'person' | 'car';
  alt: string;
}

/**
 * A real photograph for a past season's champion card (RES-6): the drivers'
 * champion's credited Commons portrait (the same lookup as the champions
 * hall, credited on /references), or the constructors' champion's hand-picked
 * Commons car. Null when Commons has none; the card then closes up instead of
 * leaving an empty plate. Never invented.
 */
export async function pastLeaderPhoto(kind: 'drivers' | 'teams', firstStanding: unknown, leader: { id: string; first: string; last: string }): Promise<LeaderPhoto | null> {
  try {
    if (kind === 'drivers') {
      const s = mapDriverStanding(firstStanding as Parameters<typeof mapDriverStanding>[0]);
      const name = s.driver.fullName || `${leader.first} ${leader.last}`.trim();
      const map = await championPortraits([{ key: s.driver.slug, wikiUrl: s.driver.wikiUrl || null, name }], 1);
      const p = map.get(s.driver.slug);
      return p ? { src: p.src, kind: 'person', alt: name } : null;
    }
    const car = await getTeamCommonsCar(leader.id, leader.last);
    return car ? { src: car.src, kind: 'car', alt: car.alt } : null;
  } catch {
    return null;
  }
}
