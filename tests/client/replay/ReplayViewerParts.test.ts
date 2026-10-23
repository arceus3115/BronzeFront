import type { ReplayFrame } from "../../../src/client/replay/codec/ReplayTypes";
import {
  CameraGestures,
  ReplayCamera,
} from "../../../src/client/replay/ReplayCamera";
import {
  formatGameTime,
  timelineFrames,
} from "../../../src/client/replay/ReplayControls";
import { ReplayTerrain } from "../../../src/client/replay/ReplayTerrain";
import { parseReplayViewerHash } from "../../../src/client/replay/ReplayViewerRoute";

describe("parseReplayViewerHash", () => {
  test.each([
    ["#replay-viewer=abcd1234", "abcd1234"],
    ["#replay-viewer=AbCd12345X", "AbCd12345X"],
    ["#replay-viewer", null],
    ["#replay-viewer=../x", null],
    ["#replay-viewer=", null],
    ["#replay-viewerX", null],
    ["#token-login=x", null],
    ["", null],
  ])("%s → %s", (hash, expected) => {
    expect(parseReplayViewerHash(hash)).toBe(expected);
  });
});

test("formatGameTime", () => {
  expect(formatGameTime(0)).toBe("0:00");
  expect(formatGameTime(9)).toBe("0:00");
  expect(formatGameTime(655)).toBe("1:05");
  expect(formatGameTime(36_010)).toBe("1:00:01");
  expect(formatGameTime(-5)).toBe("0:00");
});

describe("ReplayCamera", () => {
  test("zooming keeps the point under the cursor fixed", () => {
    const c = new ReplayCamera(200, 100);
    c.zoom = 2;
    const worldAt = (sx: number, sy: number) => [
      c.x + (sx - 400) / c.zoom,
      c.y + (sy - 300) / c.zoom,
    ];
    const before = worldAt(700, 100);
    c.zoomAt(700, 100, 3, 800, 600);
    expect(c.zoom).toBe(6);
    const after = worldAt(700, 100);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
  });

  test("goTo glides there, and moving the map cancels it", () => {
    const c = new ReplayCamera(1000, 1000);
    c.goTo(900, 100);
    let steps = 0;
    while ((c.x !== 900 || c.y !== 100) && steps < 2000) {
      const before = Math.abs(900 - c.x) + Math.abs(100 - c.y);
      c.step(16);
      steps++;
      if (before < 2) break;
    }
    expect(Math.abs(900 - c.x) + Math.abs(100 - c.y)).toBeLessThan(2);
    expect(steps).toBeGreaterThan(1); // eased, not a jump

    c.goTo(0, 0);
    c.step(16);
    const at = [c.x, c.y];
    c.panBy(1, 1);
    c.step(1000);
    expect([c.x, c.y]).toEqual([at[0] - 1, at[1] - 1]);
  });
});

describe("CameraGestures", () => {
  test("one pointer drags the map", () => {
    const c = new ReplayCamera(200, 100);
    c.zoom = 2;
    const g = new CameraGestures(c);
    g.down(1, 100, 100);
    expect(g.active).toBe(true);
    g.move(1, 120, 90, 800, 600);
    expect([c.x, c.y]).toEqual([90, 55]);
    g.up(1);
    expect(g.active).toBe(false);
    g.move(1, 500, 500, 800, 600); // released: ignored
    expect([c.x, c.y]).toEqual([90, 55]);
  });

  test("two pointers pinch to zoom about their midpoint", () => {
    const c = new ReplayCamera(1000, 1000);
    c.zoom = 2;
    const g = new CameraGestures(c);
    g.down(1, 300, 300);
    g.down(2, 500, 300);
    const mid = c.worldAt(400, 300, 800, 600);
    // Spread apart symmetrically: twice as far, same midpoint.
    g.move(1, 200, 300, 800, 600);
    g.move(2, 600, 300, 800, 600);
    expect(c.zoom).toBeCloseTo(2 * (300 / 200) * (400 / 300));
    const after = c.worldAt(400, 300, 800, 600);
    expect(after.x).toBeCloseTo(mid.x);
    expect(after.y).toBeCloseTo(mid.y);
  });
});

describe("ReplayTerrain", () => {
  const frame = (
    terrain: [number, number][],
    changed: number[] | null,
  ): ReplayFrame =>
    ({
      terrain: new Map(terrain),
      changedTerrain: changed,
    }) as unknown as ReplayFrame;

  test("counts land sunk and raised, like GameMap.updateTile", () => {
    const LAND = 0x80;
    const t = new ReplayTerrain(Uint8Array.from([LAND, LAND, LAND, 0]));
    expect(t.apply(frame([[0, 0]], [0]))).toEqual([0]);
    expect(t.landChange).toBe(-1);
    t.apply(
      frame(
        [
          [0, 0],
          [1, 0],
        ],
        [1],
      ),
    );
    expect(t.landChange).toBe(-2);
    // A keyframe where tile 1 is back to land, and water tile 3 is land.
    t.apply(
      frame(
        [
          [0, 0],
          [3, LAND],
        ],
        null,
      ),
    );
    expect(t.landChange).toBe(0);
    expect([...t.bytes]).toEqual([0, LAND, LAND, LAND]);
  });
});


describe("the timeline of a game still being processed", () => {
  test("spans the whole game while it grows", () => {
    expect(timelineFrames(1200, 15691, true)).toBe(15691);
    // Unknown length: what is loaded.
    expect(timelineFrames(1200, null, true)).toBe(1200);
    // Finished: the file is the truth.
    expect(timelineFrames(15691, 15000, false)).toBe(15691);
    expect(timelineFrames(15691, 15000, true)).toBe(15691);
  });
});
