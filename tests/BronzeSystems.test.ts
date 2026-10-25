import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  PlayerInfo,
  PlayerType,
  TerrainType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  assignBiomes,
  fallbackBiome,
  foodWeight,
  mineWeight,
} from "@openfront/engine-lib/game/Biome";
import {
  armyRadius,
  BRONZE_WEAPONS_COST,
  cityUpgradeFoodCost,
  MARKETS_COST,
} from "@openfront/engine-lib/game/BronzeRules";
import { ArmyExecution } from "@openfront/engine/execution/ArmyExecution";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import {
  ExchangeExecution,
  ResearchExecution,
} from "@openfront/engine/execution/BronzeTechExecution";
import { PlayerExecution } from "@openfront/engine/execution/PlayerExecution";
import { WarshipCargoExecution } from "@openfront/engine/execution/WarshipCargoExecution";
import { WarshipExecution } from "@openfront/engine/execution/WarshipExecution";
import { GameImpl } from "@openfront/engine/game/GameImpl";
import { describe, expect, test } from "vitest";
import { setup } from "./util/Setup";

const human = (id: string) => new PlayerInfo(id, PlayerType.Human, id, id);

describe("biomes", () => {
  test("assigns coast, mountain, forest, lush, plains, and desert", () => {
    const width = 30;
    const height = 1;
    const terrain = new Uint8Array(width);
    const land = 1 << 7;
    terrain[0] = 1 << 5;
    for (let x = 1; x < width; x++) {
      const mag = x === 5 ? 20 : x === 6 ? 12 : 1;
      const shore = x === 2 ? 1 << 6 : 0;
      terrain[x] = land | shore | mag;
    }
    const biomes = assignBiomes(width, height, terrain);
    expect(biomes[0]).toBe(TerrainType.Ocean);
    expect(biomes[2]).toBe(TerrainType.Coast);
    expect(biomes[5]).toBe(TerrainType.Mountain);
    expect(biomes[6]).toBe(TerrainType.Forest);
    expect(biomes[1]).toBe(TerrainType.Lush);
    expect(biomes[10]).toBe(TerrainType.Plains);
    expect(biomes[26]).toBe(TerrainType.Desert);
  });

  test("one-byte maps fall back without lush or desert", () => {
    expect(fallbackBiome(true, true, 4)).toBe(TerrainType.Coast);
    expect(fallbackBiome(true, false, 22)).toBe(TerrainType.Mountain);
    expect(fallbackBiome(true, false, 14)).toBe(TerrainType.Forest);
    expect(fallbackBiome(true, false, 2)).toBe(TerrainType.Plains);
    expect(fallbackBiome(false, false, 0)).toBe(TerrainType.Ocean);
  });
});

describe("resources and technology", () => {
  test("land yield is paid as total / 50 and science is a quarter of the worker grant", async () => {
    const game = await setup("plains", { instantBuild: true }, [human("a")]);
    const player = game.player("a");
    for (let i = 0; i < 50; i++) {
      const tile = game.ref(i, 2);
      game.setBiome(tile, TerrainType.Plains);
      player.conquer(tile);
    }
    expect(player.foodYield()).toBe(50 * foodWeight(TerrainType.Plains));
    const mountain = game.ref(0, 3);
    game.setBiome(mountain, TerrainType.Mountain);
    player.conquer(mountain);
    expect(player.mineYield()).toBe(mineWeight(TerrainType.Mountain));
    player.relinquish(mountain);
    expect(player.mineYield()).toBe(0);

    const foodBefore = player.food();
    const scienceBefore = player.science();
    const goldBefore = player.gold();
    game.addExecution(new PlayerExecution(player));
    game.executeNextTick();
    game.executeNextTick();
    expect(player.food() - foodBefore).toBe(1n);
    expect(player.science() - scienceBefore).toBe(25n);
    expect(player.gold() - goldBefore).toBe(100n);
  });

  test("city upgrades spend discounted food, and markets exchange 3:1 after unlock", async () => {
    const game = await setup("plains", { instantBuild: true }, [human("a")]);
    const player = game.player("a");
    player.conquer(game.ref(4, 4));
    const city = player.buildUnit(UnitType.City, game.ref(4, 4), {});
    const base = game.unitInfo(UnitType.City).cost(game, player);
    const cheap = cityUpgradeFoodCost(base, 1_000_000n);
    const full = cityUpgradeFoodCost(base, 0n);
    expect(cheap).toBeLessThan(full);

    player.addFood(full);
    const gold = player.gold();
    const spent = cityUpgradeFoodCost(base, player.food());
    player.upgradeUnit(city);
    expect(player.gold()).toBe(gold);
    expect(player.food()).toBe(full - spent);
    expect(spent).toBeLessThan(full);

    const foodAfterUpgrade = player.food();
    player.addFood(9n);
    const blocked = new ExchangeExecution(player, "food_to_money", 9);
    blocked.init(game, 0);
    expect(player.food()).toBe(foodAfterUpgrade + 9n);

    player.addScience(MARKETS_COST);
    new ResearchExecution(player, "markets").init(game, 0);
    expect(player.hasMarkets()).toBe(true);
    new ExchangeExecution(player, "food_to_money", 9).init(game, 0);
    expect(player.food()).toBe(foodAfterUpgrade);
    expect(player.gold()).toBe(gold + 3n);

    player.addScience(BRONZE_WEAPONS_COST);
    new ResearchExecution(player, "bronze_weapons").init(game, 0);
    expect(player.strengthMultiplier()).toBeCloseTo(4 / 3);
  });
});

