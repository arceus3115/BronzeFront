import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  PlayerType,
  Structures,
  TerraNullius,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import {
  readVersioned,
  snapshotType,
  Versioned,
  zNum,
  zRef,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Attack, Game, Player } from "../../game/Game";
import type {
  SnapshotReader,
  SnapshotWriter,
} from "../../snapshot/SnapshotContext";
import { AttackExecution } from "../AttackExecution";
import { hasHighStartingGold } from "../nation/NationUtils";

/** How tribes and nations send armies. Nations sail; tribes stay on land. */
export abstract class AiAttackBehavior {
  /** Troops already queued this decision, before the executions spend them. */
  protected troopsCommitted = 0;

  constructor(
    protected random: PseudoRandom,
    protected game: Game,
    protected player: Player,
    protected triggerRatio: number,
    protected reserveRatio: number,
    protected expandRatio: number,
  ) {}

  /** The owner supplies the shared PRNG, player and nation behaviors. */
  abstract snapshot(w: SnapshotWriter): Versioned;

  /** Tribes and nations store the same record; tribes leave the nation-only fields empty. */
  protected writeRecord(
    w: SnapshotWriter,
    botAttackTroopsSent: number,
    followedLandings: Attack[],
  ): Versioned {
    return w.versioned(AiAttackBehaviorSnapshot, {
      botAttackTroopsSent,
      followedLandings: followedLandings.map((a) => w.attack(a)),
      triggerRatio: this.triggerRatio,
      reserveRatio: this.reserveRatio,
      expandRatio: this.expandRatio,
    });
  }

  /** Fills the shared fields of a prototype-only shell; only assigns (see README). */
  protected restoreRecord(
    raw: unknown,
    r: SnapshotReader,
    random: PseudoRandom,
    player: Player,
  ): AiAttackState {
    const s = readVersioned(AiAttackBehaviorSnapshot, raw);
    this.random = random;
    this.game = r.game;
    this.player = player;
    this.troopsCommitted = 0;
    this.triggerRatio = s.triggerRatio;
    this.reserveRatio = s.reserveRatio;
    this.expandRatio = s.expandRatio;
    // Scratch buffer: always written before it is read.
    this.nbuf = [0, 0, 0, 0];
    return s;
  }

  /** Clears the troops already queued, once per attack decision. */
  beginDeployments(): void {
    this.troopsCommitted = 0;
  }

  sendAttack(target: Player | TerraNullius, force = false): boolean {
    if (target.isPlayer() && this.player.isFriendly(target)) return false;
    if (!force && !this.shouldAttack(target)) return false;

    if (target.isPlayer()) {
      if (this.player.sharesBorderWith(target)) {
        return this.sendLandAttack(target);
      }
    } else if (this.hasLandBorderWithTerraNullius()) {
      return this.sendLandAttack(target);
    }
    return this.sendNavalAttack(target);
  }

  /** Nations carry an army across water. Tribes do not sail. */
  protected sendNavalAttack(_target: Player | TerraNullius): boolean {
    return false;
  }

  /** Nations aim at a border city. Tribes take land and walk past cities. */
  protected prefersCities(): boolean {
    return false;
  }

  shouldAttack(other: Player | TerraNullius): boolean {
    return true;
  }

  findIncomingAttackPlayer(): Player | null {
    const incomingAttacks = this.player
      .incomingAttacks()
      .filter(
        (attack) =>
          !this.player.isFriendly(attack.attacker()) &&
          !this.ignoresAttacksFrom(attack.attacker()),
      );
    let largestAttack = 0;
    let largestAttacker: Player | undefined;
    for (const attack of incomingAttacks) {
      if (attack.troops() <= largestAttack) continue;
      largestAttack = attack.troops();
      largestAttacker = attack.attacker();
    }
    if (largestAttacker !== undefined) {
      return largestAttacker;
    }
    return null;
  }

  protected ignoresAttacksFrom(attacker: Player): boolean {
    return false;
  }

  protected hasTriggerRatioTroops(expansion = false): boolean {
    const ratio = this.player.troops() / this.reserveBasis(expansion);
    return ratio >= this.triggerRatio;
  }

  // The max troops troop ratios refer to. With high starting gold, cities don't hold back
  // expanding into free land and bots: built all at once, they'd stall it until troops grow back.
  protected reserveBasis(expansion: boolean): number {
    const config = this.game.config();
    return expansion && this.expandsPastCityTroops()
      ? config.maxTroopsWithoutCities(this.player)
      : config.maxTroops(this.player);
  }

  protected expandsPastCityTroops(): boolean {
    return hasHighStartingGold(this.game, this.player);
  }

  // Troops kept home when attacking target: the expand ratio for free land and bots holding
  // structures, as we need those back ASAP, the reserve ratio otherwise
  protected reserveTroops(target: Player | TerraNullius): number {
    const expansion = !target.isPlayer() || target.type() === PlayerType.Bot;
    const maxTroops = this.reserveBasis(expansion);
    const botWithStructures =
      target.isPlayer() &&
      target.type() === PlayerType.Bot &&
      target.units().some((u) => Structures.has(u.type()));
    const useReserve = target.isPlayer() && !botWithStructures;
    const reserveRatio = useReserve ? this.reserveRatio : this.expandRatio;
    return maxTroops * reserveRatio;
  }

