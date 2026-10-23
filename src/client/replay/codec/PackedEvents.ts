/**
 * Dead-unit events in binary, for keeping a replay (ReplayStore gzips the
 * result). A long game has thousands of them: as plain objects they were
 * about a quarter of a stored replay.
 *
 * Dead units: varuint count × (varuint tick, varuint unitId, short string
 *   unitType, varuint ownerSmallID, varuint pos, u8 reachedTarget).
 */

import { BinaryReader } from "./BinaryReader";
import { BinaryWriter } from "./BinaryWriter";
import type { ReplayEvents } from "./ReplayTypes";

export type PackedEventLists = Pick<ReplayEvents, "deadUnitEvents">;

export function packEvents(events: PackedEventLists): Uint8Array {
  const w = new BinaryWriter(64 * 1024);
  w.writeVarUint(events.deadUnitEvents.length);
  for (const d of events.deadUnitEvents) {
    w.writeVarUint(d.tick);
    w.writeVarUint(d.unitId);
    w.writeShortString(d.unitType);
    w.writeVarUint(d.ownerSmallID);
    w.writeVarUint(d.pos);
    w.writeU8(d.reachedTarget ? 1 : 0);
  }
  return w.finish();
}

export function unpackEvents(bytes: Uint8Array): PackedEventLists {
  const r = new BinaryReader(bytes);
  const deadUnitEvents: PackedEventLists["deadUnitEvents"] = [];
  for (let n = r.readVarUint(); n > 0; n--) {
    deadUnitEvents.push({
      tick: r.readVarUint(),
      unitId: r.readVarUint(),
      unitType: r.readShortString(),
      ownerSmallID: r.readVarUint(),
      pos: r.readVarUint(),
      reachedTarget: r.readU8() === 1,
    });
  }
  return { deadUnitEvents };
}
