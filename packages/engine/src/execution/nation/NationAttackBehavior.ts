import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  Cell,
  Difficulty,
  GameMode,
  GameType,
  HumansVsNations,
  PlayerType,
  Relation,
  Structures,
  TerraNullius,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { Versioned } from "@openfront/engine-lib/snapshot/SnapshotType";
import {
  assertNever,
  boundingBoxCenter,
  calculateBoundingBoxCenter,
} from "@openfront/engine-lib/Util";
import { Game, Player } from "../../game/Game";
import type {
  SnapshotReader,
  SnapshotWriter,
} from "../../snapshot/SnapshotContext";
import { DonateTroopsExecution } from "../DonateTroopExecution";
import { AiAttackBehavior } from "../utils/AiAttackBehavior";
import { planBotAttacks, walledInBots } from "./BotAnnexation";
import { NationAllianceBehavior } from "./NationAllianceBehavior";
import {
  EMOJI_ASSIST_ACCEPT,
  EMOJI_ASSIST_RELATION_TOO_LOW,
  EMOJI_ASSIST_TARGET_ALLY,
  EMOJI_ASSIST_TARGET_ME,
  NationEmojiBehavior,
} from "./NationEmojiBehavior";
import { findJuiciestTarget, findRunawayLeader } from "./NationUtils";
import type { NationWarshipBehavior } from "./NationWarshipBehavior";

// Reusable neighbor buffer for hot loops; the simulation is single-threaded.
type Box = { min: Cell; max: Cell } | null | undefined;

// Fewest tiles between two boxes (unknown boxes count as touching)
function boxGap(a: Box, b: Box): number {
  if (!a || !b) return 0;
  const dx = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x);
  const dy = Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y);
  return dx + dy;
}

export class NationAttackBehavior extends AiAttackBehavior {
  private botAttackTroopsSent: number = 0;
  // Only set during a maybeAttack call: our land neighbors
  private landNeighbors: Set<Player> | null = null;

  constructor(
    random: PseudoRandom,
    game: Game,
    player: Player,
    triggerRatio: number,
    reserveRatio: number,
    expandRatio: number,
    private allianceBehavior: NationAllianceBehavior,
    private emojiBehavior: NationEmojiBehavior,
    private warshipBehavior: NationWarshipBehavior,
  ) {
    super(random, game, player, triggerRatio, reserveRatio, expandRatio);
  }

  snapshot(w: SnapshotWriter): Versioned {
    return this.writeRecord(w, this.botAttackTroopsSent, []);
  }

  /** Fills a prototype-only shell; only assigns (see README). */
  restoreSnapshot(
    raw: unknown,
    r: SnapshotReader,
    random: PseudoRandom,
    player: Player,
    allianceBehavior: NationAllianceBehavior,
    emojiBehavior: NationEmojiBehavior,
    warshipBehavior: NationWarshipBehavior,
  ): void {
    const s = this.restoreRecord(raw, r, random, player);
    this.allianceBehavior = allianceBehavior;
    this.emojiBehavior = emojiBehavior;
    this.warshipBehavior = warshipBehavior;
    // Only set during a maybeAttack call, so always null between ticks.
    this.landNeighbors = null;
    this.botAttackTroopsSent = s.botAttackTroopsSent;
  }

  maybeAttack() {
    this.beginDeployments();
    try {
      this.chooseAttack();
    } finally {
      this.landNeighbors = null;
    }
  }

  protected override prefersCities(): boolean {
    return true;
  }

  protected override sendNavalAttack(target: Player | TerraNullius): boolean {
    const spend = super.calculateAttackTroops(target, () => 0);
    if (spend === null) return false;
    if (!this.warshipBehavior.carryArmy(target, spend)) return false;
    this.troopsCommitted += spend;
    if (target.isPlayer()) this.emojiBehavior.maybeSendAttackEmoji(target);
    return true;
  }

