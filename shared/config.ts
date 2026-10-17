// Shared game config: used by the server (authoritative odds/payouts) and the client (display only).

export type FishKind =
  | 'sardine' | 'seahorse' | 'clownfish' | 'puffer' | 'crab' | 'jelly'
  | 'turtle' | 'octopus' | 'shark' | 'lobster' | 'whale';

export interface FishDef {
  kind: FishKind;
  name: string;
  quip: string;          // paytable joke
  mult: number;          // payout multiplier of the bet (whale: average, see WHALE_MULTS)
  size: number;          // rendered width in world px
  radius: number;        // hit radius in world px
  facing: 'side' | 'front'; // side-view sprites rotate along path; front-view bob upright
  speed: [number, number]; // path duration range in ms
}

export const RTP = 0.94; // expected return per shot; kill chance = RTP / multiplier

export const FISH: Record<FishKind, FishDef> = {
  sardine:   { kind: 'sardine',   name: 'Tipsy Sardine',     quip: 'Packed in like a Saturday bar.', mult: 2,   size: 94, radius: 31, facing: 'side',  speed: [14000, 19000] },
  seahorse:  { kind: 'seahorse',  name: 'Coco Seahorse',     quip: "It's 5 o'clock somewhere.",       mult: 3,   size: 84, radius: 34, facing: 'front', speed: [17000, 22000] },
  clownfish: { kind: 'clownfish', name: 'Party Clownfish',   quip: 'Never invited. Always there.',    mult: 5,   size: 120, radius: 38, facing: 'side',  speed: [15000, 20000] },
  puffer:    { kind: 'puffer',    name: 'Puffed Pufferfish', quip: 'One more round and he blows.',    mult: 8,   size: 132, radius: 50, facing: 'side',  speed: [18000, 24000] },
  crab:      { kind: 'crab',      name: 'Beer Goggles Crab', quip: 'Two-fisting since spawn.',        mult: 15,  size: 156, radius: 58, facing: 'front', speed: [19000, 25000] },
  jelly:     { kind: 'jelly',     name: 'Rave Jelly',        quip: 'Has not slept since Tuesday.',    mult: 25,  size: 156, radius: 58, facing: 'front', speed: [21000, 27000] },
  turtle:    { kind: 'turtle',    name: 'Chill Bro Turtle',  quip: 'Slow. Very slow. Brah.',          mult: 40,  size: 204, radius: 70, facing: 'side',  speed: [24000, 30000] },
  octopus:   { kind: 'octopus',   name: 'Shotopus',          quip: 'Eight arms, eight shots.',        mult: 60,  size: 204, radius: 74, facing: 'front', speed: [22000, 28000] },
  shark:     { kind: 'shark',     name: 'Spring Break Shark',quip: 'Bites. Tips badly.',              mult: 120, size: 324, radius: 94, facing: 'side',  speed: [20000, 26000] },
  lobster:   { kind: 'lobster',   name: 'DJ Lobstah',        quip: 'Drops beats. And drinks.',        mult: 300, size: 240, radius: 89, facing: 'front',  speed: [24000, 30000] },
  whale:     { kind: 'whale',     name: 'The Hangover Whale',quip: 'Lampshade. Ice pack. Regrets.',   mult: 250, size: 576, radius: 180, facing: 'side', speed: [34000, 40000] },
};

// Boss whale pays a random multiplier from this table on kill. Kill chance uses the weighted mean.
export const WHALE_MULTS: { mult: number; weight: number }[] = [
  { mult: 150, weight: 40 }, { mult: 200, weight: 25 }, { mult: 300, weight: 20 }, { mult: 400, weight: 10 }, { mult: 500, weight: 5 },
];
export const WHALE_AVG = WHALE_MULTS.reduce((s, m) => s + m.mult * m.weight, 0) / WHALE_MULTS.reduce((s, m) => s + m.weight, 0);

export interface RoomDef { id: string; name: string; tagline: string; bets: number[]; minBalance: number; }
export const ROOMS: RoomDef[] = [
  { id: 'happy',  name: 'Happy Hour',      tagline: 'Cheap drinks, cheap shots', bets: [1, 2, 3, 5, 8, 10],          minBalance: 0 },
  { id: 'bottle', name: 'Bottle Service',  tagline: 'Sparklers on the table',    bets: [10, 20, 30, 50, 80, 100],    minBalance: 500 },
  { id: 'vip',    name: 'Whale Lounge VIP',tagline: 'High rollers only, darling',bets: [100, 200, 300, 500, 800, 1000], minBalance: 10000 },
];

export interface CoinPack { id: string; coins: number; bonus: number; priceCents: number; label: string; badge?: string; }
export const PACKS: CoinPack[] = [
  { id: 'p1', coins: 1000,  bonus: 0,     priceCents: 99,   label: 'Pint' },
  { id: 'p2', coins: 5000,  bonus: 500,   priceCents: 499,  label: 'Pitcher' },
  { id: 'p3', coins: 10000, bonus: 2000,  priceCents: 999,  label: 'Keg', badge: 'POPULAR' },
  { id: 'p4', coins: 20000, bonus: 6000,  priceCents: 1999, label: 'Bar Tab' },
  { id: 'p5', coins: 50000, bonus: 20000, priceCents: 4999, label: 'Open Bar', badge: 'BEST VALUE' },
];

export const STARTER_COINS = 2000;
export const DAILY_COINS = 1000;
export const DAILY_MS = 24 * 60 * 60 * 1000;

export const WORLD_W = 1600;
export const WORLD_H = 900;

// ---- wire protocol ----
export type Vec = [number, number];
export interface SpawnFish { id: number; kind: FishKind; p: [Vec, Vec, Vec, Vec]; off: Vec; dur: number; delay: number; }
export type ClientMsg =
  | { t: 'join'; room: string }
  | { t: 'fire'; bet: number; cid: number }
  | { t: 'hit'; bid: number; fid: number };
export type ServerMsg =
  | { t: 'joined'; room: string; balance: number; fish: (SpawnFish & { age: number })[] }
  | { t: 'spawn'; fish: SpawnFish[]; boss?: boolean }
  | { t: 'fired'; cid: number; bid: number; balance: number }
  | { t: 'reject'; cid?: number; reason: string; balance: number }
  | { t: 'hit'; bid: number; fid: number; killed: boolean; mult: number; payout: number; balance: number }
  | { t: 'error'; reason: string };

export function bezier(p: [Vec, Vec, Vec, Vec], t: number): Vec {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p[0][0] + b * p[1][0] + c * p[2][0] + d * p[3][0], a * p[0][1] + b * p[1][1] + c * p[2][1] + d * p[3][1]];
}
