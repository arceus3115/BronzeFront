import { TileRef } from "@openfront/engine-api/game/GameMap";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { vi, type Mock } from "vitest";
import {
  attackMenuElement,
  buildMenuElement,
  COLORS,
  MenuElementParams,
  rootMenuElement,
  Slot,
} from "../../../src/client/hud/layers/RadialMenuElements";
import { BuildUnitIntentEvent } from "../../../src/client/Transport";
import { GameView, PlayerView } from "../../../src/client/view";

vi.mock("../../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
}));
vi.mock("@openfront/engine-lib/Format", () => ({
  renderNumber: vi.fn((num: number) => num.toString()),
}));

vi.mock("../../../src/client/hud/layers/BuildMenu", async () => {
  const { UnitType } = await vi.importActual<
    typeof import("@openfront/engine-api/game/GameTypes")
  >("@openfront/engine-api/game/GameTypes");
  return {
    flattenedBuildTable: [
      {
        unitType: UnitType.City,
        key: "unit_type.city",
        description: "unit_type.city_desc",
        icon: "city-icon",
        countable: true,
      },
      {
        unitType: UnitType.Mine,
        key: "unit_type.factory",
        description: "unit_type.factory_desc",
        icon: "factory-icon",
        countable: true,
      },
      {
        unitType: UnitType.Warship,
        key: "unit_type.warship",
        description: "unit_type.warship_desc",
        icon: "warship-icon",
        countable: true,
      },
    ],
  };
});

vi.mock("nanoid", () => ({
  customAlphabet: vi.fn(() => vi.fn(() => "mock-id")),
}));

vi.mock("dompurify", () => ({
  __esModule: true,
  default: {
    sanitize: vi.fn((str: string) => str),
  },
}));

