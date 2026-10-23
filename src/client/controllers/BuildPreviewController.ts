/**
 * BuildPreviewController — build-ghost state machine + click-to-build flow.
 *
 * All rendering for the build ghost (outline, range circle, rail snap,
 * crosshair) lives in the WebGL renderer. This controller owns the state:
 * it queries buildables for the cursor tile, tracks whether the placement
 * is valid, and pushes preview data straight to the WebGL view.
 */

import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  BuildableUnit,
  bulkCost,
  PlayerBuildableUnitType,
  Structures,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { Controller } from "../Controller";
import {
  ConfirmGhostStructureEvent,
  MouseMoveEvent,
  MouseUpEvent,
} from "../InputHandler";
import { MapRenderer } from "../render/gl";
import type { GhostPreviewData } from "../render/types";
import { TransformHandler } from "../TransformHandler";
import {
  BuildUnitIntentEvent,
  SendUpgradeStructureIntentEvent,
} from "../Transport";
import { UIState } from "../UIState";
import { UserSettings } from "../UserSettings";
import { GameView } from "../view";

export class BuildPreviewController implements Controller {
  /** Current ghost (null when no build type is active). */
  private ghostUnit: { buildableUnit: BuildableUnit } | null = null;
  private readonly mousePos = { x: 0, y: 0 };
  private lastGhostQueryAt: number = 0;
  private pendingConfirm: MouseUpEvent | null = null;

