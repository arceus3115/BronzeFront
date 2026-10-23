import {
  packEvents,
  unpackEvents,
} from "../../../../src/client/replay/codec/PackedEvents";

test("dead units round-trip", () => {
  const events = {
    deadUnitEvents: [
      {
        tick: 301,
        unitId: 90_000,
        unitType: "Warship",
        ownerSmallID: 511,
        pos: 3_999_999,
        reachedTarget: true,
      },
      {
        tick: 305,
        unitId: 2,
        unitType: "Transport",
        ownerSmallID: 1,
        pos: 0,
        reachedTarget: false,
      },
    ],
  };
  const back = unpackEvents(packEvents(events));
  expect(back).toEqual(events);
});
