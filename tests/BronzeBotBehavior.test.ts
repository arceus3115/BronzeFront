import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  BRONZE_WEAPONS_COST,
  MARKETS_COST,
} from "@openfront/engine-lib/game/BronzeRules";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import {
  ExchangeExecution,
  ResearchExecution,
} from "@openfront/engine/execution/BronzeTechExecution";
import { NationAttackBehavior } from "@openfront/engine/execution/nation/NationAttackBehavior";
import { NationEmojiBehavior } from "@openfront/engine/execution/nation/NationEmojiBehavior";
import { NationStructureBehavior } from "@openfront/engine/execution/nation/NationStructureBehavior";
import { NationWarshipBehavior } from "@openfront/engine/execution/nation/NationWarshipBehavior";
import { TribeAttackBehavior } from "@openfront/engine/execution/TribeAttackBehavior";
import { UpgradeStructureExecution } from "@openfront/engine/execution/UpgradeStructureExecution";
import { WarshipExecution } from "@openfront/engine/execution/WarshipExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";

function nationBehavior(game: Game, player: Player): NationAttackBehavior {
  const random = new PseudoRandom(1);
  const emoji = new NationEmojiBehavior(random, game, player);
  return new NationAttackBehavior(
    random,
    game,
    player,
    0.5,
    0.3,
    0.1,
    { maybeSendAllianceRequests: () => {} } as any,
    emoji,
    new NationWarshipBehavior(random, game, player, emoji),
  );
}

