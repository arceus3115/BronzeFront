import { TileRef } from "@openfront/engine-api/game/GameMap";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type { ExecRecord } from "../snapshot/SnapshotContext";
import { landFromShore } from "./AttackExecution";
import { WarshipExecution } from "./WarshipExecution";

/**
 * Loads troops onto a warship at a friendly shore, or unloads them as an army.
 */
/** Puts troops on a new warship and sails it toward a coastal tile. */
export function embark(
  game: Game,
  player: Player,
  dst: TileRef,
  troops: number,
): boolean {
  const take = Math.min(player.troops(), Math.floor(troops));
  const launch = launchWater(game, player);
  if (take <= 0 || launch === null) return false;
  player.removeTroops(take);
  const ship = player.buildUnit(UnitType.Warship, launch, {
    patrolTile: waterBeside(game, dst) ?? launch,
  });
  ship.updateWarshipState({ cargo: take });
  game.addExecution(new WarshipExecution(ship));
  return true;
}

function launchWater(game: Game, player: Player): TileRef | null {
  for (const tile of player.tiles()) {
    for (const n of game.neighbors(tile)) {
      if (game.isWater(n)) return n;
    }
  }
  return null;
}

function waterBeside(game: Game, tile: TileRef): TileRef | null {
  if (game.isWater(tile)) return tile;
  for (const n of game.neighbors(tile)) {
    if (game.isWater(n)) return n;
  }
  return null;
}

export class WarshipCargoExecution implements Execution {
  constructor(
    private player: Player,
    private unitId: number,
    private action: "load" | "unload",
    private amount: number,
    private tile: TileRef | null,
  ) {}

  init(mg: Game, _ticks: number): void {
    const ship = this.player
      .units(UnitType.Warship)
      .find((unit) => unit.id() === this.unitId);
    if (ship === undefined || !ship.isActive()) return;
    const cargo = ship.warshipState().cargo ?? 0;
    if (this.action === "load") {
      if (!this.besideFriendlyLand(mg, ship.tile())) return;
      const take = Math.min(
        this.player.troops(),
        Math.max(0, Math.floor(this.amount)),
      );
      if (take <= 0) return;
      this.player.removeTroops(take);
      ship.updateWarshipState({ cargo: cargo + take });
      return;
    }
    if (this.tile === null || cargo <= 0) return;
    if (!mg.isLand(this.tile) || mg.isImpassable(this.tile)) return;
    if (mg.owner(this.tile) !== this.player) return;
    ship.updateWarshipState({ cargo: 0 });
    landFromShore(mg, this.player, this.tile, cargo);
  }

  tick(): void {}
  isActive(): boolean {
    return false;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }
  snapshot(): ExecRecord {
    return WarshipCargoExecutionSnapshot.write({});
  }
  restoreSnapshot(): void {}

  private besideFriendlyLand(mg: Game, tile: TileRef): boolean {
    if (mg.isLand(tile) && mg.owner(tile) === this.player) return true;
    for (const n of mg.neighbors(tile)) {
      if (mg.isLand(n) && mg.owner(n) === this.player) return true;
    }
    return false;
  }
}

export const WarshipCargoExecutionSnapshot = execSnapshotType({
  name: "WarshipCargo",
  version: 1,
  schema: z.object({}),
  cls: () => WarshipCargoExecution,
});
