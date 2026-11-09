export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export function headingDegrees(radians: number): number {
  const degrees = (radians * 180) / Math.PI;
  return ((degrees % 360) + 360) % 360;
}

export function formatHeading(degrees: number): string {
  const rounded = Math.round(degrees) % 360;
  const wrapped = (rounded + 360) % 360;
  return wrapped.toString().padStart(3, '0');
}

export function formatClock(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

export function runwayAlignmentDegrees(heading: number): number {
  const d = ((heading % 360) + 360) % 360;
  const toNorth = Math.min(d, 360 - d);
  const toSouth = Math.abs(180 - d);
  return Math.min(toNorth, toSouth);
}
