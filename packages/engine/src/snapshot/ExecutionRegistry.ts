// Every entry is `<ClassName>Snapshot`, exported next to its class.
import { AllianceExtensionExecutionSnapshot } from "../execution/alliance/AllianceExtensionExecution";
import { AllianceRejectExecutionSnapshot } from "../execution/alliance/AllianceRejectExecution";
import { AllianceRequestExecutionSnapshot } from "../execution/alliance/AllianceRequestExecution";
import { BreakAllianceExecutionSnapshot } from "../execution/alliance/BreakAllianceExecution";
import { ArmyExecutionSnapshot, OrderArmyExecutionSnapshot } from "../execution/ArmyExecution";
import { AttackExecutionSnapshot } from "../execution/AttackExecution";
import {
  ExchangeExecutionSnapshot,
  ResearchExecutionSnapshot,
} from "../execution/BronzeTechExecution";
import { BoatRetreatExecutionSnapshot } from "../execution/BoatRetreatExecution";
import { CityExecutionSnapshot } from "../execution/CityExecution";
import { ConstructionExecutionSnapshot } from "../execution/ConstructionExecution";
import { DefensePostExecutionSnapshot } from "../execution/DefensePostExecution";
import { DeleteUnitExecutionSnapshot } from "../execution/DeleteUnitExecution";
import { DonateGoldExecutionSnapshot } from "../execution/DonateGoldExecution";
import { DonateTroopsExecutionSnapshot } from "../execution/DonateTroopExecution";
import { EmbargoAllExecutionSnapshot } from "../execution/EmbargoAllExecution";
import { EmbargoExecutionSnapshot } from "../execution/EmbargoExecution";
import { EmojiExecutionSnapshot } from "../execution/EmojiExecution";
import { FactoryExecutionSnapshot } from "../execution/FactoryExecution";
import { MarkDisconnectedExecutionSnapshot } from "../execution/MarkDisconnectedExecution";
import { MoveWarshipExecutionSnapshot } from "../execution/MoveWarshipExecution";
import { NationExecutionSnapshot } from "../execution/NationExecution";
import { NoOpExecutionSnapshot } from "../execution/NoOpExecution";
import { PauseExecutionSnapshot } from "../execution/PauseExecution";
import { PlayerExecutionSnapshot } from "../execution/PlayerExecution";
import { PortExecutionSnapshot } from "../execution/PortExecution";
import { QuickChatExecutionSnapshot } from "../execution/QuickChatExecution";
import { RecomputeRailClusterExecutionSnapshot } from "../execution/RecomputeRailClusterExecution";
import { RetreatExecutionSnapshot } from "../execution/RetreatExecution";
import { SpawnExecutionSnapshot } from "../execution/SpawnExecution";
import { SpawnTimerExecutionSnapshot } from "../execution/SpawnTimerExecution";
import { TargetPlayerExecutionSnapshot } from "../execution/TargetPlayerExecution";
import { TradeShipExecutionSnapshot } from "../execution/TradeShipExecution";
import { TrainExecutionSnapshot } from "../execution/TrainExecution";
import { TrainStationExecutionSnapshot } from "../execution/TrainStationExecution";
import { TransportShipExecutionSnapshot } from "../execution/TransportShipExecution";
import { TribeExecutionSnapshot } from "../execution/TribeExecution";
import { UpgradeStructureExecutionSnapshot } from "../execution/UpgradeStructureExecution";
import { WarshipCargoExecutionSnapshot } from "../execution/WarshipCargoExecution";
import { WarshipExecutionSnapshot } from "../execution/WarshipExecution";
import { WinCheckExecutionSnapshot } from "../execution/WinCheckExecution";
import type { ExecutionSnapshotType } from "./ExecutionSnapshot";

/**
 * Every execution class, by the type name its snapshots are stored under.
 * A class missing here cannot be snapshotted (snapshotGame throws), and a
 * stored type missing here cannot be restored. Retiring a class means
 * keeping an entry whose restoreSnapshot maps old records onto whatever
 * replaced it.
 */
export const EXECUTION_SNAPSHOT_TYPES = [
  AllianceExtensionExecutionSnapshot,
  AllianceRejectExecutionSnapshot,
  AllianceRequestExecutionSnapshot,
  ArmyExecutionSnapshot,
  AttackExecutionSnapshot,
  BoatRetreatExecutionSnapshot,
  BreakAllianceExecutionSnapshot,
  CityExecutionSnapshot,
  ConstructionExecutionSnapshot,
  DefensePostExecutionSnapshot,
  DeleteUnitExecutionSnapshot,
  DonateGoldExecutionSnapshot,
  DonateTroopsExecutionSnapshot,
  EmbargoAllExecutionSnapshot,
  EmbargoExecutionSnapshot,
  EmojiExecutionSnapshot,
  ExchangeExecutionSnapshot,
  FactoryExecutionSnapshot,
  MarkDisconnectedExecutionSnapshot,
  MoveWarshipExecutionSnapshot,
  NationExecutionSnapshot,
  NoOpExecutionSnapshot,
  OrderArmyExecutionSnapshot,
  PauseExecutionSnapshot,
  PlayerExecutionSnapshot,
  PortExecutionSnapshot,
  QuickChatExecutionSnapshot,
  RecomputeRailClusterExecutionSnapshot,
  ResearchExecutionSnapshot,
  RetreatExecutionSnapshot,
  SpawnExecutionSnapshot,
  SpawnTimerExecutionSnapshot,
  TargetPlayerExecutionSnapshot,
  TradeShipExecutionSnapshot,
  TrainExecutionSnapshot,
  TrainStationExecutionSnapshot,
  TransportShipExecutionSnapshot,
  TribeExecutionSnapshot,
  UpgradeStructureExecutionSnapshot,
  WarshipCargoExecutionSnapshot,
  WarshipExecutionSnapshot,
  WinCheckExecutionSnapshot,
] as unknown as readonly ExecutionSnapshotType<unknown>[];
