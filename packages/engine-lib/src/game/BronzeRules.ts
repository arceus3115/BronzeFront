import type { Gold } from "@openfront/engine-api/game/GameTypes";
import { exp } from "../DetMath";
import { toInt } from "../Util";

/** Money added per tick by one city or mine at this level. Peaks at level 5. */
export function structureBell(level: number): Gold {
  const d = level - 5;
  return toInt(200 * exp(-(d * d) / 8));
}

/** City upgrade price in food. A large stock approaches half the base price. */
export function cityUpgradeFoodCost(base: Gold, food: Gold): Gold {
  const f = Number(food);
  const factor = 1 - (0.5 * f) / (f + 1_000_000);
  const cost = Number(base) * factor;
  const rounded = Math.ceil(cost);
  return BigInt(rounded < 1 ? 1 : rounded);
}

export function influenceStrength(level: number): number {
  return Math.round(100 * exp(0.4 * level));
}

export function siegeDefense(level: number, posts: number): number {
  return Math.round(1000 * exp(0.5 * level) + 500 * posts);
}

export const INFLUENCE_RADIUS = 40;

/** Troops that add one unit of squared radius, before the clamp. */
export const ARMY_TROOPS_PER_RADIUS = 25;
export const ARMY_RADIUS_MIN = 2;
export const ARMY_RADIUS_MAX = 12;

/** Width of the push. Troops are not spent on tiles. */
export function armyRadius(troops: number): number {
  const groups = Math.floor(Math.max(0, troops) / ARMY_TROOPS_PER_RADIUS);
  const r = isqrt(groups);
  if (r < ARMY_RADIUS_MIN) return ARMY_RADIUS_MIN;
  if (r > ARMY_RADIUS_MAX) return ARMY_RADIUS_MAX;
  return r;
}

function isqrt(n: number): number {
  if (n < 2) return n > 0 ? n : 0;
  let x = n;
  let y = Math.floor((x + 1) / 2);
  while (y < x) {
    x = y;
    y = Math.floor((x + Math.floor(n / x)) / 2);
  }
  return x;
}
export const MELEE_RANGE = 15;
export const MELEE_DAMAGE = 5;
export const BRONZE_STRENGTH = 4 / 3;
export const YIELD_DIVISOR = 50;
export const BRONZE_WEAPONS_COST = 50_000n;
export const MARKETS_COST = 50_000n;
export const EXCHANGE_RATE = 3n;
