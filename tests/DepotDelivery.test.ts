import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { TrainExecution } from "@openfront/engine/execution/TrainExecution";
import { TrainStation } from "@openfront/engine/game/TrainStation";
import { describe, expect, test } from "vitest";
import { setup } from "./util/Setup";

describe("depot delivery", () => {
  test("a depot from a farm credits food and a depot from a mine credits gold", async () => {
    const game = await setup("plains", { instantBuild: true }, [
      new PlayerInfo("a", PlayerType.Human, "a", "a"),
    ]);
    const player = game.player("a");
    const farm = player.buildUnit(UnitType.Farm, game.ref(10, 10), {});
    const mine = player.buildUnit(UnitType.Mine, game.ref(20, 10), {});
    const city = player.buildUnit(UnitType.City, game.ref(40, 10), {});
    const farmStation = new TrainStation(game, farm);
    const mineStation = new TrainStation(game, mine);
    const cityStation = new TrainStation(game, city);
    const expected = game.config().trainGold("self", 0, player);

    const foodBefore = player.food();
    const goldBefore = player.gold();
    cityStation.onTrainStop(
      new TrainExecution(
        game.railNetwork(),
        player,
        farmStation,
        cityStation,
        0,
      ),
    );
    expect(player.food() - foodBefore).toBe(expected);
    expect(player.gold()).toBe(goldBefore);

    cityStation.onTrainStop(
      new TrainExecution(
        game.railNetwork(),
        player,
        mineStation,
        cityStation,
        0,
      ),
    );
    expect(player.gold() - goldBefore).toBe(expected);
    expect(player.food() - foodBefore).toBe(expected);

    // Origins pay nothing when a depot stops on them.
    farmStation.onTrainStop(
      new TrainExecution(
        game.railNetwork(),
        player,
        mineStation,
        farmStation,
        0,
      ),
    );
    expect(player.gold() - goldBefore).toBe(expected);
    expect(player.food() - foodBefore).toBe(expected);
  });
});
