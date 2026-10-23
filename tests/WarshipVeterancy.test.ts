import {
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { WarshipExecution } from "@openfront/engine/execution/WarshipExecution";
import { Game, Player, Unit } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";

const coastX = 7;
let game: Game;
let attacker: Player;
let defender: Player;

describe("Warship veterancy", () => {
  beforeEach(async () => {
    game = await setup(
      "half_land_half_ocean",
      { infiniteGold: true, instantBuild: true },
      [
        new PlayerInfo("attacker", PlayerType.Human, null, "player_1_id"),
        new PlayerInfo("defender", PlayerType.Human, null, "player_2_id"),
      ],
    );
    attacker = game.player("player_1_id");
    defender = game.player("player_2_id");
  });

  function buildWarship(player: Player, x: number, y: number): Unit {
    return player.buildUnit(UnitType.Warship, game.ref(x, y), {
      patrolTile: game.ref(x, y),
    });
  }

  test("killing an enemy warship grants one veterancy level", () => {
    const ship = buildWarship(attacker, coastX, 10);
    expect(ship.veterancy()).toBe(0);

    ship.recordKill(UnitType.Warship);

    expect(ship.veterancy()).toBe(1);
  });

  test("veterancy is capped at the configured maximum", () => {
    const ship = buildWarship(attacker, coastX, 10);
    const max = game.config().warshipMaxVeterancy();

    for (let i = 0; i < max + 3; i++) {
      ship.recordKill(UnitType.Warship);
    }

    expect(ship.veterancy()).toBe(max);
  });

  test("destroying transport ships alone fills a level at the threshold", () => {
    const ship = buildWarship(attacker, coastX, 10);
    const threshold = game.config().warshipVeterancyTransportKills();

    for (let i = 0; i < threshold - 1; i++) {
      ship.recordKill(UnitType.TransportShip);
    }
    expect(ship.veterancy()).toBe(0);

    ship.recordKill(UnitType.TransportShip);
    expect(ship.veterancy()).toBe(1);
  });

  test("capturing trade ships alone fills a level at the threshold", () => {
    const ship = buildWarship(attacker, coastX, 10);
    const threshold = game.config().warshipVeterancyTradeCaptures();

    for (let i = 0; i < threshold - 1; i++) {
      ship.recordTradeCapture();
    }
    expect(ship.veterancy()).toBe(0);

    ship.recordTradeCapture();
    expect(ship.veterancy()).toBe(1);
  });

  test("transports and captures share one progress meter", () => {
    const ship = buildWarship(attacker, coastX, 10);
    // Defaults: 10 transports OR 25 captures = 1 level, so a transport is worth
    // 1/10 of a level and a capture 1/25. Mixed progress combines.
    for (let i = 0; i < 5; i++) ship.recordKill(UnitType.TransportShip);
    for (let i = 0; i < 12; i++) ship.recordTradeCapture();
    expect(ship.veterancy()).toBe(0); // 5/10 + 12/25 = 0.98 < 1

    ship.recordTradeCapture();
    expect(ship.veterancy()).toBe(1); // 5/10 + 13/25 = 1.02 ≥ 1
  });

  test("a warship kill resets transport/capture progress", () => {
    const ship = buildWarship(attacker, coastX, 10);
    const threshold = game.config().warshipVeterancyTransportKills();

    // Build up 9/10 of a level from transports (no level yet).
    for (let i = 0; i < threshold - 1; i++) {
      ship.recordKill(UnitType.TransportShip);
    }
    expect(ship.veterancy()).toBe(0);

    // A warship kill grants a level AND wipes the partial progress.
    ship.recordKill(UnitType.Warship);
    expect(ship.veterancy()).toBe(1);

    // Had progress carried, this transport would have completed level 2.
    // Since it reset, we're still at level 1.
    ship.recordKill(UnitType.TransportShip);
    expect(ship.veterancy()).toBe(1);
  });

  test("partial progress carries past a level-up", () => {
    const ship = buildWarship(attacker, coastX, 10);
    const threshold = game.config().warshipVeterancyTradeCaptures();

    // One past the threshold → level 1 with 1 capture's worth carried over.
    for (let i = 0; i < threshold + 1; i++) ship.recordTradeCapture();
    expect(ship.veterancy()).toBe(1);

    // The carried progress means one fewer capture completes level 2.
    for (let i = 0; i < threshold - 1; i++) ship.recordTradeCapture();
    expect(ship.veterancy()).toBe(2);
  });

  test("veterancy raises max health but does not instantly heal", () => {
    const ship = buildWarship(attacker, coastX, 10);
    const base = game.config().unitInfo(UnitType.Warship).maxHealth!;
    const bonusPercent = game.config().warshipVeterancyHealthBonus();

    // Drop below full so a (removed) instant heal would be observable.
    ship.modifyHealth(-100);
    expect(ship.maxHealth()).toBe(base);
    expect(ship.health()).toBe(base - 100);

    ship.recordKill(UnitType.Warship); // veterancy 1

    // The cap rises, but current health is unchanged — the ship heals toward
    // the new max normally, it does not jump on level-up.
    expect(ship.maxHealth()).toBe(
      base + Math.floor((base * 1 * bonusPercent) / 100),
    );
    expect(ship.health()).toBe(base - 100);
  });

  test("non-warships never gain veterancy", () => {
    const transport = defender.buildUnit(
      UnitType.TransportShip,
      game.ref(coastX, 10),
      {},
    );

    transport.recordKill(UnitType.Warship);
    transport.recordTradeCapture();

    expect(transport.veterancy()).toBe(0);
  });

  test("a warship tick in combat does not add a shell unit", () => {
    const shooter = buildWarship(attacker, coastX, 10);
    const target = buildWarship(defender, coastX + 1, 10);
    game.addExecution(new WarshipExecution(shooter));
    shooter.setTargetUnit(target);

    const before = game.units().length;
    game.executeNextTick();

    const units = game.units();
    const allowed = new Set<string>(Object.values(UnitType));
    expect(units).toHaveLength(before);
    expect(units.every((unit) => allowed.has(unit.type()))).toBe(true);
    expect(units.map((unit) => unit.type())).toEqual([
      UnitType.Warship,
      UnitType.Warship,
    ]);
  });
});
