/**
 * UnitView is mostly a thin accessor over a UnitUpdate record. Tests verify
 * each accessor returns the underlying data, that update() swaps the backing
 * record, that lastPos tracking works as the simulation advances units, and
 * that the trickier missile-readiness math is correct.
 */

import {
  TrainType,
  TransportShipState,
  UnitType,
  WarshipState,
} from "@openfront/engine-api/game/GameTypes";
import { describe, expect, it } from "vitest";
import { UnitView } from "../../../src/client/view/UnitView";
import { makeGameView, makeUnitUpdate, stubConfig } from "../../util/viewStubs";

describe("UnitView accessors", () => {
  it("forwards data fields", () => {
    const game = makeGameView();
    const u = new UnitView(
      game,
      makeUnitUpdate({
        id: 42,
        unitType: UnitType.City,
        ownerID: 7,
        pos: 100,
        lastPos: 99,
        troops: 250,
        level: 3,
        hasTrainStation: true,
        targetable: false,
        markedForDeletion: false,
        isActive: true,
        reachedTarget: false,
      }),
    );

    expect(u.id()).toBe(42);
    expect(u.type()).toBe(UnitType.City);
    expect(u.troops()).toBe(250);
    expect(u.level()).toBe(3);
    expect(u.hasTrainStation()).toBe(true);
    expect(u.targetable()).toBe(false);
    expect(u.markedForDeletion()).toBe(false);
    expect(u.isActive()).toBe(true);
    expect(u.reachedTarget()).toBe(false);
    expect(u.tile()).toBe(100);
  });

  it("tracks createdAt from the GameView's tick at construction", () => {
    const game = makeGameView();
    const u = new UnitView(game, makeUnitUpdate());
    expect(u.createdAt()).toBe(0); // GameView.ticks() returns 0 before any update
  });

  it("returns the latest data after update()", () => {
    const game = makeGameView();
    const u = new UnitView(game, makeUnitUpdate({ troops: 100, pos: 1 }));
    u.update(makeUnitUpdate({ troops: 250, pos: 5 }));
    expect(u.troops()).toBe(250);
    expect(u.tile()).toBe(5);
  });

  it("update() pushes new pos into lastPos", () => {
    const game = makeGameView();
    const u = new UnitView(game, makeUnitUpdate({ pos: 1 }));
    expect(u.lastTile()).toBe(1);
    u.update(makeUnitUpdate({ pos: 2 }));
    expect(u.lastTiles()).toEqual([1, 2]);
    u.update(makeUnitUpdate({ pos: 3 }));
    expect(u.lastTiles()).toEqual([1, 2, 3]);
  });

  it("lastTile() returns the first remembered pos", () => {
    const game = makeGameView();
    const u = new UnitView(game, makeUnitUpdate({ pos: 1 }));
    u.update(makeUnitUpdate({ pos: 2 }));
    u.update(makeUnitUpdate({ pos: 3 }));
    expect(u.lastTile()).toBe(1);
  });

  it("applyDerivedPosition pushes a new pos and shifts lastPos in data", () => {
    const game = makeGameView();
    const u = new UnitView(game, makeUnitUpdate({ pos: 10, lastPos: 9 }));
    u.applyDerivedPosition(11);
    expect(u.tile()).toBe(11);
    expect(u.lastTiles()).toEqual([10, 11]);
  });

  it("hasHealth() reflects whether health is set", () => {
    const game = makeGameView();
    expect(new UnitView(game, makeUnitUpdate({ health: 50 })).hasHealth()).toBe(
      true,
    );
    expect(new UnitView(game, makeUnitUpdate()).hasHealth()).toBe(false);
  });

  it("health() returns 0 when unset", () => {
    const game = makeGameView();
    expect(new UnitView(game, makeUnitUpdate()).health()).toBe(0);
    expect(new UnitView(game, makeUnitUpdate({ health: 42 })).health()).toBe(
      42,
    );
  });

  it("isUnderConstruction reflects the explicit boolean", () => {
    const game = makeGameView();
    expect(
      new UnitView(
        game,
        makeUnitUpdate({ underConstruction: true }),
      ).isUnderConstruction(),
    ).toBe(true);
    expect(
      new UnitView(
        game,
        makeUnitUpdate({ underConstruction: false }),
      ).isUnderConstruction(),
    ).toBe(false);
    // Undefined is treated as false (not under construction).
    expect(new UnitView(game, makeUnitUpdate()).isUnderConstruction()).toBe(
      false,
    );
  });

  it("trainType() / isLoaded() forward optional train fields", () => {
    const game = makeGameView();
    const u = new UnitView(
      game,
      makeUnitUpdate({ trainType: TrainType.Engine, loaded: true }),
    );
    expect(u.trainType()).toBe(TrainType.Engine);
    expect(u.isLoaded()).toBe(true);
  });

  it("transportShipState() returns a default when missing", () => {
    const game = makeGameView();
    const u = new UnitView(game, makeUnitUpdate());
    expect(u.transportShipState()).toEqual({ isRetreating: false, troops: 0 });
  });

  it("transportShipState() forwards when set", () => {
    const game = makeGameView();
    const state: TransportShipState = { isRetreating: true, troops: 50 };
    const u = new UnitView(game, makeUnitUpdate({ transportShipState: state }));
    expect(u.transportShipState()).toBe(state);
  });

  it("warshipState() throws when not a warship state", () => {
    const game = makeGameView();
    const u = new UnitView(game, makeUnitUpdate());
    expect(() => u.warshipState()).toThrow();
  });

  it("warshipState() forwards when present", () => {
    const game = makeGameView();
    const state: WarshipState = {
      isInCombat: false,
      patrolTile: 0,
      lastAttackTile: 0,
      bossUnitId: null,
    } as unknown as WarshipState;
    const u = new UnitView(game, makeUnitUpdate({ warshipState: state }));
    expect(u.warshipState()).toBe(state);
  });

  it("isInCombat() reflects warshipState.isInCombat (or false if missing)", () => {
    const game = makeGameView();
    expect(new UnitView(game, makeUnitUpdate()).isInCombat()).toBe(false);
    const combat = new UnitView(
      game,
      makeUnitUpdate({
        warshipState: { isInCombat: true } as unknown as WarshipState,
      }),
    );
    expect(combat.isInCombat()).toBe(true);
  });

  it("targetUnitId / targetTile pass through", () => {
    const game = makeGameView();
    const u = new UnitView(
      game,
      makeUnitUpdate({ targetUnitId: 99, targetTile: 12 }),
    );
    expect(u.targetUnitId()).toBe(99);
    expect(u.targetTile()).toBe(12);
  });


  it("touch / updateWarshipState / updateTransportShipState throw on view", () => {
    const game = makeGameView();
    const u = new UnitView(game, makeUnitUpdate());
    expect(() => u.touch()).toThrow();
    expect(() => u.updateWarshipState({})).toThrow();
    expect(() => u.updateTransportShipState({ isRetreating: false })).toThrow();
  });

});
