import { TileRef } from "@openfront/engine-api/game/GameMap";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  INFLUENCE_RADIUS,
  influenceStrength,
} from "@openfront/engine-lib/game/BronzeRules";
import { Game, Player, Unit } from "../game/Game";

const CELL = INFLUENCE_RADIUS;
/** Below this, a straight scan is cheaper than building a cell map. */
const GRID_CITY_COUNT = 256;

interface CitySample {
  index: number;
  x: number;
  y: number;
  level: number;
  ownerId: number;
}

/**
 * Every tenth tick, each city grows one strong border tile or gives one
 * negative border tile to the owner who outweighs it.
 */
export function applyCityInfluence(game: Game, player: Player): void {
  if (game.ticks() % 10 !== 0) return;
  const cities = game.units(UnitType.City);
  const grid =
    cities.length > GRID_CITY_COUNT ? indexCities(game, cities) : null;
  const ids: number[] = [];
  const values: number[] = [];
  const hits: CitySample[] = [];
  for (const city of player.units(UnitType.City)) {
    if (!city.isActive() || city.owner() !== player) continue;
    const border = nearestBorder(game, player, city.tile());
    if (border === undefined) continue;
    ids.length = 0;
    values.length = 0;
    fieldAt(game, cities, grid, border, ids, values, hits);
    let own = 0;
    let bestOther = 0;
    let bestOwner: Player | undefined;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const value = values[i];
      if (id === player.smallID()) {
        own = value;
        continue;
      }
      if (value <= bestOther) continue;
      bestOther = value;
      const other = game.playerBySmallID(id);
      if (other.isPlayer()) bestOwner = other;
    }
    if (own > 0 && own >= bestOther * 2) {
      const next = adjacentForeign(game, player, border);
      if (next !== undefined) player.conquer(next);
      continue;
    }
    if (bestOwner !== undefined && bestOther > own) {
      bestOwner.conquer(border);
    }
  }
}

function indexCities(game: Game, cities: Unit[]): Map<number, CitySample[]> {
  const grid = new Map<number, CitySample[]>();
  for (let i = 0; i < cities.length; i++) {
    const city = cities[i];
    if (!city.isActive()) continue;
    const tile = city.tile();
    const x = game.x(tile);
    const y = game.y(tile);
    const sample: CitySample = {
      index: i,
      x,
      y,
      level: city.level(),
      ownerId: city.owner().smallID(),
    };
    const key = cellKey(x, y);
    const cell = grid.get(key);
    if (cell === undefined) grid.set(key, [sample]);
    else cell.push(sample);
  }
  return grid;
}

/**
 * Nearest border tile inside the radius.
 * A short border is cheaper to scan than the radius-40 diamond, and the
 * first tile in border order still wins a tie. A long border is searched
 * outward from the city; ties take the smaller tile ref.
 */
function nearestBorder(
  game: Game,
  player: Player,
  city: TileRef,
): TileRef | undefined {
  const border = player.borderTiles();
  if (border.size <= 512) {
    let best: TileRef | undefined;
    let bestD = Infinity;
    for (const tile of border) {
      const d = game.manhattanDist(tile, city);
      if (d < bestD && d <= INFLUENCE_RADIUS) {
        bestD = d;
        best = tile;
      }
    }
    return best;
  }
  return nearestByDiamond(game, border, city);
}

function nearestByDiamond(
  game: Game,
  border: { has(tile: TileRef): boolean },
  city: TileRef,
): TileRef | undefined {
  const cx = game.x(city);
  const cy = game.y(city);
  const width = game.width();
  const height = game.height();
  for (let d = 0; d <= INFLUENCE_RADIUS; d++) {
    let best: TileRef | undefined;
    for (let dx = -d; dx <= d; dx++) {
      const dy = d - Math.abs(dx);
      const x = cx + dx;
      if (dy === 0) {
        best = nearer(game, border, best, x, cy, width, height);
      } else {
        best = nearer(game, border, best, x, cy + dy, width, height);
        best = nearer(game, border, best, x, cy - dy, width, height);
      }
    }
    if (best !== undefined) return best;
  }
  return undefined;
}

function nearer(
  game: Game,
  border: { has(tile: TileRef): boolean },
  best: TileRef | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
): TileRef | undefined {
  if (x < 0 || y < 0 || x >= width || y >= height) return best;
  const tile = game.ref(x, y);
  if (!border.has(tile)) return best;
  if (best === undefined || tile < best) return tile;
  return best;
}

function adjacentForeign(
  game: Game,
  player: Player,
  tile: TileRef,
): TileRef | undefined {
  for (const n of game.neighbors(tile)) {
    if (!game.isLand(n) || game.isImpassable(n)) continue;
    if (game.owner(n) !== player) return n;
  }
  return undefined;
}

function fieldAt(
  game: Game,
  cities: Unit[],
  grid: Map<number, CitySample[]> | null,
  tile: TileRef,
  ids: number[],
  values: number[],
  hits: CitySample[],
): void {
  const tx = game.x(tile);
  const ty = game.y(tile);
  const limit = INFLUENCE_RADIUS * INFLUENCE_RADIUS;
  if (grid === null) {
    for (let i = 0; i < cities.length; i++) {
      const city = cities[i];
      if (!city.isActive()) continue;
      const dx = game.x(city.tile()) - tx;
      const dy = game.y(city.tile()) - ty;
      if (dx * dx + dy * dy > limit) continue;
      addStrength(
        ids,
        values,
        city.owner().smallID(),
        influenceStrength(city.level()),
      );
    }
    return;
  }
  const c0x = Math.floor((tx - INFLUENCE_RADIUS) / CELL);
  const c1x = Math.floor((tx + INFLUENCE_RADIUS) / CELL);
  const c0y = Math.floor((ty - INFLUENCE_RADIUS) / CELL);
  const c1y = Math.floor((ty + INFLUENCE_RADIUS) / CELL);
  hits.length = 0;
  for (let cx = c0x; cx <= c1x; cx++) {
    for (let cy = c0y; cy <= c1y; cy++) {
      const cell = grid.get(cx * 65536 + cy);
      if (cell === undefined) continue;
      for (const city of cell) hits.push(city);
    }
  }
  hits.sort((a, b) => a.index - b.index);
  for (const city of hits) {
    const dx = city.x - tx;
    const dy = city.y - ty;
    if (dx * dx + dy * dy > limit) continue;
    addStrength(ids, values, city.ownerId, influenceStrength(city.level));
  }
}

function cellKey(x: number, y: number): number {
  return Math.floor(x / CELL) * 65536 + Math.floor(y / CELL);
}

function addStrength(
  ids: number[],
  values: number[],
  id: number,
  amount: number,
): void {
  for (let i = 0; i < ids.length; i++) {
    if (ids[i] !== id) continue;
    values[i] += amount;
    return;
  }
  ids.push(id);
  values.push(amount);
}