describe("armies, sieges, and influence", () => {
  test("a drop spends 20% and floods the neighboring tile", async () => {
    const game = await setup("plains", {}, [human("a"), human("b")]);
    const a = game.player("a");
    const b = game.player("b");
    for (let x = 0; x < 4; x++) a.conquer(game.ref(x, 6));
    const target = game.ref(4, 6);
    b.conquer(target);
    a.addTroops(100);
    const before = a.troops();
    const spend = Math.floor(before * 0.2);
    game.addExecution(new AttackExecution(spend, a, b.id()));
    game.executeNextTick();
    expect(a.troops()).toBe(before - spend);
    expect(a.units(UnitType.Army)).toHaveLength(0);
    game.executeNextTick();
    expect(game.owner(target)).toBe(a);
  });

  test("the push stays on the army and leaves a far border alone", async () => {
    const game = await setup("plains", {}, [human("a")]);
    const player = game.player("a");
    for (let y = 8; y <= 12; y++) player.conquer(game.ref(0, y));
    const far = game.ref(40, 40);
    const farNeighbor = game.ref(41, 40);
    player.conquer(far);
    const troops = 10;
    player.addTroops(troops);
    const before = new Set<TileRef>();
    player.tiles().forEach((tile) => before.add(tile));
    const goal = game.ref(12, 10);
    game.addExecution(new ArmyExecution(player, troops, goal));
    game.executeNextTick();
    const army = player.units(UnitType.Army)[0];
    const radius = armyRadius(troops);
    const path: TileRef[] = [army.tile()];
    for (let i = 0; i < 6; i++) {
      game.executeNextTick();
      expect(game.owner(army.tile())).toBe(player);
      path.push(army.tile());
    }
    expect(player.numTilesOwned()).toBeGreaterThan(before.size);
    expect(game.owner(far)).toBe(player);
    expect(game.owner(farNeighbor)).not.toBe(player);

    const reached = new Set<TileRef>(before);
    const queue = [...before];
    while (queue.length > 0) {
      const tile = queue.pop()!;
      for (const neighbor of game.neighbors(tile)) {
        if (game.owner(neighbor) !== player || reached.has(neighbor)) continue;
        reached.add(neighbor);
        queue.push(neighbor);
      }
    }
    player.tiles().forEach((tile) => {
      expect(reached.has(tile)).toBe(true);
      if (before.has(tile)) return;
      const near = path.some((at) => {
        const dx = game.x(tile) - game.x(at);
        const dy = game.y(tile) - game.y(at);
        return dx * dx + dy * dy <= radius * radius;
      });
      expect(near).toBe(true);
    });
  });

  test("a straight push is wider than the trail of one tile", async () => {
    const game = await setup("plains", {}, [human("a")]);
    const player = game.player("a");
    for (let y = 8; y <= 12; y++) player.conquer(game.ref(0, y));
    const troops = 10;
    player.addTroops(troops);
    const radius = armyRadius(troops);
    const before = new Set<TileRef>();
    player.tiles().forEach((tile) => before.add(tile));
    game.addExecution(new ArmyExecution(player, troops, game.ref(8, 10)));
    game.executeNextTick();
    for (let i = 0; i < 6; i++) game.executeNextTick();
    const army = player.units(UnitType.Army)[0];
    expect(game.owner(army.tile())).toBe(player);
    let minY = Infinity;
    let maxY = -Infinity;
    player.tiles().forEach((tile) => {
      if (before.has(tile)) return;
      const y = game.y(tile);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    });
    expect(maxY - minY).toBeGreaterThanOrEqual(2 * radius);
  });

  test("arrival fills the disk and leaves a far border alone", async () => {
    const game = await setup("plains", {}, [human("a")]);
    const player = game.player("a");
    for (let y = 8; y <= 12; y++) player.conquer(game.ref(0, y));
    const far = game.ref(40, 40);
    player.conquer(far);
    const troops = 10;
    player.addTroops(troops);
    const radius = armyRadius(troops);
    const goal = game.ref(1, 10);
    game.addExecution(new ArmyExecution(player, troops, goal));
    game.executeNextTick();
    for (let i = 0; i < 16; i++) game.executeNextTick();
    const army = player.units(UnitType.Army)[0];
    expect(army.tile()).toBe(goal);
    expect(game.owner(army.tile())).toBe(player);
    expect(game.owner(game.ref(41, 40))).not.toBe(player);
    const ax = game.x(army.tile());
    const ay = game.y(army.tile());
    const limit = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > limit) continue;
        const x = ax + dx;
        const y = ay + dy;
        if (!game.isValidCoord(x, y)) continue;
        const tile = game.ref(x, y);
        if (!game.isLand(tile) || game.isImpassable(tile)) continue;
        let touches = false;
        for (const neighbor of game.neighbors(tile)) {
          if (game.owner(neighbor) === player) touches = true;
        }
        if (!touches && game.owner(tile) !== player) continue;
        expect(game.owner(tile)).toBe(player);
      }
    }
  });

  test("a larger stack conquers more land in the same time", async () => {
    const small = await conqueredBy(10, 4);
    const large = await conqueredBy(900, 4);
    expect(large).toBeGreaterThan(small);
  });

  test("mountain and forest advance fewer tiles than plains", async () => {
    const plains = await marched(TerrainType.Plains);
    const mountain = await marched(TerrainType.Mountain);
    const forest = await marched(TerrainType.Forest);
    expect(mountain).toBeLessThan(plains);
    expect(forest).toBe(mountain);
  });

  test("a siege flips the city, a defender slows it, and a post raises defense", async () => {
    const game = await setup("plains", { instantBuild: true }, [
      human("a"),
      human("b"),
    ]);
    const a = game.player("a");
    const b = game.player("b");
    a.conquer(game.ref(2, 8));
    const cityTile = game.ref(3, 8);
    b.conquer(cityTile);
    const city = b.buildUnit(UnitType.City, cityTile, {});
    a.addTroops(5000);
    game.addExecution(new ArmyExecution(a, 4000, cityTile));
    game.executeNextTick();
    game.executeNextTick();
    expect(game.owner(cityTile)).toBe(a);
    expect(city.owner()).toBe(a);

    const held = await setup("plains", { instantBuild: true }, [
      human("a"),
      human("b"),
    ]);
    const atk = held.player("a");
    const def = held.player("b");
    atk.conquer(held.ref(2, 8));
    const heldCityTile = held.ref(3, 8);
    def.conquer(heldCityTile);
    const heldCity = def.buildUnit(UnitType.City, heldCityTile, {});
    def.addTroops(20000);
    held.addExecution(new ArmyExecution(def, 15000, heldCityTile));
    held.executeNextTick();
    atk.addTroops(5000);
    held.addExecution(new ArmyExecution(atk, 4000, heldCityTile));
    held.executeNextTick();
    held.executeNextTick();
    expect(held.owner(heldCityTile)).toBe(def);
    expect(heldCity.owner()).toBe(def);
    expect((held as GameImpl).siegeProgress(heldCity.id())).toBe(0);

    const posted = await setup("plains", { instantBuild: true }, [
      human("a"),
      human("b"),
    ]);
    const pa = posted.player("a");
    const pb = posted.player("b");
    pa.conquer(posted.ref(2, 8));
    const postCityTile = posted.ref(3, 8);
    pb.conquer(postCityTile);
    pb.conquer(posted.ref(3, 9));
    const postCity = pb.buildUnit(UnitType.City, postCityTile, {});
    pb.buildUnit(UnitType.DefensePost, posted.ref(3, 9), {});
    pa.addTroops(3000);
    posted.addExecution(new ArmyExecution(pa, 1800, postCityTile));
    posted.executeNextTick();
    posted.executeNextTick();
    expect(posted.owner(postCityTile)).toBe(pb);
    expect(postCity.owner()).toBe(pb);
    expect((posted as GameImpl).siegeProgress(postCity.id())).toBeGreaterThan(
      0,
    );
  });

  test("influence expands a strong border and cedes a negative one", async () => {
    const growing = await setup("plains", { instantBuild: true }, [human("a")]);
    const grower = growing.player("a");
    const home = growing.ref(5, 5);
    grower.conquer(home);
    grower.buildUnit(UnitType.City, home, {});
    const before = grower.numTilesOwned();
    growing.addExecution(new PlayerExecution(grower));
    for (let i = 0; i < 11; i++) growing.executeNextTick();
    expect(grower.numTilesOwned()).toBe(before + 1);

    const pressed = await setup("plains", { instantBuild: true }, [
      human("a"),
      human("b"),
    ]);
    const weak = pressed.player("a");
    const strong = pressed.player("b");
    const weakTile = pressed.ref(10, 10);
    const strongTile = pressed.ref(12, 10);
    weak.conquer(weakTile);
    strong.conquer(strongTile);
    weak.buildUnit(UnitType.City, weakTile, {});
    const fort = strong.buildUnit(UnitType.City, strongTile, {});
    for (let i = 0; i < 8; i++) fort.increaseLevel();
    pressed.addExecution(new PlayerExecution(weak));
    for (let i = 0; i < 11; i++) pressed.executeNextTick();
    expect(pressed.owner(weakTile)).toBe(strong);
  });
});

