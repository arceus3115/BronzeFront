import { TileRef } from "@openfront/engine-api/game/GameMap";
import { Tick, UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  zInt,
  zPlayerRef,
  zRef,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player, Unit } from "../game/Game";
import {
  migrateUnitTypeName,
  UnitTypeSchema,
} from "../snapshot/CommonSchemas";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { CityExecution } from "./CityExecution";
import { DefensePostExecution } from "./DefensePostExecution";
import { FactoryExecution } from "./FactoryExecution";
import { PortExecution } from "./PortExecution";
import { WarshipExecution } from "./WarshipExecution";

export class ConstructionExecution implements Execution {
  private structure: Unit | null = null;
  private active: boolean = true;
  private mg: Game;

  private ticksUntilComplete: Tick;

  constructor(
    private player: Player,
    private constructionType: UnitType,
    private tile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;

    if (this.mg.config().isUnitDisabled(this.constructionType)) {
      console.warn(
        `cannot build construction ${this.constructionType} because it is disabled`,
      );
      this.active = false;
      return;
    }

    if (!this.mg.isValidRef(this.tile)) {
      console.warn(`cannot build construction invalid tile ${this.tile}`);
      this.active = false;
      return;
    }
  }

  tick(ticks: number): void {
    if (this.structure === null) {
      const info = this.mg.unitInfo(this.constructionType);
      // For non-structure units (warship), charge once and delegate to the specialized execution.
      const isStructure = this.isStructure(this.constructionType);
      if (!isStructure) {
        // Defer validation and gold deduction to the specific execution
        this.completeConstruction();
        this.active = false;
        return;
      }

      // Structures: build real unit and mark under construction
      const spawnTile = this.player.canBuild(this.constructionType, this.tile);
      if (spawnTile === false) {
        console.warn(`cannot build ${this.constructionType}`);
        this.active = false;
        return;
      }
      this.structure = this.player.buildUnit(
        this.constructionType,
        spawnTile,
        {},
      );
      const duration = info.constructionDuration ?? 0;
      if (duration > 0) {
        this.structure.setUnderConstruction(true);
        this.ticksUntilComplete = duration;
        return;
      }
      // No construction time
      this.completeConstruction();
      this.active = false;
      return;
    }

    if (!this.structure.isActive()) {
      this.active = false;
      return;
    }

    if (this.player !== this.structure.owner()) {
      this.player = this.structure.owner();
    }

    if (this.ticksUntilComplete === 0) {
      this.player = this.structure.owner();
      this.completeConstruction();
      this.active = false;
      return;
    }
    this.ticksUntilComplete--;
  }

  private completeConstruction() {
    if (this.structure) {
      this.structure.setUnderConstruction(false);
    }
    const player = this.player;
    switch (this.constructionType) {
      case UnitType.Warship:
        this.mg.addExecution(
          new WarshipExecution({ owner: player, patrolTile: this.tile }),
        );
        break;
      case UnitType.Port:
        this.mg.addExecution(new PortExecution(this.structure!));
        break;
      case UnitType.DefensePost:
        this.mg.addExecution(new DefensePostExecution(this.structure!));
        break;
      case UnitType.City:
        this.mg.addExecution(new CityExecution(this.structure!));
        break;
      case UnitType.Mine:
      case UnitType.Farm:
        this.mg.addExecution(new FactoryExecution(this.structure!));
        break;
      default:
        console.warn(
          `unit type ${this.constructionType} cannot be constructed`,
        );
        break;
    }
  }

  private isStructure(type: UnitType): boolean {
    switch (type) {
      case UnitType.Port:
      case UnitType.DefensePost:
      case UnitType.City:
      case UnitType.Mine:
      case UnitType.Farm:
        return true;
      default:
        return false;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return ConstructionExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      player: w.player(this.player),
      constructionType: this.constructionType,
      tile: this.tile,
      structure: w.unitOrNull(this.structure),
      ticksUntilComplete: this.ticksUntilComplete,
    });
  }

  restoreSnapshot(s: ConstructionState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.player = r.player(s.player);
    this.constructionType = s.constructionType;
    this.tile = s.tile;
    this.structure = r.unitOrNull(s.structure);
    this.ticksUntilComplete = s.ticksUntilComplete as Tick;
  }
}

const ConstructionStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  player: zPlayerRef(),
  constructionType: UnitTypeSchema,
  // Validated in init, so a pending execution may hold any number.
  tile: zInt(),
  structure: zRef().nullable(),
  // Unset until a structure with a build time is placed.
  ticksUntilComplete: zInt().optional(),
});
type ConstructionState = z.infer<typeof ConstructionStateSchema>;

export const ConstructionExecutionSnapshot = execSnapshotType({
  name: "Construction",
  version: 3,
  migrations: {
    1: (data) => data,
    2: (data) => ({
      ...data,
      constructionType: migrateUnitTypeName(data.constructionType),
    }),
  },
  schema: ConstructionStateSchema,
  cls: () => ConstructionExecution,
});
