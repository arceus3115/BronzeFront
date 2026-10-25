import {
  ClientID,
  GameID,
  StampedIntent,
  Turn,
} from "@openfront/engine-api/Schemas";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { simpleHash } from "@openfront/engine-lib/Util";
import { Execution, Game } from "../game/Game";
import { AllianceExtensionExecution } from "./alliance/AllianceExtensionExecution";
import { AllianceRejectExecution } from "./alliance/AllianceRejectExecution";
import { AllianceRequestExecution } from "./alliance/AllianceRequestExecution";
import { BreakAllianceExecution } from "./alliance/BreakAllianceExecution";
import { AttackExecution } from "./AttackExecution";
import { ExchangeExecution, ResearchExecution } from "./BronzeTechExecution";
import { ConstructionExecution } from "./ConstructionExecution";
import { DeleteUnitExecution } from "./DeleteUnitExecution";
import { DonateGoldExecution } from "./DonateGoldExecution";
import { DonateTroopsExecution } from "./DonateTroopExecution";
import { EmbargoAllExecution } from "./EmbargoAllExecution";
import { EmbargoExecution } from "./EmbargoExecution";
import { EmojiExecution } from "./EmojiExecution";
import { MarkDisconnectedExecution } from "./MarkDisconnectedExecution";
import { MoveWarshipExecution } from "./MoveWarshipExecution";
import { NationExecution } from "./NationExecution";
import { NoOpExecution } from "./NoOpExecution";
import { PauseExecution } from "./PauseExecution";
import { QuickChatExecution } from "./QuickChatExecution";
import { RetreatExecution } from "./RetreatExecution";
import { SpawnExecution } from "./SpawnExecution";
import { TargetPlayerExecution } from "./TargetPlayerExecution";
import { TribeSpawner } from "./TribeSpawner";
import { UpgradeStructureExecution } from "./UpgradeStructureExecution";
import { PlayerSpawner } from "./utils/PlayerSpawner";
import { WarshipCargoExecution } from "./WarshipCargoExecution";

export class Executor {
  // private random = new PseudoRandom(999)
  private random: PseudoRandom;

  constructor(
    private mg: Game,
    private gameID_: GameID,
    private clientID: ClientID | undefined,
    // Purchased bot tribe names drawn for this game (GameStartInfo.tribes).
    private purchasedTribeNames: string[] = [],
  ) {
    // Add one to avoid id collisions with tribes.
    this.random = new PseudoRandom(simpleHash(gameID_) + 1);
  }

  gameID(): GameID {
    return this.gameID_;
  }

  createExecs(turn: Turn): Execution[] {
    return turn.intents.map((i) => this.createExec(i));
  }

  createExec(intent: StampedIntent): Execution {
    const player = this.mg.playerByClientID(intent.clientID);
    if (!player) {
      console.warn(`player with clientID ${intent.clientID} not found`);
      return new NoOpExecution();
    }

    // create execution
    switch (intent.type) {
      case "attack":
        // The clicked tile is not a source. The flood starts from the border.
        return new AttackExecution(intent.troops, player, intent.targetID);
      case "order_army":
        return new NoOpExecution();
      case "research":
        return new ResearchExecution(player, intent.tech);
      case "exchange":
        return new ExchangeExecution(player, intent.direction, intent.amount);
      case "warship_cargo":
        return new WarshipCargoExecution(
          player,
          intent.unitId,
          intent.action,
          intent.amount,
          intent.tile,
        );
      case "boat":
      case "cancel_boat":
        return new NoOpExecution();
      case "cancel_attack":
        return new RetreatExecution(player, intent.attackID);
      case "move_warship":
        return new MoveWarshipExecution(player, intent.unitIds, intent.tile);
      case "spawn":
        // fromIntent: this one came off the wire, so it is subject to the
        // spawn-phase gate that internal spawns are not.
        return new SpawnExecution(
          this.gameID_,
          player.info(),
          intent.tile,
          true,
        );
      case "allianceRequest":
        return new AllianceRequestExecution(player, intent.recipient);
      case "allianceReject":
        return new AllianceRejectExecution(intent.requestor, player);
      case "breakAlliance":
        return new BreakAllianceExecution(player, intent.recipient);
      case "targetPlayer":
        return new TargetPlayerExecution(player, intent.target);
      case "emoji":
        return new EmojiExecution(player, intent.recipient, intent.emoji);
      case "donate_troops":
        return new DonateTroopsExecution(
          player,
          intent.recipient,
          intent.troops,
        );
      case "donate_gold":
        return new DonateGoldExecution(player, intent.recipient, intent.gold);
      case "embargo":
        return new EmbargoExecution(player, intent.targetID, intent.action);
      case "embargo_all":
        return new EmbargoAllExecution(player, intent.action);
      case "build_unit":
        return new ConstructionExecution(player, intent.unit, intent.tile);
      case "allianceExtension": {
        return new AllianceExtensionExecution(player, intent.recipient);
      }

      case "upgrade_structure":
        return new UpgradeStructureExecution(
          player,
          intent.unitId,
          intent.amount,
        );
      case "delete_unit":
        return new DeleteUnitExecution(player, intent.unitId);
      case "quick_chat":
        return new QuickChatExecution(
          player,
          intent.recipient,
          intent.quickChatKey,
          intent.target,
        );
      case "mark_disconnected":
        return new MarkDisconnectedExecution(player, intent.isDisconnected);
      case "toggle_pause":
        return new PauseExecution(player, intent.paused);
      default:
        throw new Error(`intent type ${intent} not found`);
    }
  }

  spawnTribes(numTribes: number): SpawnExecution[] {
    const nationCells = this.mg
      .nations()
      .map((n) => n.spawnCell)
      .filter((c): c is NonNullable<typeof c> => c !== undefined);
    return new TribeSpawner(this.mg, this.gameID_, nationCells).spawnTribes(
      numTribes,
      this.purchasedTribeNames,
    );
  }

  spawnPlayers(): SpawnExecution[] {
    return new PlayerSpawner(this.mg, this.gameID_).spawnPlayers();
  }

  nationExecutions(): Execution[] {
    const execs: Execution[] = [];
    for (const nation of this.mg.nations()) {
      execs.push(new NationExecution(this.gameID_, nation));
    }
    return execs;
  }
}
