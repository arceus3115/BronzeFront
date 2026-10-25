import { TileRef } from "@openfront/engine-api/game/GameMap";
import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { landSpeed } from "@openfront/engine-lib/game/Biome";
import {
  armyRadius,
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
 * A body of troops that pushes a disk of land outward from its own tile,
 * then steps only onto land it already holds. A city tile is besieged
 * instead of flipped until the defense falls.
 */
/** Points an existing army at a new tile. The army reads the unit target. */
export class OrderArmyExecution implements Execution {
  constructor(
    private player: Player,
    private unitId: number,
    private tile: TileRef,
  ) {}

  init(mg: Game, _ticks: number): void {
    const unit = this.player
      .units(UnitType.Army)
      .find((u) => u.id() === this.unitId);
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
  private captureBudget = 0;
  private troops = 0;

  /** Troops this order will spend once it starts. */
  troopsToSend(): number {
    return this.troops;
  }

  /** Tile, or owner id, this order is aimed at. */
  aimedAt(): TileRef | string | null {
    return this.target;
  }
  private attack: Attack | null = null;
  private nbuf: TileRef[] = [0, 0, 0, 0];
  private nbuf2: TileRef[] = [0, 0, 0, 0];

  constructor(
    private player: Player,
    troops: number | null,
    private target: TileRef | string | null,
    private existingUnitId: number | null = null,
  ) {
    this.troops = troops ?? 0;
  }

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
    if (this.existingUnitId !== null) {
      this.adopt(this.existingUnitId);
      return;
    }
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

  /** Marches a unit that was already built, without spending troops again. */
  private adopt(unitId: number): void {
    const unit = this.player
      .units(UnitType.Army)
      .find((u) => u.id() === unitId);
    if (unit === undefined || !unit.isActive()) {
      this.active = false;
      return;
    }
    const tile = typeof this.target === "number" ? this.target : unit.tile();
    this.target = tile;
    this.army = unit;
    this.troops = armyTroopCount(unit.id()) || this.troops;
    armyTroops.set(unit.id(), this.troops);
    unit.setTargetTile(tile);
    const owner = this.mg.owner(tile);
    this.attack = this.player.createAttack(
      owner.isPlayer() ? owner : this.mg.terraNullius(),
      this.troops,
      unit.tile(),
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
    // Siege before the brush, so a defense post on the next tile still
    // counts. A finished siege ends the march. The step target is stable
    // across the push: cities in the disk are blocked, so they are not taken.
    this.step += landSpeed(this.mg.biome(this.army.tile()));
    let spentStep = false;
    let next: TileRef | undefined;
    if (this.step >= 1) {
      next = this.stepToward(this.army.tile(), goal);
      const city = next === undefined ? undefined : this.cityAt(next);
      if (city !== undefined && city.owner() !== this.player) {
        this.step -= 1;
        spentStep = true;
        this.besiege(city);
        if (!this.active || this.army === undefined || !this.army.isActive()) {
          return;
        }
      }
    }
    const open = this.push(goal);
    if (!this.active || this.army === undefined || !this.army.isActive()) {
      return;
    }
    if (this.army.tile() === goal && !open) {
      this.arrive(goal);
      return;
    }
    if (spentStep || this.step < 1) return;
    if (next === undefined) {
      this.step -= 1;
      return;
    }
    // The disk is still open, or the next tile is not ours yet. This tick
    // pushes instead of walking ahead of the fill.
    if (open || this.mg.owner(next) !== this.player) {
      this.step -= 1;
      return;
    }
    this.step -= 1;
    this.army.move(next);
  }

  isActive(): boolean {
    return this.active;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }

  /**
   * Claims connected foreign land inside the troop radius, nearest first.
   * Returns true while any claimable tile in that disk is still unowned.
   * The disk is scanned once; a capture only reconsiders its foreign neighbors.
   */
  private push(goal: TileRef): boolean {
    const army = this.army;
    if (army === undefined) return false;
    const origin = army.tile();
    const radius = armyRadius(this.troops);
    const blocked = this.blockedTiles(origin, radius);
    const ax = this.mg.x(origin);
    const ay = this.mg.y(origin);
    const sx = Math.sign(this.mg.x(goal) - ax);
    const sy = Math.sign(this.mg.y(goal) - ay);
    const limit = radius * radius;
    const nodes = new Map<TileRef, FrontierNode>();
    const heap = new FrontierHeap();

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const distSq = dx * dx + dy * dy;
        if (distSq > limit) continue;
        const x = ax + dx;
        const y = ay + dy;
        if (!this.mg.isValidCoord(x, y)) continue;
        const tile = this.mg.ref(x, y);
        if (blocked.has(tile) || !this.canClaim(tile)) continue;
        const owned = this.ownedNeighbors(tile);
        if (owned === 0) continue;
        const node: FrontierNode = {
          tile,
          distSq,
          forward: dx * sx + dy * sy,
          owned,
          seq: 0,
        };
        nodes.set(tile, node);
        heap.push(node);
      }
    }
    if (heap.length === 0) return false;
    this.captureBudget += landSpeed(this.mg.biome(origin)) * (2 * radius);

    while (heap.length > 0) {
      const entry = heap.pop();
      if (entry === undefined) break;
      const node = entry.node;
      if (entry.seq !== node.seq || nodes.get(node.tile) !== node) continue;
      if (!this.canClaim(node.tile)) {
        nodes.delete(node.tile);
        continue;
      }
      const cost = 1 / landSpeed(this.mg.biome(node.tile));
      if (this.captureBudget < cost) return true;
      this.captureBudget -= cost;
      this.take(node.tile);
      nodes.delete(node.tile);
      const count = this.mg.neighbors4(node.tile, this.nbuf2);
      for (let i = 0; i < count; i++) {
        const nb = this.nbuf2[i];
        if (blocked.has(nb) || !this.canClaim(nb)) continue;
        const nx = this.mg.x(nb) - ax;
        const ny = this.mg.y(nb) - ay;
        if (nx * nx + ny * ny > limit) continue;
        const existing = nodes.get(nb);
        if (existing !== undefined) {
          existing.owned += 1;
          existing.seq += 1;
          heap.push(existing);
          continue;
        }
        const owned = this.ownedNeighbors(nb);
        if (owned === 0) continue;
        const added: FrontierNode = {
          tile: nb,
          distSq: nx * nx + ny * ny,
          forward: nx * sx + ny * sy,
          owned,
          seq: 0,
        };
        nodes.set(nb, added);
        heap.push(added);
      }
    }
    return false;
  }

  private canClaim(tile: TileRef): boolean {
    if (this.mg.owner(tile) === this.player) return false;
    if (!this.mg.isLand(tile) || this.mg.isImpassable(tile)) return false;
    return true;
  }

  private ownedNeighbors(tile: TileRef): number {
    let count = 0;
    const n = this.mg.neighbors4(tile, this.nbuf);
    for (let i = 0; i < n; i++) {
      if (this.mg.owner(this.nbuf[i]) === this.player) count++;
    }
    return count;
  }

  private blockedTiles(origin: TileRef, radius: number): Set<TileRef> {
    const blocked = new Set<TileRef>();
    for (const hit of this.mg.nearbyUnits(origin, radius, [
      UnitType.City,
      UnitType.Army,
    ])) {
      const unit = hit.unit;
      if (!unit.isActive()) continue;
      if (unit.type() === UnitType.Army && unit.owner() === this.player) {
        continue;
      }
      blocked.add(unit.tile());
    }
    return blocked;
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
        if (!this.mg.isLand(neighbor) || this.mg.isImpassable(neighbor))
          continue;
        if (this.mg.owner(neighbor) !== owner) continue;
        const d = this.mg.manhattanDist(tile, neighbor);
        if (d < bestD) {
          bestD = d;
          best = neighbor;
        }
      }
    }
    if (best !== null) return best;
    for (const tile of this.player.borderTiles()) return tile;
    return 0;
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
    const n = this.mg.neighbors4(from, this.nbuf);
    for (let i = 0; i < n; i++) {
      const neighbor = this.nbuf[i];
      if (!this.mg.isLand(neighbor) || this.mg.isImpassable(neighbor)) continue;
      const d = this.mg.manhattanDist(neighbor, goal);
      if (d < bestD) {
        bestD = d;
        best = neighbor;
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
    for (const hit of this.mg.nearbyUnits(tile, 1, [
      UnitType.DefensePost,
      UnitType.Port,
      UnitType.Mine,
      UnitType.Farm,
    ])) {
      if (hit.unit.tile() !== tile || !hit.unit.isActive()) continue;
      if (hit.unit.type() === UnitType.DefensePost)
        hit.unit.delete(true, this.player);
      else if (hit.unit.owner() !== this.player)
        this.player.captureUnit(hit.unit);
    }
  }

  private besiege(city: Unit): void {
    const posts = this.mg
      .nearbyUnits(
        city.tile(),
        this.mg.config().defensePostRange(),
        UnitType.DefensePost,
      )
      .filter(
        (h) => h.unit.owner() === city.owner() && h.unit.isActive(),
      ).length;
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
      captureBudget: this.captureBudget,
      army: this.army !== undefined ? w.unit(this.army) : null,
      existingUnitId: this.existingUnitId,
    });
  }

  restoreSnapshot(s: z.infer<typeof ArmyStateSchema>, r: SnapshotReader): void {
    this.mg = r.game;
    this.active = s.active;
    this.player = r.player(s.player);
    this.troops = s.troops;
    this.target = s.target;
    this.step = s.step;
    this.captureBudget = s.captureBudget;
    this.army = s.army === null ? undefined : r.unit(s.army);
    this.existingUnitId = s.existingUnitId;
    if (this.army !== undefined) armyTroops.set(this.army.id(), this.troops);
  }
}

