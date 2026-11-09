import { clamp, smoothstep } from './math.ts';

/** Runway 36/18, airport plateau, and the landmarks drawn on the map. */
export const FIELD = {
  runwayHalf: 20,
  landingHalf: 30,
  south: 260,
  north: -1480,
  startX: 0,
  startZ: 150,
  flatInnerX: 180,
  flatSouth: 520,
  flatNorth: -1860,
  flatBlend: 280,
  veerLimit: 38,
};

export const MOUNTAIN = { x: -1650, z: -2050, height: 380, rx: 980, rz: 820 };
export const HILL = { x: 1550, z: 1200, height: 120, r: 620 };
export const LAKE = { x: 920, z: -260, radius: 520, depth: 8, island: 86 };
export const PLACES = {
  tower: { x: -86, z: -30 },
  hangar: { x: 128, z: 78 },
  office: { x: 108, z: 168 },
  fuel: { x: 96, z: 214 },
  windsock: { x: -34, z: 70 },
  turbine: { x: -980, z: -1280 },
  island: { x: LAKE.x, z: LAKE.z },
  runwayCenter: { x: 0, z: (FIELD.south + FIELD.north) / 2 },
};

const WATER_LEVEL = -1.25;

function hash(ix: number, iz: number): number {
  const n = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function valueNoise(x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const n00 = hash(x0, z0);
  const n10 = hash(x0 + 1, z0);
  const n01 = hash(x0, z0 + 1);
  const n11 = hash(x0 + 1, z0 + 1);
  return n00 * (1 - sx) * (1 - sz) + n10 * sx * (1 - sz) + n01 * (1 - sx) * sz + n11 * sx * sz;
}

export function fieldNoise(x: number, z: number): number {
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let sum = 0;
  for (let octave = 0; octave < 4; octave += 1) {
    total += valueNoise(x * frequency, z * frequency) * amplitude;
    sum += amplitude;
    amplitude *= 0.5;
    frequency *= 2.05;
  }
  return total / sum;
}

export function plateauMask(x: number, z: number): number {
  let edge = 0;
  const ax = Math.abs(x);
  if (ax > FIELD.flatInnerX) {
    edge = Math.max(edge, (ax - FIELD.flatInnerX) / FIELD.flatBlend);
  }
  if (z > FIELD.flatSouth) edge = Math.max(edge, (z - FIELD.flatSouth) / FIELD.flatBlend);
  if (z < FIELD.flatNorth) edge = Math.max(edge, (FIELD.flatNorth - z) / FIELD.flatBlend);
  return smoothstep(0, 1, edge);
}

function rawHeight(x: number, z: number): number {
  const mask = plateauMask(x, z);
  if (mask <= 0) return 0;

  const macro = (fieldNoise(x * 0.0026, z * 0.0026) - 0.56) * 46;
  const detail = (fieldNoise(x * 0.012 + 8, z * 0.012 - 3) - 0.5) * 8;
  let height = macro + detail;

  const mdx = (x - MOUNTAIN.x) / MOUNTAIN.rx;
  const mdz = (z - MOUNTAIN.z) / MOUNTAIN.rz;
  height += Math.exp(-(mdx * mdx + mdz * mdz)) * MOUNTAIN.height;

  const hdx = x - HILL.x;
  const hdz = z - HILL.z;
  height += Math.exp(-(hdx * hdx + hdz * hdz) / (HILL.r * HILL.r)) * HILL.height;

  const lakeDistance = Math.hypot(x - LAKE.x, z - LAKE.z);
  if (lakeDistance < LAKE.radius) {
    const bowl = 1 - smoothstep(LAKE.island + 20, LAKE.radius, lakeDistance);
    height = height + (-LAKE.depth - height) * bowl;
    if (lakeDistance < LAKE.island) {
      const rise = 1 - lakeDistance / LAKE.island;
      height = Math.max(height, 0.6 + rise * 1.6);
    }
  }

  return height * mask;
}

export interface GroundSample {
  y: number;
  raw: number;
  mask: number;
  water: boolean;
}

export function sampleGround(x: number, z: number): GroundSample {
  const raw = rawHeight(x, z);
  const water = raw < WATER_LEVEL - 0.05 && plateauMask(x, z) > 0.4;
  return {
    y: water ? WATER_LEVEL : raw,
    raw,
    mask: plateauMask(x, z),
    water,
  };
}

export function terrainHeight(x: number, z: number): number {
  return sampleGround(x, z).y;
}

export function isRunway(x: number, z: number): boolean {
  return Math.abs(x) <= FIELD.landingHalf && z <= FIELD.south + 12 && z >= FIELD.north - 12;
}

export function isAirport(x: number, z: number): boolean {
  return Math.abs(x) < FIELD.flatInnerX - 10 && z < FIELD.flatSouth - 20 && z > FIELD.flatNorth + 20;
}

export function isLake(x: number, z: number): boolean {
  return Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.radius * 0.72;
}

export function crashSiteName(x: number, z: number, groundY: number): string {
  if (groundY > 48) return '撞山';
  if (isLake(x, z) || groundY < -0.8) return '坠入湖中';
  if (isAirport(x, z)) {
    if (z > FIELD.south + 24 || z < FIELD.north - 24) return '冲出跑道尽头';
    return '偏出跑道';
  }
  return '场外着陆';
}

export const WATER_Y = WATER_LEVEL;

export function bearingToRunway(x: number, z: number): { bearing: number; distance: number } {
  const dx = PLACES.runwayCenter.x - x;
  const dz = PLACES.runwayCenter.z - z;
  const distance = Math.hypot(dx, dz);
  const bearing = (Math.atan2(dx, -dz) * 180) / Math.PI;
  return { bearing: (bearing + 360) % 360, distance };
}

export function lateralOffsetLabel(x: number): string {
  const meters = Math.abs(Math.round(x));
  if (meters < 8) return '正对跑道中线';
  if (x > 0) return `位于跑道中线右侧 ${meters} 米`;
  return `位于跑道中线左侧 ${meters} 米`;
}

export function clampTerrainCoord(value: number): number {
  return clamp(value, -6000, 6000);
}
