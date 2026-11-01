/**
 * Real, freely licensed Wikimedia Commons photographs of historic teams'
 * cars, for team pages that have no Formula 1 media car (F1 media holds car
 * and logo masters from 2024 only). Each file was chosen by hand on
 * 2026-11-01: a whole car of that constructor, in period livery, landscape,
 * at least 1500 px wide, under a CC BY, CC BY-SA or CC0 licence. Author and
 * licence are read from Commons at render time (getCommonsPortrait), served
 * through Apex's own /media/commons/ path and credited on /references only.
 *
 * Keys are Jolpica constructor ids. A team on the current grid never uses
 * this list: its F1 media car always wins.
 */
export interface TeamCommonsCar {
  /** Commons file name without the "File:" prefix. */
  file: string;
  /** The car shown, for alt text ("Lotus 72"). */
  car: string;
}

export const TEAM_COMMONS_CARS: Readonly<Record<string, TeamCommonsCar>> = {
  team_lotus: { file: 'Lotus 72 at Formula 1 Exhibition, London 01.jpg', car: 'Lotus 72' },
  lotus_f1: { file: 'Kimi Raikkonen 2012 Malaysia FP2.jpg', car: 'Lotus E20' },
  brabham: { file: 'Brabham-BMW BT52 (55060291891).jpg', car: 'Brabham BT52' },
  tyrrell: { file: 'Tyrrell 003.jpg', car: 'Tyrrell 003' },
  cooper: { file: '1959 Cooper T51 Donington Park 2023 01.jpg', car: 'Cooper T51' },
  vanwall: { file: '1958 Vanwall VW5 11 (48853385363).jpg', car: 'Vanwall VW5' },
  matra: { file: 'Matra Cosworth MS80 1969 3.jpg', car: 'Matra MS80' },
  march: { file: 'March 701 Formula 1 1.jpg', car: 'March 701' },
  ligier: { file: 'Jacques Laffite Ligier JS11 2018 British Grand Prix (41932970520).jpg', car: 'Ligier JS11' },
  benetton: { file: '1994 Benetton B194 F1 car at Grand Basel 2018 (Ank Kumar, Infosys) 01.jpg', car: 'Benetton B194' },
  jordan: { file: 'Jordan 191 at Goodwood 2012.jpg', car: 'Jordan 191' },
  minardi: { file: 'Minardi PS01 driven by Fernando Alonso.jpg', car: 'Minardi PS01' },
  toyota: { file: 'Toyota TF108.jpg', car: 'Toyota TF108' },
  honda: { file: 'Honda with messages from BAT 2006 Brazil.jpg', car: 'Honda RA106' },
  bar: { file: 'BAR 006 (left side view).jpg', car: 'BAR 006' },
  jaguar: { file: 'Jaguar F1 R3 2002.jpg', car: 'Jaguar R3' },
  renault: { file: 'Renault R25 (52686960766).jpg', car: 'Renault R25' },
  brawn: { file: 'Brawn Mercedes BGP 001 (48242794007).jpg', car: 'Brawn BGP 001' },
  arrows: { file: 'S18.15.34 - Formel 1 - 14 - Orange Arrows A21, 2000 - Barry Walker - paddock - DSC 2174 Optimizer (37944090742).jpg', car: 'Arrows A21' },
  prost: { file: 'Prost AP01 (31457991535).jpg', car: 'Prost AP01' },
  wolf: { file: "Jody Scheckter's 1977 Wolf-Ford Wolf WR1 F1 car (14662121211).jpg", car: 'Wolf WR1' },
  shadow: { file: '1975 Shadow-Cosworth DN5.jpg', car: 'Shadow DN5' },
  hesketh: { file: 'James Hunt Hesketh 308 2018 British Grand Prix (29870766798).jpg', car: 'Hesketh 308' },
  toro_rosso: { file: 'Toro Rosso STR3 Hangar 7.jpg', car: 'Toro Rosso STR3' },
  force_india: { file: 'Adrian Sutil Jerez Mar 2009 4385a.jpg', car: 'Force India VJM02' },
  caterham: { file: 'Heikki Kovalainen F.P. Monza 2013.jpg', car: 'Caterham CT03' },
  marussia: { file: 'Marussia, No.4 Max Chilton (1) (15405697018).jpg', car: 'Marussia MR03' },
  super_aguri: { file: 'Super Aguri SA07 Honda Collection Hall.jpg', car: 'Super Aguri SA07' },
  brm: { file: 'BRM P57.jpg', car: 'BRM P57' },
  maserati: { file: 'Maserati 250F, Pau 2015.jpg', car: 'Maserati 250F' },
  lancia: { file: 'Lancia D50 (35334107110).jpg', car: 'Lancia D50' },
  alfa: { file: "Alfa Romeo 158 'Alfetta' (55060292101).jpg", car: 'Alfa Romeo 158' },
  lotus_racing: { file: 'Heikki Kovalainen, Caterham (Lotus) T127 (7510534188).jpg', car: 'Lotus T127' },
  virgin: { file: 'Glock Malaysian qualy 2010 (cropped).jpg', car: 'Virgin VR-01' },
  sauber: { file: '2012 Canadian Grand Prix Sergio Perez in Sauber C31.jpg', car: 'Sauber C31' },
};

/** The hand-picked Commons car for a constructor id, or null (current teams and teams with no picked photo). */
export function teamCommonsCar(constructorId: string | null | undefined): TeamCommonsCar | null {
  if (!constructorId) return null;
  return Object.prototype.hasOwnProperty.call(TEAM_COMMONS_CARS, constructorId) ? TEAM_COMMONS_CARS[constructorId]! : null;
}

/** Alt text for a team's Commons car: what it is, never a credit. */
export function teamCarAlt(teamName: string, car: TeamCommonsCar): string {
  return `${car.car}, a ${teamName} Formula 1 car`;
}