describe("bronze bot behavior", () => {
  it("sends a border attack of 20% and does not spawn a transport", async () => {
    const game = await setup("big_plains", {}, [
      new PlayerInfo("nation", PlayerType.Nation, null, "nation"),
      new PlayerInfo("enemy", PlayerType.Human, null, "enemy"),
    ]);
    const nation = game.player("nation");
    const enemy = game.player("enemy");
    game.map().forEachTile((tile) => {
      if (!game.map().isLand(tile)) return;
      (game.x(tile) % 2 === 0 ? nation : enemy).conquer(tile);
    });
    nation.setTroops(game.config().maxTroops(nation));

    const spy = vi.spyOn(game, "addExecution");
    expect(nationBehavior(game, nation).sendAttack(enemy)).toBe(true);

    const army = spy.mock.calls
      .map((c) => c[0])
      .find((e): e is AttackExecution => e instanceof AttackExecution);
    expect(army).toBeDefined();
    expect(army!.troopsToSend()).toBe(Math.floor(nation.troops() * 0.2));
    expect(nation.unitCount(UnitType.TransportShip)).toBe(0);
    expect(nation.units(UnitType.Army)).toHaveLength(0);
  });

  it("sends a border attack at the enemy and keeps a tribe off the water", async () => {
    const game = await setup("big_plains", {}, [
      new PlayerInfo("nation", PlayerType.Nation, null, "nation"),
      new PlayerInfo("tribe", PlayerType.Bot, null, "tribe"),
      new PlayerInfo("enemy", PlayerType.Human, null, "enemy"),
    ]);
    const nation = game.player("nation");
    const tribe = game.player("tribe");
    const enemy = game.player("enemy");
    const width = game.width();
    game.map().forEachTile((tile) => {
      if (!game.map().isLand(tile)) return;
      const x = game.x(tile);
      if (x < width / 3) nation.conquer(tile);
      else if (x < (2 * width) / 3) enemy.conquer(tile);
      else tribe.conquer(tile);
    });
    const cityTile = [...enemy.tiles()].find((tile) =>
      game.neighbors(tile).some((n) => game.owner(n) === nation),
    )!;
    enemy.buildUnit(UnitType.City, cityTile, {});
    nation.setTroops(game.config().maxTroops(nation));
    tribe.setTroops(game.config().maxTroops(tribe));

    const nationArmy = sentArmy(game, () =>
      nationBehavior(game, nation).sendAttack(enemy),
    );
    expect(nationArmy.targetID()).toBe(enemy.id());

    const tribeBehavior = new TribeAttackBehavior(
      new PseudoRandom(1),
      game,
      tribe,
      0.2,
      0.1,
      0.1,
    );
    const tribeArmy = sentArmy(game, () => {
      tribeBehavior.beginDeployments();
      return tribeBehavior.sendAttack(enemy);
    });
    expect(tribeArmy.targetID()).toBe(enemy.id());
    expect(tribe.units(UnitType.Warship)).toHaveLength(0);
    const research = vi.spyOn(game, "addExecution");
    tribeBehavior.sendAttack(enemy);
    expect(
      research.mock.calls.some((c) => c[0] instanceof ResearchExecution),
    ).toBe(false);
  });

  it("buys bronze weapons, then markets, and exchanges only for the next bill", async () => {
    const game = await setup("big_plains", {}, [
      new PlayerInfo("nation", PlayerType.Nation, null, "nation"),
    ]);
    const nation = game.player("nation");
    const tile = [...nation.tiles()][0] ?? firstLand(game, nation);
    nation.buildUnit(UnitType.City, tile, {});
    const behavior = new NationStructureBehavior(
      new PseudoRandom(1),
      game,
      nation,
    );

    const spy = vi.spyOn(game, "addExecution");
    nation.addScience(BRONZE_WEAPONS_COST);
    behavior.handleStructures();
    game.executeNextTick();
    expect(nation.hasBronzeWeapons()).toBe(true);
    expect(nation.hasMarkets()).toBe(false);

    nation.addScience(MARKETS_COST);
    behavior.handleStructures();
    game.executeNextTick();
    expect(nation.hasMarkets()).toBe(true);

    spy.mockClear();
    behavior.handleStructures();
    expect(spy.mock.calls.some((c) => c[0] instanceof ExchangeExecution)).toBe(
      false,
    );

    nation.addGold(5_000_000n);
    nation.addFood(-nation.food());
    behavior.handleStructures();
    const exchanged = spy.mock.calls
      .map((c) => c[0])
      .find((e): e is ExchangeExecution => e instanceof ExchangeExecution);
    expect(exchanged).toBeDefined();
    expect(exchanged!["direction"]).toBe("money_to_food");
  });

  it("skips a city upgrade when food is short and gold is high", async () => {
    const game = await setup("big_plains", {}, [
      new PlayerInfo("nation", PlayerType.Nation, null, "nation"),
    ]);
    const nation = game.player("nation");
    const tile = firstLand(game, nation);
    const city = nation.buildUnit(UnitType.City, tile, {});
    nation.addGold(5_000_000n);
    nation.addFood(-nation.food());
    const behavior = new NationStructureBehavior(
      new PseudoRandom(1),
      game,
      nation,
    );

    const spy = vi.spyOn(game, "addExecution");
    expect(behavior["upgradeAmount"](UnitType.City)).toBe(0);
    expect(behavior["upgradeStructure"](city)).toBe(false);
    expect(
      spy.mock.calls.some((c) => c[0] instanceof UpgradeStructureExecution),
    ).toBe(false);
  });

  it("keeps warship cargo at home and floods the far coast", async () => {
    const game = await setup("half_land_half_ocean", {}, [
      new PlayerInfo("nation", PlayerType.Nation, null, "nation"),
    ]);
    const nation = game.player("nation");
    const home = coastTile(game, () => true);
    for (const n of game.neighbors(home.water)) {
      if (game.isLand(n)) nation.conquer(n);
    }
    const ship = nation.buildUnit(UnitType.Warship, home.water, {
      patrolTile: home.water,
    });
    ship.updateWarshipState({ cargo: 40, patrolTile: ship.tile() });
    const exec = new WarshipExecution(ship);
    exec.init(game, 0);
    exec.tick(1);
    expect(ship.warshipState().cargo).toBe(40);

    const far = coastTile(
      game,
      (tile) => game.owner(tile) !== nation && game.isLand(tile),
    );
    ship.move(far.water);
    ship.updateWarshipState({ patrolTile: far.water });
    const landed = vi.spyOn(game, "addExecution");
    exec.tick(2);
    game.executeNextTick();

    expect(ship.warshipState().cargo).toBe(0);
    expect(nation.units(UnitType.Army)).toHaveLength(0);
    expect(game.owner(far.land)).toBe(nation);
    expect(landed.mock.calls.some((c) => c[0] instanceof AttackExecution)).toBe(
      true,
    );
  });
});

function sentArmy(game: Game, send: () => boolean): AttackExecution {
  const spy = vi.spyOn(game, "addExecution");
  expect(send()).toBe(true);
  const army = spy.mock.calls
    .map((c) => c[0])
    .find((e): e is AttackExecution => e instanceof AttackExecution);
  spy.mockRestore();
  expect(army).toBeDefined();
  return army!;
}

function firstLand(game: Game, player: Player) {
  let tile = 0;
  game.map().forEachTile((t) => {
    if (tile === 0 && game.map().isLand(t)) {
      player.conquer(t);
      tile = t;
    }
  });
  return tile;
}

function coastTile(
  game: Game,
  landOk: (tile: number) => boolean,
): { land: number; water: number } {
  let found: { land: number; water: number } | null = null;
  game.map().forEachTile((tile) => {
    if (found !== null || !game.isLand(tile) || !landOk(tile)) return;
    for (const n of game.neighbors(tile)) {
      if (game.isWater(n)) {
        found = { land: tile, water: n };
        return;
      }
    }
  });
  if (found === null) throw new Error("no coast");
  return found;
}