  // `opponent` is a player we take on on purpose (see NationAttackBehavior).
  // Each army is 20% of the troops still on hand, and it does not leave if
  // that would drop the owner under its reserve.
  protected calculateAttackTroops(
    target: Player | TerraNullius,
    _sendTroops: (reserveTroops: number) => number,
    _opponent?: Player,
  ): number | null {
    const available = this.player.troops() - this.troopsCommitted;
    const spend = Math.floor(available * 0.2);
    if (spend < 1) return null;
    if (available - spend < this.reserveTroops(target)) return null;
    return spend;
  }

  protected sendLandAttack(
    target: Player | TerraNullius,
    sendTroops = (_reserveTroops: number) => 0,
    opponent?: Player,
  ): boolean {
    return this.commitArmy(target, undefined, sendTroops, opponent);
  }

  protected commitArmy(
    target: Player | TerraNullius,
    _tile: TileRef | undefined,
    sendTroops = (_reserveTroops: number) => 0,
    opponent?: Player,
  ): boolean {
    const troops = this.calculateAttackTroops(target, sendTroops, opponent);
    if (troops === null) return false;
    this.troopsCommitted += troops;
    this.game.addExecution(
      new AttackExecution(troops, this.player, target.id()),
    );
    return true;
  }

  protected attackTile(target: Player | TerraNullius): TileRef {
    if (this.prefersCities() && target.isPlayer()) {
      const city = this.cityTouchingUs(target);
      if (city !== null) return city;
    }
    return this.nearestBorderTile(target, !this.prefersCities());
  }

  private cityTouchingUs(enemy: Player): TileRef | null {
    let best: TileRef | null = null;
    let bestD = Infinity;
    for (const city of enemy.units(UnitType.City)) {
      if (!city.isActive() || city.isUnderConstruction()) continue;
      const tile = city.tile();
      let dist = Infinity;
      for (const n of this.game.neighbors(tile)) {
        if (!this.game.isLand(n) || this.game.owner(n) !== this.player)
          continue;
        dist = Math.min(dist, this.game.manhattanDist(n, tile));
      }
      if (dist < bestD) {
        bestD = dist;
        best = tile;
      }
    }
    return best;
  }

  private nearestBorderTile(
    target: Player | TerraNullius,
    skipCities: boolean,
  ): TileRef {
    const owner = target.isPlayer() ? target : this.game.terraNullius();
    let best: TileRef | null = null;
    let fallback: TileRef | null = null;
    let bestD = Infinity;
    let fallbackD = Infinity;
    for (const tile of this.player.borderTiles()) {
      for (const neighbor of this.game.neighbors(tile)) {
        if (!this.game.isLand(neighbor) || this.game.isImpassable(neighbor)) {
          continue;
        }
        if (this.game.owner(neighbor) !== owner) continue;
        const d = this.game.manhattanDist(tile, neighbor);
        if (skipCities && this.tileHasCity(neighbor)) {
          if (d < fallbackD) {
            fallbackD = d;
            fallback = neighbor;
          }
          continue;
        }
        if (d < bestD) {
          bestD = d;
          best = neighbor;
        }
      }
    }
    if (best !== null) return best;
    if (fallback !== null) return fallback;
    for (const tile of this.player.borderTiles()) return tile;
    return 0;
  }

  private tileHasCity(tile: TileRef): boolean {
    for (const hit of this.game.nearbyUnits(tile, 1, UnitType.City)) {
      if (hit.unit.tile() === tile && hit.unit.isActive()) return true;
    }
    return false;
  }

  private hasLandBorderWithTerraNullius(): boolean {
    // Allocation-free (neighbors() built an array per border tile and this
    // runs on every terra-nullius attack decision of every nation) — but
    // through for...of, not forEach: the dominant caller path answers true,
    // and the early exit matters more than the generator's overhead.
    const map = this.game.map();
    const nbuf = this.nbuf;
    for (const border of this.player.borderTiles()) {
      const n = map.neighbors4(border, nbuf);
      for (let i = 0; i < n; i++) {
        const neighbor = nbuf[i];
        if (
          map.isLand(neighbor) &&
          !map.isImpassable(neighbor) &&
          !map.hasOwner(neighbor)
        ) {
          return true;
        }
      }
    }
    return false;
  }

  protected nbuf: TileRef[] = [0, 0, 0, 0];
}

const AiAttackStateSchema = z.object({
  botAttackTroopsSent: zNum(),
  followedLandings: z.array(zRef()),
  triggerRatio: zNum(),
  reserveRatio: zNum(),
  expandRatio: zNum(),
});
type AiAttackState = z.infer<typeof AiAttackStateSchema>;

export const AiAttackBehaviorSnapshot = snapshotType({
  name: "AiAttackBehavior",
  version: 2,
  schema: AiAttackStateSchema,
  migrations: {
    // v1 nations never followed up landings
    1: (d) => ({ ...d, followedLandings: [] }),
  },
});
