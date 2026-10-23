import {
  MessageType,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { EventBus } from "@openfront/shared/EventBus";
import { SoundEffectController } from "../../../src/client/controllers/SoundEffectController";
import { PlaySoundEffectEvent } from "../../../src/client/sound/Sounds";
import { SendSpawnIntentEvent } from "../../../src/client/Transport";

describe("SoundEffectController", () => {
  let eventBus: EventBus;
  let played: string[];
  let tick: number;
  let units: Map<number, any>;
  let game: any;
  let controller: SoundEffectController;

  function tickWithUnits(...us: Array<{ id: () => number }>) {
    tick++;
    units = new Map(us.map((u) => [u.id(), u]));
    game.updatesSinceLastTick = () => ({
      [GameUpdateType.Unit]: us.map((u) => ({ id: u.id() })),
    });
    controller.tick();
  }

  beforeEach(() => {
    eventBus = new EventBus();
    played = [];
    eventBus.on(PlaySoundEffectEvent, (e) => played.push(e.effect));
    tick = 0;
    game = {
      ticks: () => tick,
      unit: (id: number) => units.get(id),
      myPlayer: () => null,
      updatesSinceLastTick: () => undefined,
    };
    controller = new SoundEffectController(game, eventBus);
  });


  // createdAt reads `tick` lazily, so the unit counts as created on whichever
  // tick tickWithUnits delivers it.
  function makeCreatedUnit(id: number, type: UnitType, owner: object) {
    return {
      id: () => id,
      type: () => type,
      isActive: () => true,
      reachedTarget: () => false,
      createdAt: () => tick,
      owner: () => owner,
      hasTrainStation: () => false,
    };
  }

  it("plays the battle cue for conquering a player, ka-ching for tribes", () => {
    game.myPlayer = () => ({ id: () => "me" });
    game.inSpawnPhase = () => false;
    const types: Record<string, PlayerType> = {
      human: PlayerType.Human,
      bot: PlayerType.Bot,
      nation: PlayerType.Nation,
    };
    game.player = (id: string) => ({ type: () => types[id] });
    game.updatesSinceLastTick = () => ({
      [GameUpdateType.ConquestEvent]: [
        { conquerorId: "me", conqueredId: "human" },
        { conquerorId: "me", conqueredId: "bot" },
        { conquerorId: "me", conqueredId: "nation" },
        { conquerorId: "other", conqueredId: "human" },
      ],
    });
    controller.tick();
    expect(played).toEqual(["conquered", "ka-ching", "ka-ching"]);
  });

  it("plays game-start when the spawn phase ends", () => {
    game.updatesSinceLastTick = () => ({
      [GameUpdateType.SpawnPhaseEnd]: [{ startTick: 10 }],
    });
    controller.tick();
    expect(played).toEqual(["game-start"]);
  });

  it("plays spawn on every spawn placement", () => {
    game.myPlayer = () => ({});
    controller.init();
    eventBus.emit(new SendSpawnIntentEvent(0 as never));
    eventBus.emit(new SendSpawnIntentEvent(1 as never));
    expect(played).toEqual(["spawn", "spawn"]);
  });

  it("does not play spawn for spectators", () => {
    controller.init();
    eventBus.emit(new SendSpawnIntentEvent(0 as never));
    expect(played).toEqual([]);
  });


  it("plays build sounds only for my own factory and transport ship", () => {
    const me = {};
    game.myPlayer = () => me;
    game.inSpawnPhase = () => false;
    tickWithUnits(
      makeCreatedUnit(1, UnitType.Mine, me),
      makeCreatedUnit(2, UnitType.TransportShip, me),
      makeCreatedUnit(3, UnitType.Mine, {}),
      makeCreatedUnit(4, UnitType.TransportShip, {}),
    );
    expect(played).toEqual(["build-factory", "transport-ship"]);
  });

  it("plays build-train-station when my structure gains a station", () => {
    const me = {};
    game.myPlayer = () => me;
    game.inSpawnPhase = () => false;
    let hasStation = false;
    const city = {
      id: () => 1,
      type: () => UnitType.City,
      isActive: () => true,
      reachedTarget: () => false,
      createdAt: () => 0,
      owner: () => me,
      hasTrainStation: () => hasStation,
    };
    tickWithUnits(city);
    expect(played).toEqual([]);
    hasStation = true;
    tickWithUnits(city);
    expect(played).toEqual(["build-train-station"]);
    tickWithUnits(city);
    expect(played).toEqual(["build-train-station"]);
  });

  it("plays one train-station cue when several structures gain stations at once", () => {
    const me = {};
    game.myPlayer = () => me;
    game.inSpawnPhase = () => false;
    let hasStation = false;
    const makeStructure = (id: number) => ({
      id: () => id,
      type: () => UnitType.City,
      isActive: () => true,
      reachedTarget: () => false,
      createdAt: () => 0,
      owner: () => me,
      hasTrainStation: () => hasStation,
    });
    const structures = [makeStructure(1), makeStructure(2), makeStructure(3)];
    tickWithUnits(...structures);
    hasStation = true;
    tickWithUnits(...structures);
    expect(played).toEqual(["build-train-station"]);
  });

  it("forgets structures that vanish without going inactive", () => {
    const me = {};
    game.myPlayer = () => me;
    game.inSpawnPhase = () => false;
    const city = {
      id: () => 1,
      type: () => UnitType.City,
      isActive: () => true,
      reachedTarget: () => false,
      createdAt: () => 0,
      owner: () => me,
      hasTrainStation: () => false,
    };
    tickWithUnits(city);
    const tracked = (controller as any).hadTrainStation as Map<number, boolean>;
    expect(tracked.size).toBe(1);

    // Out of view, and no inactive update ever arrives for it.
    for (let i = 0; i < 120; i++) tickWithUnits();

    expect(tracked.size).toBe(0);
  });

  it("does not replay the cue for a structure that comes back with a station", () => {
    // The reason handleTrainStation tests `prev === false` and not a falsy
    // value: a pruned structure reads as undefined when it returns, which has
    // to mean "first seen" and stay silent, not "was false" and fire.
    const me = {};
    game.myPlayer = () => me;
    game.inSpawnPhase = () => false;
    let hasStation = false;
    const city = {
      id: () => 1,
      type: () => UnitType.City,
      isActive: () => true,
      reachedTarget: () => false,
      createdAt: () => 0,
      owner: () => me,
      hasTrainStation: () => hasStation,
    };
    tickWithUnits(city);
    for (let i = 0; i < 120; i++) tickWithUnits();
    expect((controller as any).hadTrainStation.size).toBe(0);

    hasStation = true;
    tickWithUnits(city);

    expect(played).toEqual([]);
  });

  it("stays silent for a structure first seen with a station already", () => {
    const me = {};
    game.myPlayer = () => me;
    game.inSpawnPhase = () => false;
    const city = {
      id: () => 1,
      type: () => UnitType.City,
      isActive: () => true,
      reachedTarget: () => false,
      createdAt: () => 0,
      owner: () => me,
      hasTrainStation: () => true,
    };
    tickWithUnits(city);
    expect(played).toEqual([]);
  });
});
