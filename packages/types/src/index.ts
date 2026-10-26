// Shared types across @apex/web, @apex/admin, @apex/api-client, @apex/ingest.
// Mirrors the Drizzle schema in packages/db.

export type SessionKind = 'FP1' | 'FP2' | 'FP3' | 'SQ' | 'S' | 'Q' | 'R';
export type RaceStatus = 'completed' | 'live' | 'upcoming' | 'testing' | 'cancelled';
export type ArticleType =
  | 'news'
  | 'feature'
  | 'analysis'
  | 'quiz'
  | 'guide'
  | 'press'
  | 'gallery'
  | 'newsletter';
export type Tyre = 'soft' | 'medium' | 'hard' | 'intermediate' | 'wet' | 'unknown';

export interface Season {
  id: string;
  year: number;
  status: 'completed' | 'active' | 'upcoming';
}

export interface Circuit {
  id: string;
  slug: string;
  name: string;
  country: string;
  city?: string;
  location: string;
  lengthKm: number;
  corners: number;
  lapRecordTimeMs?: number;
  lapRecordHolder?: string;
  lapRecordYear?: number;
  svgPath?: string;
  imageUrl?: string;
}

export interface Race {
  id: string;
  seasonYear: number;
  round: number;
  slug: string;
  name: string;
  officialName: string;
  country: string;
  city?: string;
  circuit: Circuit;
  dateStart: string;
  dateEnd: string;
  timezone: string;
  isSprint: boolean;
  status: RaceStatus;
  sessions: RaceSession[];
  weather?: WeatherForecast;
  heroImageUrl?: string;
}

export interface RaceSession {
  id: string;
  raceId: string;
  kind: SessionKind;
  scheduledStart: string;
  scheduledEnd?: string;
  actualStart?: string;
  actualEnd?: string;
  status: 'scheduled' | 'live' | 'completed' | 'cancelled';
}

export interface Driver {
  id: string;
  slug: string;
  code: string;
  number: number;
  firstName: string;
  lastName: string;
  fullName: string;
  nationality: string;
  countryCode: string;
  dob?: string;
  teamId?: string;
  teamName?: string;
  teamColorHex?: string;
  headshotUrl?: string;
  helmetUrl?: string;
  profileImageUrl?: string;
  bioMd?: string;
  debutYear?: number;
  retiredYear?: number;
}

export interface Team {
  id: string;
  slug: string;
  name: string;
  fullName?: string;
  base?: string;
  principal?: string;
  technicalChief?: string;
  powerUnit?: string;
  foundedYear?: number;
  colorHex: string;
  logoUrl?: string;
  carImageUrl?: string;
  liveryImageUrl?: string;
  championships?: number;
}

export interface RaceResult {
  raceId: string;
  driver: Driver;
  team: Team;
  position: number;
  positionText: string;
  points: number;
  laps: number;
  timeMs?: number;
  gapToLeader?: string;
  status: string;
  grid: number;
  fastestLapRank?: number;
  fastestLapTimeMs?: number;
  fastestLapLap?: number;
}

export interface DriverStanding {
  seasonYear: number;
  round?: number;
  position: number;
  driver: Driver;
  points: number;
  wins: number;
  podiums?: number;
  poles?: number;
  fastestLaps?: number;
}

export interface TeamStanding {
  seasonYear: number;
  round?: number;
  position: number;
  team: Team;
  points: number;
  wins: number;
}

export interface Article {
  id: string;
  slug: string;
  title: string;
  dek?: string;
  bodyMd?: string;
  authorName: string;
  authorSlug: string;
  heroImageUrl: string;
  thumbnailUrl?: string;
  type: ArticleType;
  section?: string;
  publishedAt: string;
  updatedAt?: string;
  isBreaking?: boolean;
  isPinned?: boolean;
  readTimeMinutes: number;
  tags: string[];
  driverSlugs?: string[];
  teamSlugs?: string[];
  raceSlug?: string;
}

export interface VideoItem {
  id: string;
  slug: string;
  provider: 'youtube' | 'native' | 'vimeo';
  providerAssetId: string;
  title: string;
  description?: string;
  durationSeconds: number;
  thumbnailUrl: string;
  embedUrl: string;
  publishedAt: string;
  channel?: string;
  raceSlug?: string;
}

export interface WeatherForecast {
  tempC?: number;
  trackTempC?: number;
  humidityPct?: number;
  windKph?: number;
  rainProbabilityPct?: number;
  conditions?: string;
}

export interface SocialPost {
  id: string;
  provider: 'instagram' | 'youtube' | 'reddit' | 'twitter' | 'tiktok';
  url: string;
  title?: string;
  excerpt?: string;
  authorHandle?: string;
  thumbnailUrl?: string;
  metric?: { kind: 'likes' | 'upvotes' | 'views' | 'comments'; value: number };
  capturedAt: string;
}

export interface Partner {
  id: string;
  name: string;
  tier: 'global' | 'official' | 'team' | 'broadcast';
  logoUrl?: string;
  url?: string;
  licenseStatus: 'licensed' | 'pending' | 'unlicensed';
}
