import { zRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

export class DefensePostExecution implements Execution {
  private mg: Game;
  private active: boolean = true;

  constructor(private post: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (!this.post.isActive()) {
      this.active = false;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return DefensePostExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      post: w.unit(this.post),
    });
  }

  restoreSnapshot(s: DefensePostState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.post = r.unit(s.post);
  }
}

const DefensePostStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  post: zRef(),
});
type DefensePostState = z.infer<typeof DefensePostStateSchema>;

export const DefensePostExecutionSnapshot = execSnapshotType({
  name: "DefensePost",
  version: 2,
  migrations: { 1: (data) => data },
  schema: DefensePostStateSchema,
  cls: () => DefensePostExecution,
});