describe("RadialMenuElements", () => {
  let mockParams: MenuElementParams;
  let mockPlayer: PlayerView;
  let mockGame: GameView;
  let mockBuildMenu: any;
  let mockPlayerActions: any;
  let mockTile: TileRef;

  beforeEach(() => {
    mockPlayer = {
      id: () => 1,
      isAlliedWith: vi.fn(() => false),
      isPlayer: vi.fn(() => true),
      isTraitor: vi.fn(() => false),
      isDisconnected: vi.fn(() => false),
    } as unknown as PlayerView;

    mockGame = {
      inSpawnPhase: vi.fn(() => false),
      owner: vi.fn(() => mockPlayer),
      isLand: vi.fn(() => true),
      config: vi.fn(() => ({
        theme: () => ({
          territoryColor: () => ({
            lighten: () => ({ alpha: () => ({ toRgbString: () => "#fff" }) }),
          }),
        }),
        isUnitDisabled: vi.fn(() => false),
      })),
    } as unknown as GameView;

    mockBuildMenu = {
      canBuildOrUpgrade: vi.fn(() => true),
      cost: vi.fn(() => 100),
      count: vi.fn(() => 5),
    };

    mockPlayerActions = {
      buildableUnits: [
        { type: UnitType.City, canBuild: true, canUpgrade: false, cost: 100n },
        {
          type: UnitType.Mine,
          canBuild: true,
          canUpgrade: false,
          cost: 100n,
        },
        {
          type: UnitType.Warship,
          canBuild: true,
          canUpgrade: false,
          cost: 100n,
        },
        {
          type: UnitType.TransportShip,
          canBuild: true,
          canUpgrade: false,
          cost: 100n,
        },
      ],
      canAttack: true,
      interaction: {
        canSendAllianceRequest: true,
        canBreakAlliance: false,
        canDonateTroops: true,
        canDonateGold: true,
      },
    };

    mockTile = {} as TileRef;

    mockParams = {
      myPlayer: mockPlayer,
      selected: mockPlayer,
      tile: mockTile,
      playerActions: mockPlayerActions,
      game: mockGame,
      buildMenu: mockBuildMenu,
      emojiTable: {} as any,
      playerActionHandler: {} as any,
      playerPanel: {} as any,
      chatIntegration: {} as any,
      eventBus: { emit: vi.fn() } as any,
      closeMenu: vi.fn(),
    };
  });

  describe("attackMenuElement", () => {
    it("should have correct basic properties", () => {
      expect(attackMenuElement.id).toBe(Slot.Attack);
      expect(attackMenuElement.name).toBe("radial_attack");
      expect(attackMenuElement.icon).toBeDefined();
      expect(attackMenuElement.color).toBe(COLORS.attack);
    });

    it("should be disabled during spawn phase", () => {
      mockGame.inSpawnPhase = vi.fn(() => true);
      expect(attackMenuElement.disabled(mockParams)).toBe(true);
    });

    it("should be enabled when not in spawn phase", () => {
      mockGame.inSpawnPhase = vi.fn(() => false);
      expect(attackMenuElement.disabled(mockParams)).toBe(false);
    });

    it("should return attack submenu with attack units only", () => {
      const enemyPlayer = {
        id: () => 2,
        isPlayer: vi.fn(() => true),
      } as unknown as PlayerView;
      mockParams.selected = enemyPlayer;

      const subMenu = attackMenuElement.subMenu!(mockParams);

      expect(subMenu).toBeDefined();
      expect(subMenu.length).toBeGreaterThan(0);

      const attackUnitTypes = [UnitType.Warship];
      const returnedUnitTypes = subMenu.map((item) => {
        const unitTypeStr = item.id.replace("attack_", "");
        return Object.values(UnitType).find(
          (type) => type.toString() === unitTypeStr,
        );
      });

      returnedUnitTypes.forEach((unitType) => {
        expect(attackUnitTypes).toContain(unitType);
      });
    });

    it("should not include construction units in attack menu", () => {
      const enemyPlayer = {
        id: () => 2,
        isPlayer: vi.fn(() => true),
      } as unknown as PlayerView;
      mockParams.selected = enemyPlayer;

      const subMenu = attackMenuElement.subMenu!(mockParams);

      const constructionUnitTypes = [UnitType.City, UnitType.Mine];
      const returnedUnitTypes = subMenu.map((item) => {
        const unitTypeStr = item.id.replace("attack_", "");
        return Object.values(UnitType).find(
          (type) => type.toString() === unitTypeStr,
        );
      });

      constructionUnitTypes.forEach((unitType) => {
        expect(returnedUnitTypes).not.toContain(unitType);
      });
    });

    it("should handle undefined params in submenu", () => {
      const subMenu = attackMenuElement.subMenu!(undefined as any);
      expect(subMenu).toEqual([]);
    });
  });

  describe("buildMenuElement", () => {
    it("should have correct basic properties", () => {
      expect(buildMenuElement.id).toBe(Slot.Build);
      expect(buildMenuElement.name).toBe("build");
      expect(buildMenuElement.icon).toBeDefined();
      expect(buildMenuElement.color).toBe(COLORS.build);
    });

    it("should be disabled during spawn phase", () => {
      mockGame.inSpawnPhase = vi.fn(() => true);
      expect(buildMenuElement.disabled(mockParams)).toBe(true);
    });

    it("should be enabled when not in spawn phase", () => {
      mockGame.inSpawnPhase = vi.fn(() => false);
      expect(buildMenuElement.disabled(mockParams)).toBe(false);
    });

    it("should return build submenu with construction units only", () => {
      const subMenu = buildMenuElement.subMenu!(mockParams);

      expect(subMenu).toBeDefined();
      expect(subMenu.length).toBeGreaterThan(0);

      const constructionUnitTypes = [UnitType.City, UnitType.Mine];
      const returnedUnitTypes = subMenu.map((item) => {
        const unitTypeStr = item.id.replace("build_", "");
        return Object.values(UnitType).find(
          (type) => type.toString() === unitTypeStr,
        );
      });

      returnedUnitTypes.forEach((unitType) => {
        expect(constructionUnitTypes).toContain(unitType);
      });
    });

    it("should not include attack units in build menu", () => {
      const subMenu = buildMenuElement.subMenu!(mockParams);

      const attackUnitTypes = [UnitType.Warship];
      const returnedUnitTypes = subMenu.map((item) => {
        const unitTypeStr = item.id.replace("build_", "");
        return Object.values(UnitType).find(
          (type) => type.toString() === unitTypeStr,
        );
      });

      attackUnitTypes.forEach((unitType) => {
        expect(returnedUnitTypes).not.toContain(unitType);
      });
    });

    it("should handle undefined params in submenu", () => {
      const subMenu = buildMenuElement.subMenu!(undefined as any);
      expect(subMenu).toEqual([]);
    });
  });

  describe("rootMenuElement", () => {
    it("should have correct basic properties", () => {
      expect(rootMenuElement.id).toBe("root");
      expect(rootMenuElement.name).toBe("root");
      expect(rootMenuElement.disabled(mockParams)).toBe(false);
    });

    it("should show build and delete menu on own territory", () => {
      const subMenu = rootMenuElement.subMenu!(mockParams);
      const buildMenu = subMenu.find((item) => item.id === Slot.Build);
      const attackMenu = subMenu.find((item) => item.id === Slot.Attack);
      const deleteMenu = subMenu.find((item) => item.id === Slot.Delete);

      expect(buildMenu).toBeDefined();
      expect(attackMenu).toBeUndefined();
      expect(deleteMenu).toBeDefined();
    });

    it("should show the attack menu on enemy territory", () => {
      const enemyPlayer = {
        id: () => 2,
        isPlayer: vi.fn(() => true),
      } as unknown as PlayerView;
      mockGame.owner = vi.fn(() => enemyPlayer);

      const subMenu = rootMenuElement.subMenu!(mockParams);
      const buildMenu = subMenu.find((item) => item.id === Slot.Build);
      const attackMenu = subMenu.find((item) => item.id === Slot.Attack);
      const boatMenu = subMenu.find((item) => item.id === Slot.Boat);

      expect(attackMenu).toBeDefined();
      expect(buildMenu).toBeUndefined();
      expect(boatMenu).toBeUndefined();
    });

    it("should include info menu in both cases", () => {
      const subMenu = rootMenuElement.subMenu!(mockParams);
      const infoMenu = subMenu.find((item) => item.id === Slot.Info);

      expect(infoMenu).toBeDefined();
    });

    it("should handle ally menu correctly", () => {
      const allyPlayer = {
        id: () => 2,
        isAlliedWith: vi.fn(() => true),
        isPlayer: vi.fn(() => true),
        isTraitor: vi.fn(() => false),
        isDisconnected: vi.fn(() => false),
      } as unknown as PlayerView;
      mockParams.selected = allyPlayer;
      mockGame.owner = vi.fn(() => allyPlayer);

      const subMenu = rootMenuElement.subMenu!(mockParams);
      const allyMenu = subMenu.find((item) => item.id === "ally_break");

      expect(allyMenu).toBeDefined();
    });

    it("should show extend element when inAllianceExtensionWindow is true", () => {
      const allyPlayer = {
        id: () => 2,
        isAlliedWith: vi.fn(() => true),
        isPlayer: vi.fn(() => true),
      } as unknown as PlayerView;
      mockParams.selected = allyPlayer;
      mockGame.owner = vi.fn(() => allyPlayer);
      mockPlayerActions.interaction = {
        ...mockPlayerActions.interaction,
        canBreakAlliance: true,
        allianceInfo: {
          expiresAt: 100,
          inExtensionWindow: true,
          myPlayerAgreedToExtend: true,
          otherAgreedToExtend: false,
          canExtend: false,
        },
      };

      const subMenu = rootMenuElement.subMenu!(mockParams);
      const extendMenu = subMenu.find((item) => item.id === "ally_extend");

      expect(extendMenu).toBeDefined();
    });

    it("should not show extend element when inAllianceExtensionWindow is false", () => {
      const allyPlayer = {
        id: () => 2,
        isAlliedWith: vi.fn(() => true),
        isPlayer: vi.fn(() => true),
      } as unknown as PlayerView;
      mockParams.selected = allyPlayer;
      mockGame.owner = vi.fn(() => allyPlayer);
      mockPlayerActions.interaction = {
        ...mockPlayerActions.interaction,
        canBreakAlliance: true,
        allianceInfo: {
          expiresAt: 100,
          inExtensionWindow: false,
          myPlayerAgreedToExtend: false,
          otherAgreedToExtend: false,
          canExtend: false,
        },
      };

      const subMenu = rootMenuElement.subMenu!(mockParams);
      const extendMenu = subMenu.find((item) => item.id === "ally_extend");

      expect(extendMenu).toBeUndefined();
    });

    it("should show extend element as disabled when canExtend is false", () => {
      const allyPlayer = {
        id: () => 2,
        isAlliedWith: vi.fn(() => true),
        isPlayer: vi.fn(() => true),
      } as unknown as PlayerView;
      mockParams.selected = allyPlayer;
      mockGame.owner = vi.fn(() => allyPlayer);
      mockPlayerActions.interaction = {
        ...mockPlayerActions.interaction,
        canBreakAlliance: true,
        allianceInfo: {
          expiresAt: 100,
          inExtensionWindow: true,
          myPlayerAgreedToExtend: true,
          otherAgreedToExtend: false,
          canExtend: false,
        },
      };

      const subMenu = rootMenuElement.subMenu!(mockParams);
      const extendMenu = subMenu.find((item) => item.id === "ally_extend");

      expect(extendMenu).toBeDefined();
      expect(extendMenu!.disabled(mockParams)).toBe(true);
    });

    it("should show extend element as enabled when canExtend is true", () => {
      const allyPlayer = {
        id: () => 2,
        isAlliedWith: vi.fn(() => true),
        isPlayer: vi.fn(() => true),
      } as unknown as PlayerView;
      mockParams.selected = allyPlayer;
      mockGame.owner = vi.fn(() => allyPlayer);
      mockPlayerActions.interaction = {
        ...mockPlayerActions.interaction,
        canBreakAlliance: true,
        allianceInfo: {
          expiresAt: 100,
          inExtensionWindow: true,
          myPlayerAgreedToExtend: false,
          otherAgreedToExtend: false,
          canExtend: true,
        },
      };

      const subMenu = rootMenuElement.subMenu!(mockParams);
      const extendMenu = subMenu.find((item) => item.id === "ally_extend");

      expect(extendMenu).toBeDefined();
      expect(extendMenu!.disabled(mockParams)).toBe(false);
    });
  });

  describe("Menu element actions", () => {
    it("should execute build action correctly", () => {
      const subMenu = buildMenuElement.subMenu!(mockParams);
      const cityElement = subMenu.find((item) => item.id === "build_City");

      expect(cityElement).toBeDefined();
      expect(cityElement!.action).toBeDefined();

      if (cityElement!.action) {
        cityElement!.action(mockParams);
        expect(mockParams.eventBus.emit).toHaveBeenCalledWith(
          expect.any(BuildUnitIntentEvent),
        );
        expect(mockParams.closeMenu).toHaveBeenCalled();
      }
    });

    it("should execute attack action correctly", () => {
      const enemyPlayer = {
        id: () => 2,
        isPlayer: vi.fn(() => true),
      } as unknown as PlayerView;
      mockParams.selected = enemyPlayer;

      const subMenu = attackMenuElement.subMenu!(mockParams);

      const warshipElement = subMenu.find(
        (item) => item.id === "attack_Warship",
      );

      expect(warshipElement).toBeDefined();
      expect(warshipElement!.action).toBeDefined();

      if (warshipElement!.action) {
        warshipElement!.action(mockParams);
        expect(mockParams.eventBus.emit).toHaveBeenCalledWith(
          expect.any(BuildUnitIntentEvent),
        );
        expect(mockParams.closeMenu).toHaveBeenCalled();
      }
    });

    it("should not execute action when buildable unit is not found", () => {
      mockPlayerActions.buildableUnits = [];
      mockBuildMenu.canBuildOrUpgrade = vi.fn(() => false);

      const subMenu = buildMenuElement.subMenu!(mockParams);
      const cityElement = subMenu.find((item) => item.id === "build_City");

      if (cityElement!.action) {
        cityElement!.action(mockParams);
        expect(mockParams.eventBus.emit).not.toHaveBeenCalled();
        expect(mockParams.closeMenu).not.toHaveBeenCalled();
      }
    });

    it("offers x1 plus the largest affordable bulk amount", () => {
      mockPlayerActions.buildableUnits = [
        {
          type: UnitType.City,
          canBuild: true,
          canUpgrade: 123,
          cost: 100n,
          upgradeCosts: [100n, 250n, 450n, 700n, 1000n],
        },
      ];

      const subMenu = buildMenuElement.subMenu!(mockParams);
      const cityElement = subMenu.find((item) => item.id === "build_City");

      // Only x1 affordable: no submenu — the click upgrades x1 directly.
      (mockGame as any).myPlayer = vi.fn(() => ({ gold: () => 249n }));
      expect(cityElement!.subMenu!(mockParams)).toHaveLength(0);

      // 999 covers four upgrades: always the fixed x1/x5/x10/xMax slots,
      // with unexecutable steps disabled and the max slot at x4.
      (mockGame as any).myPlayer = vi.fn(() => ({ gold: () => 999n }));
      let options = cityElement!.subMenu!(mockParams);
      expect(options.map((o) => o.id)).toEqual([
        `upgrade_${UnitType.City}_1`,
        `upgrade_${UnitType.City}_5`,
        `upgrade_${UnitType.City}_10`,
        `upgrade_${UnitType.City}_max`,
      ]);
      expect(options.map((o) => o.disabled(mockParams))).toEqual([
        false,
        true,
        true,
        false,
      ]);
      options[3].action!(mockParams);
      expect(mockParams.eventBus.emit).toHaveBeenLastCalledWith(
        expect.objectContaining({ amount: 4 }),
      );

      // The full x5 total: the x5 slot becomes executable.
      (mockGame as any).myPlayer = vi.fn(() => ({ gold: () => 1000n }));
      options = cityElement!.subMenu!(mockParams);
      expect(options.map((o) => o.disabled(mockParams))).toEqual([
        false,
        false,
        true,
        false,
      ]);
    });
  });

  describe("Menu element tooltips", () => {
    it("should generate correct tooltip items for build elements", () => {
      const subMenu = buildMenuElement.subMenu!(mockParams);
      const cityElement = subMenu.find((item) => item.id === "build_City");

      expect(cityElement!.tooltipItems).toBeDefined();
      expect(cityElement!.tooltipItems!.length).toBeGreaterThan(0);

      const tooltipTexts = cityElement!.tooltipItems!.map((item) => item.text);
      expect(tooltipTexts).toContain("unit_type.city");
      expect(tooltipTexts).toContain("unit_type.city_desc");
      expect(tooltipTexts.some((text) => text.includes("100"))).toBe(true);
      expect(tooltipTexts.some((text) => text.includes("5x"))).toBe(true);
    });

    it("should generate correct tooltip items for attack elements", () => {
      const enemyPlayer = {
        id: () => 2,
        isPlayer: vi.fn(() => true),
      } as unknown as PlayerView;
      mockParams.selected = enemyPlayer;

      const subMenu = attackMenuElement.subMenu!(mockParams);
      const warshipElement = subMenu.find(
        (item) => item.id === "attack_Warship",
      );

      expect(warshipElement!.tooltipItems).toBeDefined();
      expect(warshipElement!.tooltipItems!.length).toBeGreaterThan(0);

      const tooltipTexts = warshipElement!.tooltipItems!.map(
        (item) => item.text,
      );
      expect(tooltipTexts).toContain("unit_type.warship");
      expect(tooltipTexts).toContain("unit_type.warship_desc");
      expect(tooltipTexts.some((text) => text.includes("100"))).toBe(true);
    });
  });

  describe("Menu element colors", () => {
    it("should use correct colors for build elements", () => {
      const subMenu = buildMenuElement.subMenu!(mockParams);
      const cityElement = subMenu.find((item) => item.id === "build_City");

      expect(
        (cityElement!.color as (params: MenuElementParams) => string)(
          mockParams,
        ),
      ).toBe(COLORS.building);
    });

    it("should use correct colors for attack elements", () => {
      const enemyPlayer = {
        id: () => 2,
        isPlayer: vi.fn(() => true),
      } as unknown as PlayerView;
      mockParams.selected = enemyPlayer;

      const subMenu = attackMenuElement.subMenu!(mockParams);
      const warshipElement = subMenu.find(
        (item) => item.id === "attack_Warship",
      );

      expect(
        (warshipElement!.color as (params: MenuElementParams) => string)(
          mockParams,
        ),
      ).toBe(COLORS.attack);
    });

    it("should use disabled color when element is disabled", () => {
      mockBuildMenu.canBuildOrUpgrade = vi.fn(() => false);

      const subMenu = buildMenuElement.subMenu!(mockParams);
      const cityElement = subMenu.find((item) => item.id === "build_City");

      expect(
        (cityElement!.color as (params: MenuElementParams) => string)(
          mockParams,
        ),
      ).toBe(COLORS.building);
    });
  });

  describe("Translation integration", () => {
    it("should use translateText for tooltip items in build menu", async () => {
      const { translateText } = await vi.importMock<
        typeof import("../../../src/client/Utils")
      >("../../../src/client/Utils");

      (translateText as Mock).mockClear();

      buildMenuElement.subMenu!(mockParams);

      expect(translateText).toHaveBeenCalledWith("unit_type.city");
      expect(translateText).toHaveBeenCalledWith("unit_type.city_desc");
      expect(translateText).toHaveBeenCalledWith("unit_type.factory");
      expect(translateText).toHaveBeenCalledWith("unit_type.factory_desc");
    });

    it("should use translateText for tooltip items in attack menu", async () => {
      const { translateText } = await vi.importMock<
        typeof import("../../../src/client/Utils")
      >("../../../src/client/Utils");

      (translateText as Mock).mockClear();

      const enemyPlayer = {
        id: () => 2,
        isPlayer: vi.fn(() => true),
      } as unknown as PlayerView;
      mockParams.selected = enemyPlayer;

      attackMenuElement.subMenu!(mockParams);

      expect(translateText).toHaveBeenCalledWith("unit_type.warship");
      expect(translateText).toHaveBeenCalledWith("unit_type.warship_desc");
    });
  });
});