describe("warships", () => {
  test("melee damages another warship and does not spawn a shell", async () => {
    const game = await setup("plains", { instantBuild: true }, [
      human("a"),
      human("b"),
    ]);
    const a = game.player("a");
    const b = game.player("b");
    const shipA = a.buildUnit(UnitType.Warship, game.ref(4, 4), {
      patrolTile: game.ref(4, 4),
    });
    const shipB = b.buildUnit(UnitType.Warship, game.ref(5, 4), {
      patrolTile: game.ref(5, 4),
    });
    const before = shipB.health();
    game.addExecution(new WarshipExecution(shipA));
    game.executeNextTick();
    game.executeNextTick();
    expect(shipB.health()).toBeLessThan(before);
    expect(game.units(UnitType.Warship)).toHaveLength(2);
  });

  test("loading and unloading moves troops onto a shore attack", async () => {
    const game = await setup("plains", { instantBuild: true }, [human("a")]);
    const player = game.player("a");
    const shore = game.ref(6, 6);
    player.conquer(shore);
    const ship = player.buildUnit(UnitType.Warship, shore, {
      patrolTile: shore,
    });
    player.addTroops(40);
    const before = player.troops();
    new WarshipCargoExecution(player, ship.id(), "load", 40, null).init(
      game,
      0,
    );
    expect(player.troops()).toBe(before - 40);
    expect(ship.warshipState().cargo).toBe(40);
    new WarshipCargoExecution(player, ship.id(), "unload", 0, shore).init(
      game,
      0,
    );
    expect(ship.warshipState().cargo).toBe(0);
    expect(player.units(UnitType.Army)).toHaveLength(0);
    game.executeNextTick();
    const attack = player
      .outgoingAttacks()
      .find((a) => a.sourceTile() === shore);
    expect(attack).toBeDefined();
    expect(attack!.troops()).toBe(40);
  });
});

async function conqueredBy(troops: number, ticks: number): Promise<number> {
  const game = await setup("plains", {}, [human("a")]);
  const player = game.player("a");
  for (let y = 8; y <= 12; y++) player.conquer(game.ref(0, y));
  const start = player.numTilesOwned();
  player.addTroops(troops);
  game.addExecution(new ArmyExecution(player, troops, game.ref(18, 10)));
  game.executeNextTick();
  for (let i = 0; i < ticks; i++) game.executeNextTick();
  return player.numTilesOwned() - start;
}

async function marched(biome: TerrainType): Promise<number> {
  const game = await setup("plains", {}, [human("a")]);
  const player = game.player("a");
  for (let x = 0; x < 3; x++) player.conquer(game.ref(x, 7));
  for (let x = 0; x < 12; x++) game.setBiome(game.ref(x, 7), biome);
  player.addTroops(50);
  const goal = game.ref(11, 7);
  game.addExecution(new ArmyExecution(player, 10, goal));
  game.executeNextTick();
  const army = player.units(UnitType.Army)[0];
  const startX = game.x(army.tile());
  for (let i = 0; i < 5; i++) game.executeNextTick();
  return game.x(army.tile()) - startX;
}
