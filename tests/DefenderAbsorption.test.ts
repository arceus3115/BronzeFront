import { TileRef } from "@openfront/engine-api/game/GameMap";
import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { absorbDefenderTiles } from "@openfront/engine/execution/AttackExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { describe, expect, test } from "vitest";
import { setup } from "./util/Setup";

const human = (id: string) => new PlayerInfo(id, PlayerType.Human, id, id);

describe("absorbDefenderTiles", () => {
  test("matches the repeated border passes, including who arrives first", async () => {
    const game = await setup("plains", {}, [
      human("a"),
      human("b"),
      human("c"),
    ]);
    const a = game.player("a");
    const b = game.player("b");
    const c = game.player("c");

    a.conquer(game.ref(5, 5));
    a.conquer(game.ref(5, 15));
    c.conquer(game.ref(9, 6));
    // Far end first, so the third player is visited before the attacker.
    b.conquer(game.ref(9, 5));
    b.conquer(game.ref(8, 5));
    b.conquer(game.ref(7, 5));
    b.conquer(game.ref(6, 5));
    // Near end first, so the attacker floods the chain in one pass.
    b.conquer(game.ref(6, 15));
    b.conquer(game.ref(7, 15));
    b.conquer(game.ref(8, 15));
    // Pocket that touches nobody in the fight.
    b.conquer(game.ref(20, 20));
    b.conquer(game.ref(21, 20));
    b.conquer(game.ref(20, 21));
    b.conquer(game.ref(21, 21));

    const original: TileRef[] = [];
    for (const tile of b.tiles()) original.push(tile);
    const expected = passOwners(game, a, b);
    absorbDefenderTiles(game, a, b);

    for (const tile of original) {
      expect(game.owner(tile)).toBe(expected.get(tile));
    }
    expect(game.owner(game.ref(9, 5))).toBe(c);
    expect(game.owner(game.ref(8, 5))).toBe(c);
    expect(game.owner(game.ref(7, 5))).toBe(c);
    expect(game.owner(game.ref(6, 5))).toBe(a);
    expect(game.owner(game.ref(6, 15))).toBe(a);
    expect(game.owner(game.ref(8, 15))).toBe(a);
    expect(game.owner(game.ref(20, 20))).toBe(b);
    expect(game.owner(game.ref(21, 21))).toBe(b);
  });
});

/** The old 100-pass scan, on a copied owner map. */
function passOwners(
  game: Game,
  attacker: Player,
  target: Player,
): Map<TileRef, Player | ReturnType<Game["owner"]>> {
  const tiles: TileRef[] = [];
  for (const tile of target.tiles()) tiles.push(tile);
  const owners = new Map<TileRef, Player | ReturnType<Game["owner"]>>();
  const seen = new Set<TileRef>();
  const consider = (tile: TileRef) => {
    if (seen.has(tile)) return;
    seen.add(tile);
    owners.set(tile, game.owner(tile));
  };
  for (const tile of tiles) {
    consider(tile);
    for (const neighbor of game.neighbors(tile)) consider(neighbor);
  }
  for (let pass = 0; pass < 100; pass++) {
    let progressed = false;
    for (const tile of tiles) {
      if (owners.get(tile) !== target) continue;
      let bordersAttacker = false;
      for (const neighbor of game.neighbors(tile)) {
        if (owners.get(neighbor) !== attacker) continue;
        bordersAttacker = true;
        break;
      }
      if (bordersAttacker) {
        owners.set(tile, attacker);
        progressed = true;
        continue;
      }
      for (const neighbor of game.neighbors(tile)) {
        const owner = owners.get(neighbor);
        if (owner === undefined) continue;
        if (owner.isPlayer() && owner !== target && !owner.isFriendly(target)) {
          owners.set(tile, owner);
          progressed = true;
          break;
        }
      }
    }
    if (!progressed) break;
  }
  return owners;
}
