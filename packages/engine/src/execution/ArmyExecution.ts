import { TileRef } from "@openfront/engine-api/game/GameMap";
import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { landSpeed } from "@openfront/engine-lib/game/Biome";
import {
  BRONZE_STRENGTH,
  siegeDefense,
} from "@openfront/engine-lib/game/BronzeRules";
import {
  zInt,
  zPlayerRef,
  zTile,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Attack, Execution, Game, Player, Unit } from "../game/Game";
import { GameImpl } from "../game/GameImpl";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

const armyTroops = new Map<number, number>();

export function armyTroopCount(unitId: number): number {
  return armyTroops.get(unitId) ?? 0;
}

export function setArmyTroops(unitId: number, troops: number): void {
  armyTroops.set(unitId, troops);
}

/**
 * A body of troops that marches to a tile, capturing land at the biome
 * speed. A city tile is besieged instead of flipped until the defense falls.
 */
/** Points an existing army at a new tile. The army reads the unit target. */
export class OrderArmyExecution implements Execution {
  constructor(
    private player: Player,
    private unitId: number,
    private tile: TileRef,
  ) {}

  init(mg: Game, _ticks: number): void {
    const unit = this.player.units(UnitType.Army).find((u) => u.id() === this.unitId);
    if (unit === undefined || !mg.isLand(this.tile)) return;
    unit.setTargetTile(this.tile);
  }

  tick(): void {}
  isActive(): boolean {
    return false;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }
  snapshot(): ExecRecord {
    return OrderArmyExecutionSnapshot.write({});
  }
  restoreSnapshot(): void {}
}

export const OrderArmyExecutionSnapshot = execSnapshotType({
  name: "OrderArmy",
  version: 1,
  schema: z.object({}),
  cls: () => OrderArmyExecution,
});

export class ArmyExecution implements Execution {
  private active = true;
  private mg!: Game;
  private army: Unit | undefined;
  private step = 0;
  private troops = 0;
  private attack: Attack | null = null;