  private chooseAttack() {
    if (this.defendBesiegedCity()) return;

    // Neighbor visit order matters here: the set's insertion order feeds the
    // stable troop-count sort below, so ties keep border-discovery order.
    const borderingPlayerSet = new Set<Player>();
    let borderHasTerraNullius = false;
    const smallID = this.player.smallID();
    const visit = (t: number) => {
      if (!this.game.isLand(t) || this.game.isImpassable(t)) return;
      if (this.game.ownerID(t) === smallID) return;
      const owner = this.game.playerBySmallID(this.game.ownerID(t));
      if (owner.isPlayer()) borderingPlayerSet.add(owner);
      if (!this.game.hasOwner(t)) {
        borderHasTerraNullius = true;
      }
    };
    // forEach, not for..of: TileSet.values() is a generator.
    this.player.borderTiles().forEach((t) => {
      this.game.forEachNeighbor(t, visit);
    });
    this.landNeighbors = new Set(borderingPlayerSet);
    const playerNeighbors = this.player.nearby();
    for (const n of playerNeighbors) {
      if (n.isPlayer()) borderingPlayerSet.add(n);
    }
    const borderingPlayers = [...borderingPlayerSet].sort(
      (a, b) => a.troops() - b.troops(),
    );
    const borderingFriends = borderingPlayers.filter(
      (o) => this.player?.isFriendly(o) === true,
    );
    const borderingEnemies = borderingPlayers.filter(
      (o) => this.player?.isFriendly(o) === false,
    );

    // Attack unowned land (direct border or across a river)
    const hasTerraNullius =
      borderHasTerraNullius || playerNeighbors.some((n) => !n.isPlayer());
    if (hasTerraNullius) {
      if (this.sendAttack(this.game.terraNullius())) return;
    }

    if (borderingEnemies.length > 0) {
      this.allianceBehavior.maybeSendAllianceRequests(borderingEnemies);
    }

    this.attackBestTarget(borderingFriends, borderingEnemies);
  }

  /** An army on a friendly city that is already under siege counts as its defense. */
  private defendBesiegedCity(): boolean {
    let tile: TileRef | null = null;
    for (const city of this.player.units(UnitType.City)) {
      if (!city.isActive() || city.isUnderConstruction()) continue;
      if (this.game.siegeProgress(city.id()) <= 0) continue;
      tile = city.tile();
      break;
    }
    if (tile === null) return false;
    const attacker = this.findIncomingAttackPlayer();
    return this.commitArmy(attacker ?? this.game.terraNullius(), tile);
  }

  // attackBestTarget is called with borderingFriends and borderingEnemies sorted by troops (ascending)
  private attackBestTarget(
    borderingFriends: Player[],
    borderingEnemies: Player[],
  ) {
    const { difficulty } = this.game.config().gameConfig();

    // Hard & Impossible: answer attacks right away, even below the reserve and trigger ratios
    if (
      (difficulty === Difficulty.Hard ||
        difficulty === Difficulty.Impossible) &&
      this.retaliate()
    ) {
      return;
    }

    // A walled-in bot costs next to nothing to annex, so don't save up for it
    this.annexWalledInBots();

    // Attack bots before the ratio checks when they hold structures, which we need back,
    // and with high starting gold, as those checks count the troops of cities built in a rush
    if (
      this.hasNeighboringBotWithStructures() ||
      (this.expandsPastCityTroops() && this.hasTriggerRatioTroops(true))
    ) {
      if (this.attackBots()) return;
    }

    // Save up troops until we reach the reserve ratio
    if (!this.hasReserveRatioTroops()) return;

    // Medium: answer attacks without saving up to the trigger ratio first
    if (difficulty === Difficulty.Medium && this.retaliate()) return;

    // Maybe save up troops until we reach the trigger ratio
    if (!this.hasTriggerRatioTroops() && !this.random.chance(10)) return;

    // Get attack strategies in priority order based on difficulty
    const strategies = this.getAttackStrategies(
      borderingFriends,
      borderingEnemies,
    );

    for (const strategy of strategies) {
      if (strategy()) return;
    }
  }