/** Drops carried troops on a shore tile and marches that army. */
export function marchLandedArmy(
  game: Game,
  player: Player,
  tile: TileRef,
  troops: number,
): void {
  const army = player.buildUnit(UnitType.Army, tile, {
    troops: 0,
    targetTile: tile,
  });
  setArmyTroops(army.id(), troops);
  game.addExecution(new ArmyExecution(player, troops, tile, army.id()));
}

const ArmyStateSchema = z.object({
  active: z.boolean(),
  player: zPlayerRef(),
  troops: zInt(),
  target: zTile(),
  step: z.number(),
  captureBudget: z.number(),
  army: z.number().int().nullable(),
  existingUnitId: z.number().int().nullable(),
});

export const ArmyExecutionSnapshot = execSnapshotType({
  name: "Army",
  version: 3,
  schema: ArmyStateSchema,
  migrations: {
    1: (d) => ({ ...d, existingUnitId: null }),
    2: (d) => ({ ...d, captureBudget: 0 }),
  },
  cls: () => ArmyExecution,
});

interface FrontierNode {
  tile: TileRef;
  distSq: number;
  forward: number;
  owned: number;
  seq: number;
}

/** Min-heap. Equal keys keep the earlier node; stale seqs are skipped by the caller. */
class FrontierHeap {
  private data: { node: FrontierNode; seq: number }[] = [];

