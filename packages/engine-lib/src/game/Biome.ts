import { TileRef } from "@openfront/engine-api/game/GameMap";
import { TerrainType } from "@openfront/engine-api/game/GameTypes";

/** Low inland land within this many tiles of water is lush. */
export const BIOME_NEAR_WATER = 8;
/** Low inland land farther than this from water is desert. */
export const BIOME_FAR_WATER = 24;

const LAND_BIT = 1 << 7;
const SHORE_BIT = 1 << 6;
const MAG_MASK = 0x1f;
const IMPASSABLE = 31;

export function foodWeight(biome: TerrainType): number {
  switch (biome) {
    case TerrainType.Lush:
      return 4;
    case TerrainType.Coast:
    case TerrainType.Forest:
    case TerrainType.Highland:
      return 2;
    case TerrainType.Mountain:
    case TerrainType.Plains:
    case TerrainType.Desert:
      return 1;
    default:
      return 0;
  }
}

export function mineWeight(biome: TerrainType): number {
  switch (biome) {
    case TerrainType.Mountain:
    case TerrainType.Desert:
      return 4;
    case TerrainType.Coast:
      return 1;
    default:
      return 0;
  }
}

/** One speed for both marching and capture. */
export function landSpeed(biome: TerrainType): number {
  switch (biome) {
    case TerrainType.Plains:
    case TerrainType.Desert:
      return 1;
    case TerrainType.Lush:
    case TerrainType.Coast:
      return 0.7;
    case TerrainType.Forest:
    case TerrainType.Highland:
    case TerrainType.Mountain:
      return 0.4;
    default:
      return 1;
  }
}

/**
 * Coarse biome for a one-byte map: coast, mountain, forest, plains.
 * Lush and desert need the stored distance layer.
 */
export function fallbackBiome(
  isLand: boolean,
  isShore: boolean,
  magnitude: number,
): TerrainType {
  if (!isLand) return TerrainType.Ocean;
  if (magnitude >= IMPASSABLE) return TerrainType.Impassable;
  if (isShore && magnitude < 20) return TerrainType.Coast;
  if (magnitude >= 20) return TerrainType.Mountain;
  if (magnitude >= 10) return TerrainType.Forest;
  return TerrainType.Plains;
}

/**
 * Full biome layer. `terrain` is one byte per tile, row-major.
 * Shoreline land below mountain elevation is coast. Magnitude >= 20 is
 * mountain, 10–19 is forest. Remaining low land is lush, plains, or desert
 * by distance to water.
 */
export function assignBiomes(
  width: number,
  height: number,
  terrain: Uint8Array,
): Uint8Array {
  const n = width * height;
  const dist = new Int16Array(n);
  dist.fill(-1);
  const queue = new Int32Array(n);
  let qh = 0;
  let qt = 0;
  for (let i = 0; i < n; i++) {
    if ((terrain[i] & LAND_BIT) === 0) {
      dist[i] = 0;
      queue[qt++] = i;
    }
  }
  while (qh < qt) {
    const cur = queue[qh++];
    const d = dist[cur];
    const x = cur % width;
    const y = (cur / width) | 0;
    const step = (nx: number, ny: number) => {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
      const ni = ny * width + nx;
      if (dist[ni] !== -1) return;
      dist[ni] = d + 1;
      queue[qt++] = ni;
    };
    step(x - 1, y);
    step(x + 1, y);
    step(x, y - 1);
    step(x, y + 1);
  }

  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const byte = terrain[i];
    const land = (byte & LAND_BIT) !== 0;
    const shore = (byte & SHORE_BIT) !== 0;
    const mag = byte & MAG_MASK;
    if (!land) {
      out[i] = TerrainType.Ocean;
      continue;
    }
    if (mag >= IMPASSABLE) {
      out[i] = TerrainType.Impassable;
      continue;
    }
    if (shore && mag < 20) {
      out[i] = TerrainType.Coast;
      continue;
    }
    if (mag >= 20) {
      out[i] = TerrainType.Mountain;
      continue;
    }
    if (mag >= 10) {
      out[i] = TerrainType.Forest;
      continue;
    }
    const d = dist[i];
    if (d !== -1 && d <= BIOME_NEAR_WATER) out[i] = TerrainType.Lush;
    else if (d === -1 || d > BIOME_FAR_WATER) out[i] = TerrainType.Desert;
    else out[i] = TerrainType.Plains;
  }
  return out;
}

export function biomeOf(
  map: {
    isLand(ref: TileRef): boolean;
    isShoreline(ref: TileRef): boolean;
    magnitude(ref: TileRef): number;
    biomeByte?(ref: TileRef): number | null;
  },
  ref: TileRef,
): TerrainType {
  const stored = map.biomeByte?.(ref);
  if (stored !== undefined && stored !== null && stored !== 255) {
    return stored as TerrainType;
  }
  return fallbackBiome(map.isLand(ref), map.isShoreline(ref), map.magnitude(ref));
}