  private getAttackStrategies(
    borderingFriends: Player[],
    borderingEnemies: Player[],
  ): Array<() => boolean> {
    const { difficulty } = this.game.config().gameConfig();

    // Target groups, tried in order and each sorted by troops (ascending). Hard & Impossible
    // without a land front weigh every enemy within boat range across the water alongside
    // the bordering ones; Impossible with a land front turns to them once it finds nothing there.
    let groups: Player[][] | null = null;
    const targetGroups = (): Player[][] => {
      if (groups !== null) return groups;
      const byTroops = (a: Player, b: Player) => a.troops() - b.troops();
      const landFront = borderingEnemies.some((enemy) =>
        this.bordersByLand(enemy),
      );
      if (difficulty === Difficulty.Impossible && landFront) {
        groups = [
          borderingEnemies,
          this.overseasTargets(borderingEnemies).sort(byTroops),
        ];
      } else if (
        (difficulty === Difficulty.Hard ||
          difficulty === Difficulty.Impossible) &&
        !landFront
      ) {
        groups = [
          [...borderingEnemies, ...this.overseasTargets(borderingEnemies)].sort(
            byTroops,
          ),
        ];
      } else {
        groups = [borderingEnemies];
      }
      return groups;
    };

    // What `find` picks among the targets we can reach right now, from the first group
    // where it picks anything (Easy doesn't check). Only its picks get a boat route planned.
    const pick = (
      find: (enemies: Player[]) => Player | null,
    ): Player | null => {
      for (const group of targetGroups()) {
        let pool = group;
        for (;;) {
          const target = find(pool);
          if (target === null) break;
          if (difficulty === Difficulty.Easy || this.canReach(target)) {
            return target;
          }
          pool = pool.filter((enemy) => enemy !== target);
        }
      }
      return null;
    };

    // Define all strategies as functions that return true if they attacked
    const retaliate = (): boolean => this.retaliate();

    const bots = (): boolean => this.attackBots();

    const assist = (): boolean => this.assistAllies();

    const traitor = (): boolean => {
      const traitor = pick((enemies) => this.findTraitor(enemies));
      if (traitor) {
        return this.sendAttack(traitor);
      }
      return false;
    };

    const afk = (): boolean => {
      // Groups are sorted by troops (ascending), so the first match is the weakest afk enemy
      const afk = pick(
        (enemies) =>
          enemies.find(
            (enemy) =>
              enemy.isDisconnected() &&
              (!this.isFFA() || enemy.troops() < this.player.troops() * 3),
          ) ?? null,
      );
      if (afk) {
        return this.sendAttack(afk);
      }
      return false;
    };

    const betray = (): boolean =>
      this.maybeBetrayAndAttack(borderingFriends, borderingEnemies);

    const victim = (): boolean => {
      const victim = pick((enemies) => this.findVictim(enemies));
      if (victim) {
        return this.sendAttack(victim);
      }
      return false;
    };

    const juicy = (): boolean => {
      const target = pick((enemies) => this.findJuicyTarget(enemies));
      return target !== null ? this.sendAttack(target) : false;
    };

    const hated = (): boolean => {
      for (const relation of this.player.allRelationsSorted()) {
        if (relation.relation !== Relation.Hostile) continue;
        const other = relation.player;
        if (this.player.isFriendly(other)) continue;
        if (this.isFFA() && other.troops() > this.player.troops() * 3) continue;
        if (difficulty !== Difficulty.Easy && !this.canReach(other)) continue;
        return this.sendAttack(other);
      }
      return false;
    };

    const veryWeak = (): boolean => {
      const veryWeak = pick((enemies) => this.findVeryWeakEnemy(enemies));
      if (veryWeak) {
        return this.sendAttack(veryWeak);
      }
      return false;
    };

    const weakest = (): boolean => {
      // Groups are sorted by troops (ascending), so the first match is the weakest.
      // In FFA, don't attack if they have more troops than us
      const weakest = pick(
        (enemies) =>
          enemies.find(
            (enemy) => !this.isFFA() || enemy.troops() < this.player.troops(),
          ) ?? null,
      );
      return weakest !== null ? this.sendAttack(weakest) : false;
    };

    const island = (): boolean => {
      if (pick((enemies) => enemies[0] ?? null) === null) {
        const enemy = this.findNearestIslandEnemy();
        if (enemy) {
          return this.sendAttack(enemy);
        }
      }
      return false;
    };

    const donate = (): boolean => this.donateTroops();

    const crown = (): boolean => {
      const leader = this.findCrownTarget(borderingEnemies);
      return (
        leader !== null &&
        this.shouldAttack(leader) &&
        this.sendLandAttack(leader, undefined, leader)
      );
    };

    // Return strategies in order based on difficulty
    // Easy nations get the dumbest order, impossible nations get the smartest order
    // Medium and up retaliate in attackBestTarget, ahead of the ratio checks
    switch (difficulty) {
      case Difficulty.Easy:
        // So dumb, they cant even find islanders
        // prettier-ignore
        return [bots, retaliate, assist, betray, hated, weakest];
      case Difficulty.Medium:
        // prettier-ignore
        return [bots, assist, betray, hated, afk, traitor, crown, weakest, island, donate];
      case Difficulty.Hard:
        // Strong veryWeak and juicy strats after the distracting hated strat, to make the nations weaker than impossible
        // prettier-ignore
        return [bots, assist, betray, traitor, afk, hated, veryWeak, juicy, victim, crown, weakest, island, donate];
      case Difficulty.Impossible:
        // prettier-ignore
        return [bots, veryWeak, betray, assist, victim, crown, traitor, juicy, afk, hated, weakest, island, donate];
      default:
        assertNever(difficulty);
    }
  }

