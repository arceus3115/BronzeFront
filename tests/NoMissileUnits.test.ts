import {
  BuildMenus,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { WarshipExecution } from "@openfront/engine/execution/WarshipExecution";
import { setup } from "./util/Setup";

const REMOVED_UNIT_TYPES = [
  "Atom Bomb",
  "Hydrogen Bomb",
  "MIRV",
  "MIRV Warhead",
  "Missile Silo",
  "SAM Launcher",
  "SAMMissile",
  "Shell",
] as const;

describe("no missile units", () => {
  test("the build menu does not include removed missile unit types", () => {
    for (const removed of REMOVED_UNIT_TYPES) {
      expect(BuildMenus.types).not.toContain(removed);
    }
  });

  test("a short warship tick in combat creates only the warships", async () => {
    const game = await setup(
      "half_land_half_ocean",
      { infiniteGold: true, instantBuild: true },
      [
        new PlayerInfo("attacker", PlayerType.Human, null, "player_1_id"),
        new PlayerInfo("defender", PlayerType.Human, null, "player_2_id"),
      ],
    );
    const coastX = 7;
    const attacker = game.player("player_1_id");
    const defender = game.player("player_2_id");
    const warship = attacker.buildUnit(UnitType.Warship, game.ref(coastX, 10), {
      patrolTile: game.ref(coastX, 10),
    });
    const enemy = defender.buildUnit(
      UnitType.Warship,
      game.ref(coastX + 1, 10),
      { patrolTile: game.ref(coastX + 1, 10) },
    );
    game.addExecution(new WarshipExecution(warship));
    warship.setTargetUnit(enemy);

    game.executeNextTick();

    const units = game.units();
    const allowed = new Set<string>(Object.values(UnitType));
    expect(units.every((unit) => allowed.has(unit.type()))).toBe(true);
    expect(units).toHaveLength(2);
    expect(units.map((unit) => unit.type())).toEqual([
      UnitType.Warship,
      UnitType.Warship,
    ]);
  });
});
