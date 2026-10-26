import { permanentRedirect } from 'next/navigation';

// "Hall of Fame" was retired in favour of /drivers/champions, which carries the
// same intent (every World Drivers' Champion) from Jolpica F1 final standings.
// The retirement is permanent, so the redirect is a 308 (SEO-8).
export default function HallOfFameRedirect(): never {
  permanentRedirect('/drivers/champions');
}