  private hasNeighboringBotWithStructures(): boolean {
    return this.player
      .nearby()
      .some(
        (n) =>
          n.isPlayer() &&
          n.type() === PlayerType.Bot &&
          !this.player.isFriendly(n) &&
          n.units().some((u) => Structures.has(u.type())),
      );
  }

  private hasReserveRatioTroops(): boolean {
    const maxTroops = this.game.config().maxTroops(this.player);
    const ratio = this.player.troops() / maxTroops;
    return ratio >= this.reserveRatio;
  }

  private retaliate(): boolean {
    const attacker = this.findIncomingAttackPlayer();
    if (attacker === null) return false;
    const { difficulty } = this.game.config().gameConfig();
    if (
      (difficulty === Difficulty.Hard ||
        difficulty === Difficulty.Impossible) &&
      this.isFFA() &&
      this.player.sharesBorderWith(attacker)
    ) {
      return this.sendRetaliation(attacker);
    }
    return this.sendAttack(attacker, true);
  }

  // Hard & Impossible keep their troops home while under attack, Medium only sometimes
  // Cancels the attacker's incoming troops. If we can also match its home army
  // while keeping back what troopSendCap wants for every other neighbor, pushes
  // into its land with at least that much (the attacker isn't a threat then,
  // its army is busy with us). Otherwise only cancels, as far as the reserve allows.
  // Never dips below the expand ratio: troop growth nearly stops near zero.
  private sendRetaliation(attacker: Player): boolean {
    let incoming = 0;
    for (const attack of this.player.incomingAttacks()) {
      if (attack.attacker() === attacker) incoming += attack.troops();
    }
    let pressing = 0;
    for (const attack of this.player.outgoingAttacks()) {
      if (attack.target() === attacker) pressing += attack.troops();
    }
    const troops = this.player.troops();
    const maxTroops = this.game.config().maxTroops(this.player);
    const spare = Math.min(
      troops - maxTroops * this.expandRatio,
      this.neighborTroopCap(attacker),
    );
    const aboveReserve = troops - maxTroops * this.reserveRatio;
    const counter = incoming + Math.max(0, attacker.troops() - pressing);
    const send =
      spare >= counter
        ? Math.max(counter, Math.min(aboveReserve, spare))
        : Math.min(incoming, Math.max(spare, aboveReserve));
    return this.sendLandAttack(attacker, () => send, attacker);
  }

  /** Troops a strike on target could send now: above the reserve, and within troopSendCap without target. */
  strikeTroops(target: Player): number {
    const maxTroops = this.game.config().maxTroops(this.player);
    return Math.min(
      this.player.troops() - maxTroops * this.reserveRatio,
      this.troopSendCap(target),
    );
  }

  /** Attacks a bordering enemy, skipping the trigger ratio. */
  strike(target: Player): boolean {
    if (
      this.player.isFriendly(target) ||
      !this.player.sharesBorderWith(target)
    ) {
      return false;
    }
    return this.sendLandAttack(target, undefined, target);
  }

  // A bordering runaway leader. Hard & Impossible always consider it: the
  // too-weak check in calculateAttackTroops decides whether our stack, plus
  // the troops already attacking it, is worth it. Medium only joins attacks
  // already under way.
  private findCrownTarget(borderingEnemies: Player[]): Player | null {
    const leader = findRunawayLeader(this.game);
    if (
      leader === null ||
      !borderingEnemies.includes(leader) ||
      !this.player.sharesBorderWith(leader)
    ) {
      return null;
    }
    const { difficulty } = this.game.config().gameConfig();
    if (
      difficulty === Difficulty.Hard ||
      difficulty === Difficulty.Impossible
    ) {
      return leader;
    }
    return this.incomingTroops(leader) >= leader.troops() * 0.1 ? leader : null;
  }

  private incomingTroops(target: Player): number {
    return target.incomingAttacks().reduce((sum, a) => sum + a.troops(), 0);
  }