  // Buildable validation runs on the snapped tile under the cursor, but the
  // rendered icon follows the cursor at sub-tile precision so motion is
  // continuous instead of stepping tile-to-tile. cursorLoop re-emits each
  // frame with the current cursor world position.
  private lastGhostData: GhostPreviewData | null = null;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    public uiState: UIState,
    private transformHandler: TransformHandler,
    private view: MapRenderer,
    private userSettings: UserSettings,
  ) {}

  init() {
    this.eventBus.on(MouseMoveEvent, (e) => this.moveGhost(e));
    this.eventBus.on(MouseUpEvent, (e) => this.requestConfirmStructure(e));
    this.eventBus.on(ConfirmGhostStructureEvent, () =>
      this.requestConfirmStructure(
        new MouseUpEvent(this.mousePos.x, this.mousePos.y),
      ),
    );

    // Re-emit the ghost each render frame at the cursor's current world
    // position (sub-tile). Buildable validation still runs on the snapped
    // tile in renderGhost(); this loop just keeps the icon under the cursor
    // so motion is continuous instead of stepping tile-to-tile.
    // The shader treats (tileX + 0.5, tileY + 0.5) as the icon center (so an
    // integer tile coord centers on that tile), so we subtract 0.5 here to
    // place the icon exactly under the cursor.
    const cursorLoop = () => {
      const ghost = this.lastGhostData;
      if (ghost !== null) {
        const w = this.transformHandler.screenToWorldCoordinatesFloat(
          this.mousePos.x,
          this.mousePos.y,
        );
        // The range circle (defense post / factory) normally follows the
        // cursor, so smooth it the same way as the icon. When upgrading, the
        // circle is anchored to the existing structure's tile (stationary,
        // correctly snapped) — leave it alone in that case.
        const radiusFollowsCursor =
          !ghost.snapToPlacement &&
          !(ghost.canUpgrade && ghost.upgradeTargetTile !== null);
        this.view.updateGhostPreview({
          ...ghost,
          tileX: ghost.snapToPlacement ? ghost.tileX : w.x - 0.5,
          tileY: ghost.snapToPlacement ? ghost.tileY : w.y - 0.5,
          ...(radiusFollowsCursor
            ? { radiusTileX: w.x - 0.5, radiusTileY: w.y - 0.5 }
            : {}),
        });
      }
      requestAnimationFrame(cursorLoop);
    };
    requestAnimationFrame(cursorLoop);
  }

  tick() {
    // Re-query buildables periodically (world state can change — tiles may
    // become buildable as troops/territory move).
    this.syncGhostState();
    this.renderGhost();
  }

  /**
   * Reconcile our internal ghost state with uiState.ghostStructure. Other
   * UI bits (build menu, key bindings) toggle uiState; we mirror it here.
   */
  private syncGhostState(): void {
    const target = this.uiState.ghostStructure;
    if (this.ghostUnit) {
      if (target === null) {
        this.removeGhostStructure();
      } else if (target !== this.ghostUnit.buildableUnit.type) {
        this.clearGhostStructure();
        this.createGhostStructure(target);
      }
    } else if (target !== null) {
      this.createGhostStructure(target);
    }
  }

  renderGhost() {
    if (!this.ghostUnit) return;

    const now = performance.now();
    if (now - this.lastGhostQueryAt < 50) return;
    this.lastGhostQueryAt = now;
    let tileRef: TileRef | undefined;
    const tile = this.transformHandler.screenToWorldCoordinates(
      this.mousePos.x,
      this.mousePos.y,
    );
    if (this.game.isValidCoord(tile.x, tile.y)) {
      tileRef = this.game.ref(tile.x, tile.y);
      if (this.game.isImpassable(tileRef)) {
        tileRef = undefined;
      }
    }

    this.game
      ?.myPlayer()
      ?.buildables(tileRef, [this.ghostUnit?.buildableUnit.type])
      .then((buildables) => {
        if (!this.ghostUnit) {
          this.pendingConfirm = null;
          this.emitGhostPreview(tileRef);
          return;
        }

        const unit = buildables.find(
          (u) => u.type === this.ghostUnit!.buildableUnit.type,
        );
        if (!unit) {
          Object.assign(this.ghostUnit.buildableUnit, {
            canBuild: false,
            canUpgrade: false,
          });
          this.pendingConfirm = null;
          this.emitGhostPreview(tileRef);
          return;
        }

        this.ghostUnit.buildableUnit = unit;

        if (this.pendingConfirm !== null) {
          const ev = this.pendingConfirm;
          this.pendingConfirm = null;
          if (this.isGhostReadyForConfirm()) {
            this.createStructure(ev);
          }
        }

        this.emitGhostPreview(tileRef);
      });
  }

  /**
   * Push a GhostPreviewData snapshot to the WebGL view (StructurePass /
   * RangeCirclePass / RailroadPass / CrosshairPass all read it). null when
   * the ghost can't be placed. smoothLoop interpolates displayed position
   * toward the target tile each frame.
   */
  private emitGhostPreview(tileRef: TileRef | undefined): void {
    const data = this.buildGhostPreviewData(tileRef);
    if (data === null) {
      this.lastGhostData = null;
      this.view.updateGhostPreview(null);
    } else {
      this.lastGhostData = data;
    }
  }

  private buildGhostPreviewData(
    tileRef: TileRef | undefined,
  ): GhostPreviewData | null {
    if (!this.ghostUnit) return null;
    if (tileRef === undefined) return null;
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return null;

    const u = this.ghostUnit.buildableUnit;
    // With snapping on, a new structure's preview sits on the tile it will
    // actually be built on (the sim moves it off nearby buildings) instead of
    // under the cursor.
    const placementTile =
      this.userSettings.snapBuildPreview() &&
      u.canUpgrade === false &&
      Structures.has(u.type) &&
      u.canBuild !== false
        ? u.canBuild
        : tileRef;

    // Upgrade-target tile — only when upgrading an existing unit.
    let upgradeTargetTile: number | null = null;
    if (u.canUpgrade !== false) {
      upgradeTargetTile = this.game.unit(u.canUpgrade)?.tile() ?? null;
    }

    let rangeRadius = 0;
    switch (u.type) {
      case UnitType.Mine:
      case UnitType.Farm:
        rangeRadius = this.game.config().trainStationMaxRange();
        break;
      case UnitType.DefensePost:
        rangeRadius = this.game.config().defensePostRange();
        break;
    }
    let radiusTileX = this.game.x(placementTile);
    let radiusTileY = this.game.y(placementTile);
    if (
      rangeRadius > 0 &&
      u.canUpgrade !== false &&
      upgradeTargetTile !== null
    ) {
      radiusTileX = this.game.x(upgradeTargetTile);
      radiusTileY = this.game.y(upgradeTargetTile);
    }

    const multiplier =
      u.canUpgrade !== false ? (this.uiState.upgradeMultiplier ?? 1) : 1;
    const cost = bulkCost(u, multiplier);
    return {
      ghostType: u.type,
      tileX: this.game.x(placementTile),
      tileY: this.game.y(placementTile),
      snapToPlacement: placementTile !== tileRef,
      radiusTileX,
      radiusTileY,
      canBuild: u.canBuild !== false,
      canUpgrade: u.canUpgrade !== false,
      cost: Number(cost),
      multiplier: multiplier,
      showCost: this.userSettings.cursorCostLabel(),
      canAfford: myPlayer.gold() >= cost,
      ghostRailPaths: u.ghostRailPaths,
      overlappingRailroads: u.overlappingRailroads,
      ownerID: myPlayer.smallID(),
      upgradeTargetTile,
      rangeRadius,
      rangeWarning: false,
    };
  }

  private isGhostReadyForConfirm(): boolean {
    if (!this.ghostUnit) return false;
    const bu = this.ghostUnit.buildableUnit;
    return bu.canBuild !== false || bu.canUpgrade !== false;
  }

  private requestConfirmStructure(e: MouseUpEvent): void {
    if (!this.ghostUnit && !this.uiState.ghostStructure) return;
    if (this.isGhostReadyForConfirm()) {
      this.createStructure(e);
    } else {
      this.pendingConfirm = e;
    }
  }

  private createStructure(e: MouseUpEvent) {
    if (!this.ghostUnit) return;
    if (
      this.ghostUnit.buildableUnit.canBuild === false &&
      this.ghostUnit.buildableUnit.canUpgrade === false
    ) {
      this.removeGhostStructure();
      return;
    }
    const tile = this.transformHandler.screenToWorldCoordinates(e.x, e.y);
    if (this.ghostUnit.buildableUnit.canUpgrade !== false) {
      this.eventBus.emit(
        new SendUpgradeStructureIntentEvent(
          this.ghostUnit.buildableUnit.canUpgrade,
          this.ghostUnit.buildableUnit.type,
          this.uiState.upgradeMultiplier || 1,
        ),
      );
      this.removeGhostStructure();
    } else if (this.ghostUnit.buildableUnit.canBuild) {
      // The pointer can be released just off the map edge before the
      // throttled hover refresh marks the ghost unbuildable; there is no
      // tile to build on, so keep the ghost and wait for a click on the map.
      if (!this.game.isValidCoord(tile.x, tile.y)) return;
      const unitType = this.ghostUnit.buildableUnit.type;
      const targetTile = this.game.ref(tile.x, tile.y);
      this.eventBus.emit(new BuildUnitIntentEvent(unitType, targetTile));
      this.removeGhostStructure();
    } else {
      this.removeGhostStructure();
    }
  }

  private moveGhost(e: MouseMoveEvent) {
    this.mousePos.x = e.x;
    this.mousePos.y = e.y;
  }

  private createGhostStructure(type: PlayerBuildableUnitType | null) {
    if (type === null) return;
    if (this.game.myPlayer() === null) return;
    this.ghostUnit = {
      buildableUnit: {
        type,
        canBuild: false,
        canUpgrade: false,
        cost: 0n,
        overlappingRailroads: [],
        ghostRailPaths: [],
      },
    };
  }

  private clearGhostStructure() {
    this.pendingConfirm = null;
    this.ghostUnit = null;
    this.lastGhostData = null;
    this.view.updateGhostPreview(null);
  }

  private removeGhostStructure() {
    this.clearGhostStructure();
    this.uiState.ghostStructure = null;
  }
}
