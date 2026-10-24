// @vitest-environment jsdom
import type { PublicGames } from "@openfront/shared/WireSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEnv } from "../src/client/ClientEnv";

// The component opens a public-lobby WebSocket the moment it connects. jsdom
// has no WebSocket worth talking to and this test is about the gate, not the
// lobby list, so the socket is a no-op -- except for retaining the update
// callback the real socket would drive off the wire. Without that, `lobbies`
// never leaves `null`, no public-lobby card ever renders, and
// `validateAndJoin` -- one of the four gated entry points -- goes untested by
// this whole file.
const { lobbiesCallbackRef } = vi.hoisted(() => ({
  lobbiesCallbackRef: { current: null as ((g: PublicGames) => void) | null },
}));

vi.mock("../src/client/LobbySocket", () => ({
  PublicLobbySocket: class {
    constructor(onUpdate: (g: PublicGames) => void) {
      lobbiesCallbackRef.current = onUpdate;
    }
    start(): void {}
    stop(): void {}
  },
}));

// The lobby modals load on demand; the stubs below stand in for loaded ones.
vi.mock("../src/client/LazyModals", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/client/LazyModals")>()),
  whenModalLoaded: (_tag: string, open: () => void) => open(),
}));

// Registers <game-mode-selector> as a side effect.
import "../src/client/GameModeSelector";

/**
 * The pure predicate is covered in GameModeSelectorGating.test.ts. What that
 * cannot see is whether the predicate is actually CONSULTED at each entry
 * point -- a call site that forgets to ask still passes every unit test while
 * letting a stale client into a multiplayer game. So this mounts the real
 * component, drives it into a gated state through the real
 * `desktop-update-state` event the shell bridge dispatches, clicks the real
 * buttons, and asserts nothing proceeded.
 */
let selector: HTMLElement & { updateComplete: Promise<unknown> };
let joinOpen: ReturnType<typeof vi.fn>;
let hostOpen: ReturnType<typeof vi.fn>;
let wiggle: ReturnType<typeof vi.fn>;
let joinLobby: ReturnType<typeof vi.fn>;

function stub(tag: string, methods: Record<string, unknown>): void {
  const el = document.createElement(tag);
  Object.assign(el, methods);
  document.body.appendChild(el);
}

/** Clicks every button the selector renders. Returns how many it clicked. */
function clickEveryButton(): number {
  const buttons = Array.from(selector.querySelectorAll("button"));
  for (const button of buttons) button.click();
  return buttons.length;
}

beforeEach(async () => {
  // connectedCallback reads ClientEnv.gameCreationRate(), which throws without
  // the config the server normally injects into index.html.
  window.BOOTSTRAP_CONFIG = {
    gameEnv: "dev",
    numWorkers: 1,
    turnstileSiteKey: "",
    jwtAudience: "test",
    instanceId: "test",
    gitCommit: "test",
  };
  ClientEnv.reset();

  joinOpen = vi.fn();
  hostOpen = vi.fn();
  wiggle = vi.fn();
  joinLobby = vi.fn();
  stub("join-lobby-modal", { open: joinOpen });
  stub("host-lobby-modal", { open: hostOpen });
  stub("single-player-modal", { open: vi.fn() });
  stub("desktop-status-bar", { wiggle });
  (window as { showPage?: (id: string) => void }).showPage = vi.fn();
  // validateAndJoin dispatches "join-lobby" as a bubbling/composed CustomEvent
  // rather than calling a modal's open() -- catch it at the document the same
  // way Main.ts's real listener would.
  document.addEventListener("join-lobby", joinLobby as EventListener);

  lobbiesCallbackRef.current = null;
  selector = document.createElement("game-mode-selector") as HTMLElement & {
    updateComplete: Promise<unknown>;
  };
  document.body.appendChild(selector);
  await selector.updateComplete;
});

afterEach(() => {
  document.removeEventListener("join-lobby", joinLobby as EventListener);
  document.body.innerHTML = "";
  window.BOOTSTRAP_CONFIG = undefined;
  ClientEnv.reset();
  vi.restoreAllMocks();
});

describe("the home screen offers solo only", () => {
  it("opens single player and never a lobby", async () => {
    const solo = vi.fn();
    (
      document.querySelector("single-player-modal") as HTMLElement & {
        open: unknown;
      }
    ).open = solo;

    expect(selector.querySelector("h2")).toBeNull();
    expect(selector.querySelector("button.group")).toBeNull();
    expect(clickEveryButton()).toBe(1);
    expect(solo).toHaveBeenCalled();
    expect(joinOpen).not.toHaveBeenCalled();
    expect(hostOpen).not.toHaveBeenCalled();
    expect(window.showPage).not.toHaveBeenCalled();
  });
});