  // Sort neighboring bots by density (troops / tiles) and attempt to attack many of them (Parallel attacks)
  // sendAttack will do nothing if we don't have enough reserve troops left
  // Bots that own structures are prioritized as targets (they might have stolen our structures and they will delete them!)
  // Hard & Impossible order them to wall in other bots instead (see planBotAttacks)
  private attackBots(): boolean {
    const bots = this.neighboringBots();
    if (bots.length === 0) {
      return false;
    }

    this.botAttackTroopsSent = 0;

    let ordered: Player[];
    if (this.annexesBots()) {
      ordered = planBotAttacks(this.game, this.player, bots);
    } else {
      const density = (p: Player) => p.troops() / p.numTilesOwned();
      ordered = bots.slice().sort((a, b) => density(a) - density(b));
    }
    const ownsStructures = (p: Player) =>
      p.units().some((u) => Structures.has(u.type()));
    const sortedBots = ordered.sort(
      (a, b) => Number(ownsStructures(b)) - Number(ownsStructures(a)),
    );
    const reducedBots = sortedBots.slice(0, this.getBotAttackMaxParallelism());

    for (const bot of reducedBots) {
      this.sendAttack(bot);
    }

    // Only short-circuit the rest of the targeting pipeline if we actually
    // allocated some troops to bot attacks. Hard & Impossible only top up
    // running attacks, so those count as well.
    return (
      this.botAttackTroopsSent > 0 ||
      (this.annexesBots() &&
        this.player
          .outgoingAttacks()
          .some((attack) => reducedBots.some((bot) => bot === attack.target())))
    );
  }

  private neighboringBots(): Player[] {
    return this.player
      .nearby()
      .filter(
        (n): n is Player =>
          n.isPlayer() &&
          this.player.isFriendly(n) === false &&
          n.type() === PlayerType.Bot,
      );
  }

  // Hard & Impossible take bots in an order that walls others in, annexing them for free
  private annexesBots(): boolean {
    const { difficulty } = this.game.config().gameConfig();
    return (
      difficulty === Difficulty.Hard || difficulty === Difficulty.Impossible
    );
  }

  // The engine only checks a bot for annexation when its land changes,
  // so a 1% attack makes it hand over a bot only we border
  private annexWalledInBots(): void {
    if (!this.annexesBots()) return;
    const bots = this.neighboringBots();
    if (bots.length === 0) return;
    for (const bot of walledInBots(this.game, this.player, bots)) {
      this.sendLandAttack(bot);
    }
  }

