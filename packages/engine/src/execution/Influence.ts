import { TileRef } from "@openfront/engine-api/game/GameMap";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  INFLUENCE_RADIUS,
  influenceStrength,
} from "@openfront/engine-lib/game/BronzeRules";
import { Game, Player } from "../game/Game";

/**
 * Every tenth tick, each city grows one strong border tile or gives one
 * negative border tile to the owner who outweighs it.
 */
export function applyCityInfluence(game: Game, player: Player): void {
  if (game.ticks() % 10 !== 0) return;
  const cities = game.units(UnitType.City);
  for (const city of player.units(UnitType.City)) {
    if (!city.isActive() || city.owner() !== player) continue;
    const border = nearestBorder(game, player, city.tile());
    if (border === undefined) continue;
    const here = fieldAt(game, cities, border);
    const own = here.get(player.smallID()) ?? 0;
    let bestOther = 0;
    let bestOwner: Player | undefined;
    for (const [id, value] of here) {
      if (id === player.smallID() || value <= bestOther) continue;
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

function nearestBorder(
  game: Game,
  player: Player,
  city: TileRef,
): TileRef | undefined {
  let best: TileRef | undefined;
  let bestD = Infinity;
  for (const tile of player.borderTiles()) {
    const d = game.manhattanDist(tile, city);
    if (d < bestD && d <= INFLUENCE_RADIUS) {
      bestD = d;
      best = tile;
    }
  }
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
  cities: readonly { tile(): TileRef; level(): number; owner(): Player; isActive(): boolean }[],
  tile: TileRef,
): Map<number, number> {
  const totals = new Map<number, number>();
  const limit = INFLUENCE_RADIUS * INFLUENCE_RADIUS;
  for (const city of cities) {
    if (!city.isActive()) continue;
    const dx = game.x(city.tile()) - game.x(tile);
    const dy = game.y(city.tile()) - game.y(tile);
    if (dx * dx + dy * dy > limit) continue;
    const id = city.owner().smallID();
    totals.set(id, (totals.get(id) ?? 0) + influenceStrength(city.level()));
  }
  return totals;
}
