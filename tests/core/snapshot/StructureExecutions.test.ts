import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { ConstructionExecution } from "@openfront/engine/execution/ConstructionExecution";
import { PortExecution } from "@openfront/engine/execution/PortExecution";
import { TrainStationExecution } from "@openfront/engine/execution/TrainStationExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "../../util/Setup";
import { expectSnapshotRoundTrip } from "../../util/Snapshot";
import { executeTicks } from "../../util/utils";

const BIG = "big_plains";

function conquerRect(
  game: Game,
  p: Player,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  for (let x = x0; x < x1; x++) {
    for (let y = y0; y < y1; y++) {
      const t = game.ref(x, y);
      if (game.isLand(t)) p.conquer(t);
    }
  }
}

async function twoPlayers(
  map: string,
  config: Parameters<typeof setup>[1] = {},
): Promise<{ game: Game; a: Player; b: Player }> {
  const game = await setup(map, { infiniteGold: true, ...config }, [
    new PlayerInfo("alice", PlayerType.Human, "client_a", "alice"),
    new PlayerInfo("bob", PlayerType.Human, "client_b", "bob"),
  ]);
  return { game, a: game.player("alice"), b: game.player("bob") };
}

describe("structure execution snapshots", () => {
  test("construction mid-build, pending, and captured", async () => {
    const { game, a, b } = await twoPlayers(BIG);
    conquerRect(game, a, 0, 0, 40, 40);
    conquerRect(game, b, 60, 0, 100, 40);
    game.addExecution(
      new ConstructionExecution(a, UnitType.City, game.ref(10, 10)),
      new ConstructionExecution(a, UnitType.Mine, game.ref(25, 25)),
      new ConstructionExecution(b, UnitType.Port, game.ref(70, 10)),
    );
    executeTicks(game, 3);
    const city = a.units(UnitType.City)[0];
    expect(city.isUnderConstruction()).toBe(true);
    // Captured mid-build: the construction follows the new owner.
    b.conquer(city.tile());
    executeTicks(game, 1);
    // Queued but not yet initialized.
    game.addExecution(
      new ConstructionExecution(a, UnitType.DefensePost, game.ref(30, 5)),
    );
    await expectSnapshotRoundTrip(game, BIG, 80);
  });


  test("ports spawning trade ships", async () => {
    const map = "world";
    const { game, a, b } = await twoPlayers(map, { instantBuild: true });
    const port = (p: Player, x: number, y: number) => {
      conquerRect(game, p, x - 5, y - 5, x + 6, y + 6);
      const spawn = p.canBuild(UnitType.Port, game.ref(x, y));
      if (spawn === false) throw new Error("cannot build port");
      return p.buildUnit(UnitType.Port, spawn, {});
    };
    const src = port(a, 539, 380);
    src.increaseLevel();
    const dst = port(b, 832, 341);
    game.addExecution(new PortExecution(src), new PortExecution(dst));
    let ticks = 0;
    while (game.unitCount(UnitType.TradeShip) === 0 && ticks++ < 2000) {
      game.executeNextTick();
    }
    expect(game.unitCount(UnitType.TradeShip)).toBeGreaterThan(0);
    // An execution still pending init (a second one on a port is harmless).
    game.addExecution(new PortExecution(dst));
    await expectSnapshotRoundTrip(game, map, 80);
  }, 60_000);

  test("train stations", async () => {
    const { game, a } = await twoPlayers(BIG, { instantBuild: true });
    conquerRect(game, a, 0, 0, 60, 60);
    const factory = a.buildUnit(UnitType.Mine, game.ref(10, 10), {});
    const city = a.buildUnit(UnitType.City, game.ref(30, 12), {});
    game.addExecution(
      new TrainStationExecution(factory, true),
      new TrainStationExecution(city),
    );
    executeTicks(game, 5);
    expect(factory.hasTrainStation()).toBe(true);
    let ticks = 0;
    while (game.unitCount(UnitType.Depot) === 0 && ticks++ < 3000) {
      game.executeNextTick();
    }
    expect(game.unitCount(UnitType.Depot)).toBeGreaterThan(0);
    const city2 = a.buildUnit(UnitType.City, game.ref(12, 35), {});
    game.addExecution(new TrainStationExecution(city2));
    await expectSnapshotRoundTrip(game, BIG, 20);
  });

});
