/**
 * The encoder's event lists are handed over with each append and not kept,
 * so the processing worker's memory doesn't grow with the game.
 */

import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { EventCollector } from "../../../../src/client/replay/codec/encode/EventCollector";
import type { NormalizedFrame } from "../../../../src/client/replay/codec/FrameNormalizer";

/** A frame with a unit that died. */
function frame(tick: number, deadUnit: number): NormalizedFrame {
  const updates: Record<number, unknown[]> = {};
  for (const type of Object.values(GameUpdateType)) {
    if (typeof type === "number") updates[type] = [];
  }
  updates[GameUpdateType.Unit] = [
    {
      id: deadUnit,
      unitType: UnitType.Warship,
      ownerID: 1,
      pos: 0,
      isActive: false,
      reachedTarget: true,
    },
  ];
  if (tick === 1) {
    updates[GameUpdateType.SpawnPhaseEnd] = [{ startTick: 0 }];
  }
  return {
    tick,
    source: { tick, updates },
    motionPlans: [],
    units: [],
  } as unknown as NormalizedFrame;
}

test("events are handed over once, then forgotten", () => {
  const events = new EventCollector();
  events.push(frame(1, 7));
  events.push(frame(2, 8));

  const first = events.take();
  expect(first.deadUnitEvents.map((e) => e.unitId)).toEqual([7, 8]);
  expect(first.spawnPhaseEnd).toEqual({ tick: 1, startTick: 0 });

  // Nothing kept: the next take has only what came after.
  const empty = events.take();
  expect(empty.deadUnitEvents).toEqual([]);
  events.push(frame(3, 9));
  const next = events.take();
  expect(next.deadUnitEvents.map((e) => e.unitId)).toEqual([9]);
  // Not a list: it's sent with every append.
  expect(next.spawnPhaseEnd).toEqual({ tick: 1, startTick: 0 });
  // What was handed over isn't touched afterwards.
  expect(first.deadUnitEvents).toHaveLength(2);
});
