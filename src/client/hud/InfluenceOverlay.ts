import { UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  INFLUENCE_RADIUS,
  influenceStrength,
} from "@openfront/engine-lib/game/BronzeRules";
import { TransformHandler } from "../TransformHandler";
import { GameView } from "../view/GameView";

/**
 * Colors the local player's border tiles: green when their cities outweigh
 * every neighbor, yellow when they lead by less, red when they do not.
 */
export class InfluenceOverlay {
  private canvas: HTMLCanvasElement | null = null;
  private shown = false;
  private borders: ReadonlySet<number> = new Set();
  private refreshing = false;

  constructor(
    private readonly gameView: GameView,
    private readonly transform: TransformHandler,
    parent: HTMLElement,
  ) {
    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "4";
    parent.appendChild(canvas);
    this.canvas = canvas;
  }

  toggle(): void {
    this.shown = !this.shown;
    if (!this.shown) this.clear();
    else void this.refresh();
  }

  private async refresh(): Promise<void> {
    if (this.refreshing) return;
    const me = this.gameView.myPlayer();
    if (me === null) return;
    this.refreshing = true;
    try {
      this.borders = (await me.borderTiles()).borderTiles;
    } finally {
      this.refreshing = false;
    }
  }

  draw(): void {
    const canvas = this.canvas;
    if (canvas === null || !this.shown) return;
    const parent = canvas.parentElement;
    if (parent === null) return;
    const width = parent.clientWidth;
    const height = parent.clientHeight;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    ctx.clearRect(0, 0, width, height);
    const me = this.gameView.myPlayer();
    if (me === null) return;
    const cities = this.gameView.units(UnitType.City);
    const limit = INFLUENCE_RADIUS * INFLUENCE_RADIUS;
    if (this.borders.size === 0 && !this.refreshing) void this.refresh();
    for (const tile of this.borders) {
      const totals = new Map<number, number>();
      for (const city of cities) {
        if (!city.isActive()) continue;
        const dx = this.gameView.x(city.tile()) - this.gameView.x(tile);
        const dy = this.gameView.y(city.tile()) - this.gameView.y(tile);
        if (dx * dx + dy * dy > limit) continue;
        const id = city.owner().smallID();
        totals.set(id, (totals.get(id) ?? 0) + influenceStrength(city.level()));
      }
      const own = totals.get(me.smallID()) ?? 0;
      let bestOther = 0;
      for (const [id, value] of totals) {
        if (id !== me.smallID() && value > bestOther) bestOther = value;
      }
      const screen = this.transform.worldToScreenCoordinates(
        this.gameView.cell(tile),
      );
      ctx.fillStyle =
        own > 0 && own >= bestOther * 2
          ? "rgba(34,197,94,0.55)"
          : bestOther > own
            ? "rgba(239,68,68,0.55)"
            : "rgba(234,179,8,0.55)";
      ctx.fillRect(screen.x - 4, screen.y - 4, 8, 8);
    }
  }

  private clear(): void {
    const canvas = this.canvas;
    if (canvas === null) return;
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  }
}
