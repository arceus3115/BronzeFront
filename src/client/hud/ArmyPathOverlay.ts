import { TileRef } from "@openfront/engine-api/game/GameMap";
import { GameEvent } from "@openfront/shared/EventBus";
import { TransformHandler } from "../TransformHandler";
import { GameView } from "../view/GameView";

export class ShowTargetMarkerEvent implements GameEvent {
  constructor(
    public readonly x: number,
    public readonly y: number,
    public readonly ownerID: number,
  ) {}
}

/** The army the player has selected, and the tile the cursor is aiming at. */
export const armyAim: { from: TileRef | null; to: TileRef | null } = {
  from: null,
  to: null,
};

/**
 * Greedy land steps, matching the army's march: each step is the neighbor
 * closest to the goal.
 */
export function armyPath(
  game: GameView,
  from: TileRef,
  to: TileRef,
): TileRef[] {
  const path: TileRef[] = [];
  let current = from;
  for (let i = 0; i < 80 && current !== to; i++) {
    let best: TileRef | undefined;
    let bestD = game.manhattanDist(current, to);
    for (const n of game.neighbors(current)) {
      if (!game.isLand(n) || game.isImpassable(n)) continue;
      const d = game.manhattanDist(n, to);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    if (best === undefined) break;
    path.push(best);
    current = best;
  }
  return path;
}

/** Screen dots along the aimed path while an army is selected. */
export class ArmyPathOverlay {
  private canvas: HTMLCanvasElement;

  constructor(
    private readonly gameView: GameView,
    private readonly transform: TransformHandler,
    parent: HTMLElement,
  ) {
    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "5";
    parent.appendChild(canvas);
    this.canvas = canvas;
  }

  draw(): void {
    const canvas = this.canvas;
    const parent = canvas.parentElement;
    if (parent === null) return;
    const width = parent.clientWidth;
    const height = parent.clientHeight;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    ctx.clearRect(0, 0, width, height);
    const { from, to } = armyAim;
    if (from === null || to === null) return;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (const tile of armyPath(this.gameView, from, to)) {
      const screen = this.transform.worldToScreenCoordinates(
        this.gameView.cell(tile),
      );
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
