import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { EventBus } from "@openfront/shared/EventBus";
import { Controller } from "../Controller";
import { PlaySoundEffectEvent, SoundEffect } from "../sound/Sounds";
import { SendSpawnIntentEvent } from "../Transport";
import { GameView, UnitView } from "../view";

// A new factory stations every owned City/Port/Factory within range on the
// same tick (FactoryExecution.createStation); play the cue once, not N times.
const TRAIN_STATION_SOUND_INTERVAL_TICKS = 10;

// hadTrainStation is keyed by unit id and normally cleared when the unit goes
// inactive, but one that leaves view without ever delivering that update would
// sit there for the rest of the session. Sweep it occasionally instead. 100
// ticks is ten seconds or so: far more often than the leak could matter, and
// rare enough that the scan costs nothing.
const TRAIN_STATION_SWEEP_INTERVAL_TICKS = 100;

// Structures a train station can be attached to (see TrainStationExecution).
const STATION_CAPABLE_TYPES = new Set<UnitType>([
  UnitType.City,
  UnitType.Mine,
  UnitType.Farm,
  UnitType.Port,
]);

export class SoundEffectController implements Controller {
  private lastTrainStationSoundTick = -Infinity;
  // A train station is a flag on an existing structure, not a unit — play the
  // build sound on the false→true edge only, so structures that already have
  // one when first seen (e.g. joining mid-game) stay silent.
  private hadTrainStation = new Map<number, boolean>();
  private lastTrainStationSweepTick = -Infinity;

  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
  ) {}

  init(): void {
    // On the intent, not the sim confirmation: the cue answers the player's
    // click, and re-placing the spawn should sound every time.
    this.eventBus.on(SendSpawnIntentEvent, this.onSpawnIntent);
  }

  private onSpawnIntent = (): void => {
    // Spectators can click unowned land too, but their intent is dropped
    // server-side — no false confirmation cue.
    if (this.game.myPlayer() === null) return;
    this.emit("spawn");
  };

  tick(): void {
    const updates = this.game.updatesSinceLastTick();
    if (!updates) return;

    this.pruneTrainStations();

    for (const u of updates[GameUpdateType.Unit] ?? []) {
      const unit = this.game.unit(u.id);
      if (unit === undefined) continue;
      this.handleUnit(unit);
    }

    if ((updates[GameUpdateType.SpawnPhaseEnd] ?? []).length > 0) {
      this.emit("game-start");
    }

    const myPlayer = this.game.myPlayer();
    if (myPlayer === null) return;
    for (const c of updates[GameUpdateType.ConquestEvent] ?? []) {
      if (c.conquerorId === myPlayer.id()) {
        // Battle cue for conquering a real player; the ka-ching payout
        // stays for bots and nations.
        const conquered = this.game.player(c.conqueredId);
        this.emit(
          conquered.type() === PlayerType.Human ? "conquered" : "ka-ching",
        );
      }
    }

  }

  private handleUnit(unit: UnitView): void {
    if (unit.isActive() && unit.createdAt() === this.game.ticks()) {
      this.onCreated(unit);
    }
    if (STATION_CAPABLE_TYPES.has(unit.type())) {
      this.handleTrainStation(unit);
    }
  }

  private onCreated(unit: UnitView): void {
    const myPlayer = this.game.myPlayer();
    switch (unit.type()) {
      case UnitType.Warship:
        if (unit.owner() === myPlayer) this.emit("build-warship");
        break;
      case UnitType.City:
        if (unit.owner() === myPlayer) this.emit("build-city");
        break;
      case UnitType.Port:
        if (unit.owner() === myPlayer) this.emit("build-port");
        break;
      case UnitType.DefensePost:
        if (unit.owner() === myPlayer) this.emit("build-defense-post");
        break;
      case UnitType.Mine:
      case UnitType.Farm:
        if (unit.owner() === myPlayer) this.emit("build-factory");
        break;
      case UnitType.TransportShip:
        if (unit.owner() === myPlayer) this.emit("transport-ship");
        break;
    }
  }

  /**
   * Drops entries for structures that are gone.
   *
   * No cue can be lost to this. GameView only removes a unit once it is
   * inactive (it queues the id on the tick isActive() goes false), so both
   * arms of the test below mean destroyed, and a destroyed structure never
   * comes back to gain a station. The sweep is the same condition
   * handleTrainStation already applies, catching the units whose final update
   * never reached it.
   *
   * Nor can one be replayed, which is what the `prev === false` check in
   * handleTrainStation is for rather than a plain falsy test: a structure
   * whose entry has gone reads as undefined, not false, so it is treated like
   * one first seen with a station already and stays silent.
   */
  private pruneTrainStations(): void {
    const tick = this.game.ticks();
    if (
      tick - this.lastTrainStationSweepTick <
      TRAIN_STATION_SWEEP_INTERVAL_TICKS
    ) {
      return;
    }
    this.lastTrainStationSweepTick = tick;
    for (const id of this.hadTrainStation.keys()) {
      const unit = this.game.unit(id);
      if (unit === undefined || !unit.isActive()) {
        this.hadTrainStation.delete(id);
      }
    }
  }

  private handleTrainStation(unit: UnitView): void {
    if (!unit.isActive()) {
      this.hadTrainStation.delete(unit.id());
      return;
    }
    const hasStation = unit.hasTrainStation();
    const prev = this.hadTrainStation.get(unit.id());
    if (prev === false && hasStation && unit.owner() === this.game.myPlayer()) {
      const tick = this.game.ticks();
      if (
        tick - this.lastTrainStationSoundTick >=
        TRAIN_STATION_SOUND_INTERVAL_TICKS
      ) {
        this.lastTrainStationSoundTick = tick;
        this.emit("build-train-station");
      }
    }
    this.hadTrainStation.set(unit.id(), hasStation);
  }

  private emit(sound: SoundEffect): void {
    this.eventBus.emit(new PlaySoundEffectEvent(sound));
  }
}