  get length(): number {
    return this.data.length;
  }

  push(node: FrontierNode): void {
    this.data.push({ node, seq: node.seq });
    this.siftUp(this.data.length - 1);
  }

  pop(): { node: FrontierNode; seq: number } | undefined {
    const data = this.data;
    if (data.length === 0) return undefined;
    const top = data[0];
    const last = data.pop();
    if (last !== undefined && data.length > 0) {
      data[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  private siftUp(index: number): void {
    const data = this.data;
    const entry = data[index];
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!frontierBefore(entry.node, data[parent].node)) break;
      data[index] = data[parent];
      index = parent;
    }
    data[index] = entry;
  }

  private siftDown(index: number): void {
    const data = this.data;
    const entry = data[index];
    const n = data.length;
    while (true) {
      const left = index * 2 + 1;
      if (left >= n) break;
      const right = left + 1;
      let child = left;
      if (right < n && frontierBefore(data[right].node, data[left].node)) {
        child = right;
      }
      if (!frontierBefore(data[child].node, entry.node)) break;
      data[index] = data[child];
      index = child;
    }
    data[index] = entry;
  }
}

function frontierBefore(a: FrontierNode, b: FrontierNode): boolean {
  if (a.distSq !== b.distSq) return a.distSq < b.distSq;
  if (a.forward !== b.forward) return a.forward > b.forward;
  if (a.owned !== b.owned) return a.owned > b.owned;
  return a.tile < b.tile;
}
