import { Tick } from "@openfront/engine-api/game/GameTypes";
import {
  AttackLogicInput,
  AttackLogicResult,
  EngineConfig,
} from "@openfront/engine/configuration/EngineConfig";

export class TestConfig extends EngineConfig {
  private _proximityBonusPortsNb: number = 0;
  private _spawnImmunityDuration: number = 0;
  private _nationSpawnImmunityDuration: number = 0;

  disableNavMesh(): boolean {
    return this.gameConfig().disableNavMesh ?? true;
  }

  radiusPortSpawn(): number {
    return 1;
  }

  proximityBonusPortsNb(totalPorts: number): number {
    return this._proximityBonusPortsNb;
  }

  // Specific to TestConfig
  setProximityBonusPortsNb(nb: number): void {
    this._proximityBonusPortsNb = nb;
  }

  deletionMarkDuration(): number {
    return 5;
  }

  setSpawnImmunityDuration(duration: Tick) {
    this._spawnImmunityDuration = duration;
  }

  spawnImmunityDuration(): Tick {
    return this._spawnImmunityDuration;
  }

  setNationSpawnImmunityDuration(duration: Tick) {
    this._nationSpawnImmunityDuration = duration;
  }

  nationSpawnImmunityDuration(): Tick {
    return this._nationSpawnImmunityDuration;
  }

  attackLogic(_input: AttackLogicInput): AttackLogicResult {
    return { attackerTroopLoss: 1, defenderTroopLoss: 1, tickFraction: 1 };
  }
}
export class UseRealAttackLogic extends TestConfig {
  attackLogic(input: AttackLogicInput): AttackLogicResult {
    return EngineConfig.prototype.attackLogic.call(this, input);
  }
}