  constructor(
    private player: Player,
    troops: number | null,
    private target: TileRef | string | null,
  ) {
    this.troops = troops ?? 0;
  }

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
    const spend =
      this.troops > 0
        ? Math.min(this.player.troops(), Math.floor(this.troops))
        : Math.floor(this.player.troops() * 0.2);
    if (spend <= 0) {
      this.active = false;
      return;
    }
    const tile = this.resolveTarget();
    const spawn = this.spawnTile(tile);
    if (spawn === null) {
      this.active = false;
      return;
    }
    this.target = tile;
    this.troops = spend;
    this.army = this.player.buildUnit(UnitType.Army, spawn, {
      troops: spend,
      targetTile: tile,
    });
    armyTroops.set(this.army.id(), spend);
    const owner = this.mg.owner(tile);
    this.attack = this.player.createAttack(
      owner.isPlayer() ? owner : this.mg.terraNullius(),
      spend,
      spawn,
      new Set(),
    );
  }

  tick(_ticks: number): void {
    if (this.attack?.retreating()) {
      this.army?.delete(false);
      this.finish();
      return;
    }
    if (!this.active || this.army === undefined || !this.army.isActive()) {
      this.finish();
      return;
    }
    const goal = this.army.targetTile() ?? (this.target as TileRef);
    if (this.army.tile() === goal) {
      this.arrive(goal);
      return;
    }
    this.step += landSpeed(this.mg.biome(this.army.tile()));
    if (this.step < 1) return;
    this.step -= 1;
    const next = this.stepToward(this.army.tile(), goal);
    if (next === undefined) return;
    const city = this.cityAt(next);
    if (city !== undefined && city.owner() !== this.player) {
      this.besiege(city);
      return;
    }
    this.take(next);
    this.army.move(next);
    if (next === goal) this.arrive(goal);
  }

  isActive(): boolean {
    return this.active;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }

  private strength(): number {
    return this.player.hasBronzeWeapons() ? BRONZE_STRENGTH : 1;
  }

  private resolveTarget(): TileRef {
    if (typeof this.target === "number") return this.target;
    const owner =
      this.target === null || this.target === this.mg.terraNullius().id()
        ? this.mg.terraNullius()
        : this.mg.player(this.target);
    let best: TileRef | null = null;
    let bestD = Infinity;
    const mine = this.player.borderTiles();
    for (const tile of mine) {
      const n = this.mg.neighbors(tile);
      for (const neighbor of n) {
        if (!this.mg.isLand(neighbor) || this.mg.isImpassable(neighbor)) continue;
        if (this.mg.owner(neighbor) !== owner) continue;
        const d = this.mg.manhattanDist(tile, neighbor);
        if (d < bestD) {
          bestD = d;
          best = neighbor;
        }
      }
    }
    if (best !== null) return best;
    return this.player.borderTiles().size > 0
      ? [...this.player.borderTiles()][0]
      : 0;
  }

  private spawnTile(target: TileRef): TileRef | null {
    if (
      this.mg.owner(target) === this.player &&
      this.mg.isLand(target) &&
      !this.mg.isImpassable(target)
    ) {
      return target;
    }
    let best: TileRef | null = null;
    let bestD = Infinity;
    const borders = this.player.borderTiles();
    const source = borders.size > 0 ? borders : this.player.tiles();
    for (const tile of source) {
      const d = this.mg.manhattanDist(tile, target);
      if (d < bestD) {
        bestD = d;
        best = tile;
      }
    }
    return best;
  }

  private stepToward(from: TileRef, goal: TileRef): TileRef | undefined {
    let best: TileRef | undefined;
    let bestD = this.mg.manhattanDist(from, goal);
    for (const n of this.mg.neighbors(from)) {
      if (!this.mg.isLand(n) || this.mg.isImpassable(n)) continue;
      const d = this.mg.manhattanDist(n, goal);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  private cityAt(tile: TileRef): Unit | undefined {
    for (const hit of this.mg.nearbyUnits(tile, 1, UnitType.City)) {
      if (hit.unit.tile() === tile && hit.unit.isActive()) return hit.unit;
    }
    return undefined;
  }

  private take(tile: TileRef): void {
    if (this.mg.owner(tile) === this.player) return;
    if (!this.mg.isLand(tile) || this.mg.isImpassable(tile)) return;
    this.player.conquer(tile);
    for (const hit of this.mg.nearbyUnits(
      tile,
      1,
      [UnitType.DefensePost, UnitType.Port, UnitType.Mine, UnitType.Farm],
    )) {
      if (hit.unit.tile() !== tile || !hit.unit.isActive()) continue;
      if (hit.unit.type() === UnitType.DefensePost) hit.unit.delete(true, this.player);
      else if (hit.unit.owner() !== this.player) this.player.captureUnit(hit.unit);
    }
  }

  private besiege(city: Unit): void {
    const posts = this.mg
      .nearbyUnits(city.tile(), this.mg.config().defensePostRange(), UnitType.DefensePost)
      .filter((h) => h.unit.owner() === city.owner() && h.unit.isActive()).length;
    let defend = 0;
    for (const hit of this.mg.nearbyUnits(city.tile(), 2, UnitType.Army)) {
      if (hit.unit.owner() !== city.owner()) continue;
      defend += armyTroopCount(hit.unit.id());
    }
    const attack = this.troops * this.strength();
    const defendPower =
      defend *
      (city.owner().type() !== PlayerType.Bot && city.owner().hasBronzeWeapons()
        ? BRONZE_STRENGTH
        : 1);
    const game = this.mg as unknown as GameImpl;
    const progress = game.addSiegeProgress(city.id(), attack - defendPower);
    if (progress < siegeDefense(city.level(), posts)) return;
    this.finish();
    game.clearSiege(city.id());
    this.take(city.tile());
    if (city.owner() !== this.player) this.player.captureUnit(city);
    if (this.army !== undefined) this.army.move(city.tile());
    this.active = false;
  }

  private arrive(tile: TileRef): void {
    const city = this.cityAt(tile);
    if (city !== undefined && city.owner() !== this.player) {
      this.besiege(city);
      return;
    }
    if (city !== undefined && city.owner() === this.player) {
      // Standing on a friendly city that is already under siege defends it.
      return;
    }
    this.take(tile);
  }

  private finish(): void {
    this.active = false;
    if (this.attack !== null && this.attack.isActive()) this.attack.delete();
    this.attack = null;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return ArmyExecutionSnapshot.write({
      active: this.active,
      player: w.player(this.player),
      troops: this.troops,
      target: typeof this.target === "number" ? this.target : 0,
      step: this.step,
      army: this.army !== undefined ? w.unit(this.army) : null,
    });
  }

  restoreSnapshot(
    s: z.infer<typeof ArmyStateSchema>,
    r: SnapshotReader,
  ): void {
    this.mg = r.game;
    this.active = s.active;
    this.player = r.player(s.player);
    this.troops = s.troops;
    this.target = s.target;
    this.step = s.step;
    this.army = s.army === null ? undefined : r.unit(s.army);
    if (this.army !== undefined) armyTroops.set(this.army.id(), this.troops);
  }
}

const ArmyStateSchema = z.object({
  active: z.boolean(),
  player: zPlayerRef(),
  troops: zInt(),
  target: zTile(),
  step: z.number(),
  army: z.number().int().nullable(),
});

export const ArmyExecutionSnapshot = execSnapshotType({
  name: "Army",
  version: 1,
  schema: ArmyStateSchema,
  cls: () => ArmyExecution,
});