  private getBotAttackMaxParallelism(): number {
    const { difficulty } = this.game.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        return 1;
      case Difficulty.Medium:
        return this.random.chance(2) ? 1 : 2;
      case Difficulty.Hard:
        return 3;
      // On impossible difficulty, attack as much bots as possible in parallel
      case Difficulty.Impossible: {
        return 100;
      }
      default:
        assertNever(difficulty);
    }
  }

  private assistAllies(): boolean {
    if (this.game.config().disableAlliances()) return false;

    for (const ally of this.player.allies()) {
      if (ally.targets().length === 0) continue;
      if (this.player.relation(ally) < Relation.Friendly) {
        this.emojiBehavior.sendEmoji(ally, EMOJI_ASSIST_RELATION_TOO_LOW);
        continue;
      }
      for (const target of ally.targets()) {
        if (target === this.player) {
          this.emojiBehavior.sendEmoji(ally, EMOJI_ASSIST_TARGET_ME);
          continue;
        }
        if (this.player.isFriendly(target)) {
          this.emojiBehavior.sendEmoji(ally, EMOJI_ASSIST_TARGET_ALLY);
          continue;
        }
        if (!this.sendAttack(target)) continue;
        this.player.updateRelation(ally, -20);
        this.emojiBehavior.sendEmoji(ally, EMOJI_ASSIST_ACCEPT);
        return true;
      }
    }
    return false;
  }

  // Find a traitor who isn't significantly stronger than us
  private findTraitor(enemies: Player[]): Player | null {
    if (this.game.config().disableAlliances()) return null;

    // enemies is already sorted by troops (ascending), so first match is weakest traitor
    return (
      enemies.find(
        (enemy) =>
          enemy.isTraitor() &&
          (!this.isFFA() || enemy.troops() < this.player.troops() * 1.2),
      ) ?? null
    );
  }

  private maybeBetrayAndAttack(
    borderingFriends: Player[],
    borderingEnemies: Player[],
  ): boolean {
    if (this.game.config().disableAlliances()) return false;

    if (borderingFriends.length > 0) {
      // Computed once here, not per friend below - it doesn't depend on which one.
      const juiciestAlly =
        this.allianceBehavior.findJuiciestAlly(borderingFriends);
      for (const friend of borderingFriends) {
        if (
          this.allianceBehavior.maybeBetray(
            friend,
            juiciestAlly,
            borderingFriends,
            borderingEnemies,
          )
        ) {
          return this.sendAttack(friend, true);
        }
      }
    }
    return false;
  }

  // Find someone who isn't significantly stronger than us and is under big attack from others (50%+ of their troops incoming)
  private findVictim(enemies: Player[]): Player | null {
    // enemies is already sorted by troops (ascending), so first match is weakest victim
    return (
      enemies.find((enemy) => {
        if (this.isFFA() && enemy.troops() > this.player.troops() * 1.2) {
          return false;
        }

        const totalIncomingTroops = enemy
          .incomingAttacks()
          .reduce((sum, attack) => sum + attack.troops(), 0);

        return totalIncomingTroops > enemy.troops() * 0.5;
      }) ?? null
    );
  }

  // Find very weak (less than 15% of their maxTroops) enemies
  // which also don't have significantly more troops than us
  private findVeryWeakEnemy(enemies: Player[]): Player | null {
    const veryWeakEnemies = enemies.filter((enemy) => {
      const enemyMaxTroops = this.game.config().maxTroops(enemy);
      return (
        enemy.troops() < enemyMaxTroops * 0.15 &&
        (!this.isFFA() || enemy.troops() < this.player.troops() * 1.2)
      );
    });

    // enemies is already sorted by troops (ascending), so first match is weakest very weak enemy
    return veryWeakEnemies.length > 0 ? veryWeakEnemies[0] : null;
  }

  // Juiciest enemy (Hard & Impossible only) we could plausibly beat (troops <= 75% of ours)
  private findJuicyTarget(enemies: Player[]): Player | null {
    const candidates = enemies.filter(
      (enemy) => enemy.troops() <= this.player.troops() * 0.75,
    );
    return findJuiciestTarget(this.game, candidates);
  }

  private findNearestIslandEnemy(): Player | null {
    if (!this.warshipBehavior.canCarry()) return null;

    const filteredPlayers = this.game.players().filter((p) => {
      if (p === this.player) return false;
      if (this.player.isFriendly(p)) return false;
      // In FFA, don't spam boats into players with more troops
      return !this.isFFA() || p.troops() < this.player.troops();
    });

    if (filteredPlayers.length === 0) return null;

    const playerCenter = this.getPlayerCenter(this.player);

    const sortedPlayers = filteredPlayers
      .map((filteredPlayer) => {
        const filteredPlayerCenter = this.getPlayerCenter(filteredPlayer);

        const playerCenterTile = this.game.ref(playerCenter.x, playerCenter.y);
        const filteredPlayerCenterTile = this.game.ref(
          filteredPlayerCenter.x,
          filteredPlayerCenter.y,
        );

        const distance = this.game.manhattanDist(
          playerCenterTile,
          filteredPlayerCenterTile,
        );
        return { player: filteredPlayer, distance };
      })
      .sort((a, b) => a.distance - b.distance); // Sort by distance (ascending)

    // Try players in order of distance until we find reachable candidates.
    // Beachhead boats sail any distance, even past a warship: nothing nearer is left to attack.
    const reachablePlayers: Player[] = [];
    for (const entry of sortedPlayers) {
      if (this.canReach(entry.player)) {
        reachablePlayers.push(entry.player);
        // We only need up to 2 reachable candidates
        if (reachablePlayers.length >= 2) break;
      }
    }

    if (reachablePlayers.length === 0) return null;

    // 33% chance to pick the second-nearest player if available
    if (reachablePlayers.length >= 2 && this.random.chance(3)) {
      return reachablePlayers[1];
    }

    return reachablePlayers[0];
  }

  // In team games, nations should be willing to attack/boat into stronger
  // enemies - they can rely on teammates to donate. In FFA, going after
  // someone significantly stronger is usually a losing proposition.
  private isFFA(): boolean {
    return this.game.config().gameConfig().gameMode === GameMode.FFA;
  }

  private getPlayerCenter(player: Player) {
    if (player.largestClusterBoundingBox) {
      return boundingBoxCenter(player.largestClusterBoundingBox);
    }
    return calculateBoundingBoxCenter(this.game, player.borderTiles());
  }

  forceSendAttack(target: Player | TerraNullius) {
    this.beginDeployments();
    this.sendAttack(target, true);
  }

  override shouldAttack(other: Player | TerraNullius): boolean {
    if (
      // Always attack Terra Nullius, non-humans and traitors
      other.isPlayer() === false ||
      other.type() !== PlayerType.Human ||
      other.isTraitor() ||
      // Always attack in an HvN game
      this.game.config().gameConfig().playerTeams === HumansVsNations
    ) {
      return true;
    }

    // Prevent attacking of humans on lower difficulties
    const { difficulty } = this.game.config().gameConfig();
    if (difficulty === Difficulty.Easy && this.random.nextInt(0, 4) !== 0) {
      return false;
    }
    if (difficulty === Difficulty.Medium && this.random.chance(4)) {
      return false;
    }
    return true;
  }

  // Bot attacks don't count as threats
  protected override ignoresAttacksFrom(attacker: Player): boolean {
    return attacker.type() === PlayerType.Bot;
  }

  /**
   * For Hard & Impossible nations in FFA: returns true if `troops` is less
   * than 20% of the target's troop count, meaning the attack is too weak to
   * be worthwhile.  Team games are exempt.
   */
  private isAttackTooWeak(troops: number, target: Player): boolean {
    if (this.game.config().gameConfig().gameMode === GameMode.Team)
      return false;
    // Nations under attack may retaliate freely
    if (this.player.incomingAttacks().length > 0) return false;
    const { difficulty } = this.game.config().gameConfig();
    return (
      (difficulty === Difficulty.Hard ||
        difficulty === Difficulty.Impossible) &&
      troops < target.troops() * 0.2
    );
  }

  /**
   * For Hard & Impossible nations in FFA: computes the max troops this nation
   * can send in an attack without letting its troop count drop below a
   * fraction of its strongest non-allied neighbor's troop count (Hard: 75%,
   * Impossible: 90%). Allied players and bot neighbors are not considered
   * threats. Team games are entirely exempt. Returns Infinity when
   * no cap applies.
   *
   * Nations under attack may retaliate with at least the total incoming
   * attack troops, even if that exceeds the neighbor-based cap. `ignore` is
   * left out of the neighbor threat (the player being retaliated against).
   */
  private troopSendCap(ignore?: Player): number {
    let cap = this.neighborTroopCap(ignore);

    // Nations under attack may retaliate with at least the incoming troops
    const incoming = this.player.incomingAttacks();
    if (incoming.length > 0) {
      const totalIncoming = incoming.reduce((sum, a) => sum + a.troops(), 0);
      cap = Math.max(cap, totalIncoming);
    }

    return cap;
  }

  // troopSendCap() without the allowance for nations under attack
  private neighborTroopCap(ignore?: Player): number {
    if (this.game.config().gameConfig().gameMode === GameMode.Team)
      return Infinity;

    const { difficulty } = this.game.config().gameConfig();
    let retainFraction: number;
    switch (difficulty) {
      case Difficulty.Hard:
        retainFraction = 0.75;
        break;
      case Difficulty.Impossible:
        retainFraction = 0.9;
        break;
      default:
        return Infinity;
    }

    let maxNeighborTroops = 0;
    for (const n of this.player.nearby()) {
      if (
        n.isPlayer() &&
        n !== ignore &&
        !this.player.isFriendly(n) &&
        n.type() !== PlayerType.Bot &&
        n.troops() > maxNeighborTroops
      ) {
        maxNeighborTroops = n.troops();
      }
    }

    if (maxNeighborTroops === 0) return Infinity;
    const minRetained = Math.ceil(maxNeighborTroops * retainFraction);
    return Math.max(0, this.player.troops() - minRetained);
  }

  // Each army is 20% of the troops still on hand. Hard and Impossible still
  // refuse a send that is under 20% of the target's troops.
  protected override calculateAttackTroops(
    target: Player | TerraNullius,
    sendTroops: (reserveTroops: number) => number,
    opponent?: Player,
  ): number | null {
    const spend = super.calculateAttackTroops(target, sendTroops, opponent);
    if (spend === null) return null;
    const pileOn =
      target.isPlayer() && target === opponent
        ? this.incomingTroops(target)
        : 0;
    if (target.isPlayer() && this.isAttackTooWeak(spend + pileOn, target)) {
      return null;
    }
    if (target.isPlayer()) {
      this.emojiBehavior.maybeSendAttackEmoji(target);
    }
    if (target.isPlayer() && target.type() === PlayerType.Bot) {
      this.botAttackTroopsSent += spend;
    }
    return spend;
  }

  private bordersByLand(target: Player): boolean {
    return (
      this.landNeighbors?.has(target) ?? this.player.sharesBorderWith(target)
    );
  }

  /** By land, or across water when a warship can carry an army that far. */
  private canReach(target: Player): boolean {
    if (this.bordersByLand(target)) return true;
    if (!this.warshipBehavior.canCarry()) return false;
    return (
      boxGap(
        this.player.largestClusterBoundingBox,
        target.largestClusterBoundingBox,
      ) <= this.maxBoatRoute()
    );
  }

  // Hard and Impossible stay within this distance when the only route is water.
  private maxBoatRoute(): number {
    const { difficulty } = this.game.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
      case Difficulty.Medium:
        return Infinity;
      case Difficulty.Hard:
        return 300;
      case Difficulty.Impossible:
        return 500;
      default:
        assertNever(difficulty);
    }
  }

  // Enemies across the water (not bordering us) whose main territory is within boat range
  // of ours; whether a boat really gets there is left to canReach
  private overseasTargets(borderingEnemies: Player[]): Player[] {
    if (!this.warshipBehavior.canCarry()) return [];
    const range = this.maxBoatRoute();
    const ours = this.player.largestClusterBoundingBox;
    return this.game
      .players()
      .filter(
        (p) =>
          p !== this.player &&
          p.type() !== PlayerType.Bot &&
          !this.player.isFriendly(p) &&
          !borderingEnemies.includes(p) &&
          (!this.isFFA() || p.troops() < this.player.troops()) &&
          boxGap(ours, p.largestClusterBoundingBox) <= range,
      );
  }

  // Hard & Impossible send warships at whatever blocks the juiciest target they couldn't reach.
  // Without a land front any distance counts: the sea is the only way to attack.
  // Keeps the attack at its cheapest loss rate until the bot collapses below 100 tiles
  // Troops lost per tile at that stack: Impossible reads the terrain on a 6x6 grid
  // over the bot's land, Hard assumes highland
  // Land attacks on the same target merge, so these troops join the next one we send,
  // while the target's attacks on us cancel out against it
  private donateTroops(): boolean {
    // Only donate in team games
    if (this.game.config().gameConfig().gameMode !== GameMode.Team) {
      return false;
    }

    // Don't donate in public games (To balance HvN)
    if (this.game.config().gameConfig().gameType === GameType.Public) {
      return false;
    }

    // Check if donating troops is allowed
    if (this.game.config().donateTroops() === false) {
      return false;
    }

    // Skip donating based on difficulty
    const { difficulty } = this.game.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        // Easy nations don't donate
        return false;
      case Difficulty.Medium:
        // Medium nations donate 25% of the time
        if (!this.random.chance(4)) {
          return false;
        }
        break;
      case Difficulty.Hard:
        // Hard nations donate 50% of the time
        if (!this.random.chance(2)) {
          return false;
        }
        break;
      case Difficulty.Impossible:
        // Impossible nations always try to donate
        break;
      default:
        assertNever(difficulty);
    }

    // Find teammates who are currently in combat
    const teammates = this.game
      .players()
      .filter((p) => this.player.isOnSameTeam(p))
      .filter(
        (p) => p.incomingAttacks().length > 0 || p.outgoingAttacks().length > 0,
      );

    if (teammates.length === 0) {
      return false;
    }

    // Find teammate with lowest troop percentage (troops / maxTroops)
    const teammatesWithTroopPercentage = teammates
      .map((teammate) => {
        const maxTroops = this.game.config().maxTroops(teammate);
        const troopPercentage = teammate.troops() / Math.max(maxTroops, 1);
        return { teammate, troopPercentage };
      })
      .sort((a, b) => a.troopPercentage - b.troopPercentage);

    // Try to donate to teammates in order of lowest troop percentage
    let selectedTeammate: Player | null = null;
    for (const entry of teammatesWithTroopPercentage) {
      if (this.player.canDonateTroops(entry.teammate)) {
        selectedTeammate = entry.teammate;
        break;
      }
    }

    if (selectedTeammate === null) {
      return false;
    }

    // Donate a portion of our troops (keeping reserve)
    const maxTroops = this.game.config().maxTroops(this.player);
    const troopsToKeep = maxTroops * this.reserveRatio;
    const availableTroops = this.player.troops() - troopsToKeep;

    if (availableTroops < 1) {
      return false;
    }

    this.game.addExecution(
      new DonateTroopsExecution(
        this.player,
        selectedTeammate.id(),
        availableTroops,
      ),
    );

    return true;
  }
}
