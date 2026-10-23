import {
  BRONZE_WEAPONS_COST,
  EXCHANGE_RATE,
  MARKETS_COST,
} from "@openfront/engine-lib/game/BronzeRules";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type { ExecRecord } from "../snapshot/SnapshotContext";

/** Spends science once and sets the matching technology flag. */
export class ResearchExecution implements Execution {
  constructor(
    private player: Player,
    private tech: "bronze_weapons" | "markets",
  ) {}

  init(_mg: Game, _ticks: number): void {
    const cost = this.tech === "bronze_weapons" ? BRONZE_WEAPONS_COST : MARKETS_COST;
    const already =
      this.tech === "bronze_weapons"
        ? this.player.hasBronzeWeapons()
        : this.player.hasMarkets();
    if (already) return;
    if (this.player.science() < cost) return;
    this.player.removeScience(cost);
    if (this.tech === "bronze_weapons") this.player.unlockBronzeWeapons();
    else this.player.unlockMarkets();
  }

  tick(): void {}
  isActive(): boolean {
    return false;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }
  snapshot(): ExecRecord {
    return ResearchExecutionSnapshot.write({});
  }
  restoreSnapshot(): void {}
}

export const ResearchExecutionSnapshot = execSnapshotType({
  name: "Research",
  version: 1,
  schema: z.object({}),
  cls: () => ResearchExecution,
});

/**
 * Markets convert three of one resource into one of the other. The panel
 * shows that ratio before the intent is sent; this only commits it.
 */
export class ExchangeExecution implements Execution {
  constructor(
    private player: Player,
    private direction: "food_to_money" | "money_to_food",
    private amount: number,
  ) {}

  init(_mg: Game, _ticks: number): void {
    if (!this.player.hasMarkets()) return;
    const groups = Math.floor(this.amount / Number(EXCHANGE_RATE));
    if (groups < 1) return;
    const spend = BigInt(groups) * EXCHANGE_RATE;
    const gain = BigInt(groups);
    if (this.direction === "food_to_money") {
      if (this.player.food() < spend) return;
      this.player.addFood(-spend);
      this.player.addGold(gain);
      return;
    }
    if (this.player.gold() < spend) return;
    this.player.removeGold(spend);
    this.player.addFood(gain);
  }

  tick(): void {}
  isActive(): boolean {
    return false;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }
  snapshot(): ExecRecord {
    return ExchangeExecutionSnapshot.write({});
  }
  restoreSnapshot(): void {}
}

export const ExchangeExecutionSnapshot = execSnapshotType({
  name: "Exchange",
  version: 1,
  schema: z.object({}),
  cls: () => ExchangeExecution,
});
