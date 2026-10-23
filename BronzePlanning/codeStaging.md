# BronzeFront code staging

What to remove and what to change so the sim matches [BronzeFront.md](BronzeFront.md).

**Remove now** and **Change now** are decided, from the brief and the answers below. **Still open** is the short list of formulas those answers did not settle.

Engine changes ship with tests. New curves use `DetMath` and the seeded RNG. New player-facing strings go in `resources/lang/en.json` only.

Removing unit types, nuke fields, and player stats is a wire and snapshot break. Old replays and saved games will not load. That is expected for this version.

---

## Remove now

### Missile units and the doomsday clock

The brief removes missile silos, nukes, MARVs, SAMs, and missile-object attacks. The doomsday clock only exists to score nuke exchanges, so it goes out with them.

Delete these unit types from `packages/engine-api/src/game/GameTypes.ts`, and the groups that exist only to hold them (`Nukes`, and the nuke entries in `BuildableAttacks`):

- `AtomBomb`, `HydrogenBomb`, `MIRV`, `MIRVWarhead`
- `MissileSilo`, `SAMLauncher`, `SAMMissile`
- `Shell`

Delete the executions and nation brains that only serve that stack:

- `packages/engine/src/execution/NukeExecution.ts`
- `packages/engine/src/execution/MIRVExecution.ts`
- `packages/engine/src/execution/SAMMissileExecution.ts`
- `packages/engine/src/execution/SAMLauncherExecution.ts`
- `packages/engine/src/execution/MissileSiloExecution.ts`
- `packages/engine/src/execution/ShellExecution.ts`
- `packages/engine/src/execution/DoomsdayClockExecution.ts`
- `packages/engine/src/execution/nation/NationNukeBehavior.ts`
- `packages/engine/src/execution/nation/NationNukePlanning.ts`
- `packages/engine/src/execution/nation/NationMIRVBehavior.ts`
- `packages/engine-lib/src/game/DoomsdayClock.ts`
- `packages/engine-lib/src/execution/NukeAlliance.ts`

Strip the matching config and schema surface:

- Nuke, SAM, and doomsday methods on `packages/engine-lib/src/configuration/Config.ts` and `packages/engine/src/configuration/EngineConfig.ts` (`nukeMagnitudes`, `nukeSpeed`, `samRange`, `nukeAllianceBreakThreshold`, `doomsdayClockConfig`, and the warship/defense-post shell rates)
- `doomsdayClock` and `isWaterNukes` on `packages/engine-api/src/Schemas.ts`
- Nuke, SAM, shell, and doomsday fields on `packages/engine-api/src/game/GameUpdates.ts` (`nukeState`, `packedNukeImpacts`, `missileTimerQueue`, `samUpgrade`, `inDoomsdayClock`, `markedDoomsdayClockTick`)
- Nuke abbreviations in `packages/engine-api/src/StatsSchemas.ts`
- `NationExecution` wiring for nuke and MIRV behavior

Strip the client:

- Build-menu entries and icons for atom bomb, hydrogen bomb, MIRV, missile silo, and SAM launcher in `src/client/hud/layers/BuildMenu.ts`
- Keybinds and `InputHandler` actions: `buildMissileSilo`, `buildSamLauncher`, `buildAtomBomb`, `buildHydrogenBomb`, `buildMIRV`
- Nuke-alliance safety slider in `src/client/UserSettingModal.ts`
- Tutorial steps for silo, atom bomb, hydrogen bomb, MIRV, and SAM in `src/client/hud/layers/TutorialPanel.ts`
- Nuke trajectory and telegraph passes, SAM radius pass, and their shaders under `src/client/render/gl/`
- `src/client/replay/ReplayNukedLayers.ts` and `src/client/components/DoomsdayClockPanel.ts`

Delete the tests and perf harnesses that only cover nukes, MIRV, SAMs, silos, shells, water nukes, and the doomsday clock. Leave map files such as `baikalnukewars` in place; drop nuke modifiers from their manifests when those fields leave the schema.

`disabledUnits` stays, with the deleted types removed from the enum. Tile fallout (`FALLOUT_BIT` on the map state) leaves with the nukes.

### Factories, trains, and trade ships

Decided: repurpose them. Do not delete this route.

- `Factory` is now `Farm` and `Mine`. A farm's depot delivers food. A mine's depot delivers money (the old train gold amount).
- The moving train is a `Depot`. `TrainType` and the rail graph (`Railroad`, `RailNetwork`) stay. Player-facing copy calls the links roads.
- Trade ships still launch from ports and still pay gold on arrival.

### Transport ships

Decided: warships load and unload troops. The separate transport goes away.

Delete `UnitType.TransportShip`, `TransportShipExecution.ts`, and `TransportShipUtils.ts`. The `boat` and `cancel_boat` intents go with them. `BoatRetreatExecution` is retargeted at a loaded warship, or deleted if nothing else calls it. `ExecutionManager` stops constructing transport executions.

Client paths that spawn or count transports come out: the boat send in `ClientGameRunner`, transport entries in `HoverHighlightController` and `PlayerInfoOverlay`, and `transportShipState` on `UnitUpdate`.

### Shell fire on units that stay

`WarshipExecution` currently launches `ShellExecution`. `DefensePostExecution` still stores shell-attack state; its shoot path is already commented out. Delete that state when the shell unit goes. Warship and defense-post behavior after that is under **Change now**.

---

## Change now

### Armies replace the border flood

Today a border click starts `AttackExecution`: troops drain and neighboring tiles flip to the attacker. The brief replaces that with an army.

- Double-click a border to deploy an army equal to **20% of troops on hand** (`player.troops() * 0.2`). The fraction is fixed. The attack-ratio slider and its hotkeys come out. `AttacksDisplay` becomes the army list.
- A single click on a border does not conquer land. Land changes when an army moves onto it, or when influence shifts the border. "Click a territory to conquer land" means sending an army onto that territory.
- Click the army, then click a target. Valid targets: enemy city (siege), infrastructure, land, or a friendly city that is already under siege (defend).
- The army captures land as it advances. Capture speed follows the land type (mountain capture is slower).
- Before the deploy, if the target owner is a nation or a human, show a confirmation. Tribe targets skip the prompt. Tribes stay.
- Show a path preview and a marker on the selected target.
- `NationAttackBehavior` and `TribeAttackBehavior` issue the same army orders. `NationExecution` drops its nuke call and keeps an attack call that creates armies.
- `cancel_attack` cancels an army order. The attack intent's payload becomes the deploy (owner, source border, troop count) or a new army intent. `outgoingAttacks` / `incomingAttacks` on `PlayerUpdate` describe armies.

Main files: `packages/engine/src/execution/AttackExecution.ts`, `src/client/ClientGameRunner.ts`, `src/client/InputHandler.ts`, `src/client/hud/layers/ControlPanel.ts`, `packages/engine/src/execution/nation/NationAttackBehavior.ts`, `packages/engine/src/execution/TribeAttackBehavior.ts`.

### Warships

Keep the unit, the port requirement, and `buildWarship`.

- Delete shell firing from `packages/engine/src/execution/WarshipExecution.ts`.
- Warships fight in melee.
- Warships load and unload land troops. This replaces `TransportShip`. Cargo state moves onto the warship update (`transportShipState` is removed with the transport unit).
- `NationWarshipBehavior` stops treating warships as a platform for nukes or shells. Spawn, move, melee, and troop carrying stay.
- `move_warship` stays. Melee range and how a hit lands are unspecified; see **Still open**.

### Defense posts

The siege section keeps them: a defense post adds further protection on top of the city's own defense. They stay on the build wheel (`buildDefensePost`).

- Remove the leftover shell fields on `DefensePostExecution`.
- The post contributes a siege-defense bonus. It no longer needs a target or a projectile.
- On tile capture, `PlayerExecution` currently deletes defense posts and captures every other structure. A city no longer flips just because an army entered its tile; see sieges below. Posts can still be removed when their tile is taken, unless an army order against infrastructure uses a different rule (open).

### Cities and sieges

Keep `City`, `CityExecution`, and `UpgradeStructureExecution`. City level already exists.

- Siege protection scales exponentially with city level. A defense post in range adds more. Coefficients are not in the brief.
- An army ordered onto an enemy city starts a siege. An army ordered onto a friendly city that is under siege defends it.
- Capturing the city strengthens influence in the surrounding area.
- A city upgrade is paid in food. Science unlocks technologies (bronze weapons and markets), and does not pay the city upgrade. The brief also says a larger food stock lowers the upgrade price. The shape of that discount is open.
- Higher city levels produce exponentially more influence.
- City level also changes money output. See the money curve under **Resources**.

A siege needs an end state (the city flips, or it is destroyed) and a comparison between army strength and defense. Those numbers are not in the brief.

### Influence and borders

New sim state. Cities emit influence inside a radius. Strength scales exponentially with city level.

- Strong positive influence holds land and expands the border.
- Medium influence has a weaker effect.
- Negative influence cedes land gradually.
- **Space** toggles an overlay: green (strong), yellow (medium), red (weak or negative). There is no Space bind in the client keybinds today; add one.
- Influence and armies both write tile ownership, through the same conquer and cede path (`PlayerImpl` / `GameImpl.conquer`).

Thresholds, radius, and the exponential curve are unspecified. Use `DetMath` when they are chosen.

### Resources

Money stays the current gold field (`gold`, `addGold`, `goldAdditionRate`). The HUD label becomes Money. Worker income today is a flat per-tick grant in `PlayerExecution` (100 for humans, 50 for bots, times `goldMultiplier`), plus conquest loot and donations. Trade-ship and train gold leave with those units. Income is not paid per tile.

The brief hangs food and science on that same per-tick payout:

- Add food and science next to gold on the player, the snapshot, and `PlayerUpdate` (and the worker quad in `GameImpl` that currently carries tiles, gold, and troops).
- Science per tick is one quarter of the money rate, using the same allocation.
- Farms and mines are new wheel buildings. A farm produces food. A mine produces money. Markets is a science unlock, not a building: it opens the exchange panel. The panel shows 3 food → 1 money before the player commits. A mine converts the other way, 3 money → 1 food.
- Land type still supplies a food yield and a mine-money yield on the same per-tick payout, added together with farm and mine output.
- Three resource bars in the HUD.
- `infiniteGold`, `goldMultiplier`, and `startingGold` are the pattern for the matching food and science modifiers.
- Mine level and city level each add their own money on a bell curve. The money added by the next level rises, peaks at a middle level, then falls. A mine's level does not scale a city's output, or the reverse. The flat worker grant stays. This curve does not reuse `troopIncreaseRate`. The level where the bell peaks, and its width, are tuning values. Use `DetMath`.

### Technology

Player research state, paid with science.

- **Bronze weapons** — multiply all unit strength by 4/3.
- **Markets** — enables the 3:1 exchange. The UI shows the ratio before the player commits. 3 food becomes 1 money. A mine can run the reverse, 3 money becomes 1 food.
- **Third upgrade** — not in this version. The brief leaves it undefined.

### Land types

Current terrain in `GameMapImpl` is an elevation byte: plains (magnitude &lt; 10), highland (&lt; 20), mountain, ocean, impassable. The brief's table replaces that set.

| Land type | Food | Defense | Movement | Mine money |
| --- | --- | --- | --- | --- |
| Mountain | Low | High | Land capture is slower | High |
| Plains | Low | Medium | Fast troop movement | — |
| Desert | Low | Low | Fast | High |
| Lush | High | Low | Medium | — |
| Coast | Medium | Medium | Medium | Low |
| Forest | Medium | High | Slow | — |

Coast stays valuable through ports and warship access. Its row stays at medium or low on every column.

Decided: maps gain a real biome layer, generated from the shoreline bit and the elevation magnitude, then stored. Gameplay reads the biome. Highland is retired. Ocean and impassable stay.

The terrain byte has no free bits (land, ocean, shoreline, and 5 bits of magnitude). Elevation and shoreline stay as generator inputs. The biome is a new per-tile channel written by the map generator into `map.bin`.

The generator assigns biomes from shoreline, elevation, and distance from water:

- Shoreline land below mountain elevation → Coast
- Magnitude ≥ 20 → Mountain, including a mountainous shore
- Magnitude 10–19 → Forest (this replaces highland)
- Low inland land near water → Lush
- Low inland land far from water → Desert
- Remaining low inland land → Plains

The near and far tile distances are tuning values. The categories are fixed.

Generate that layer for the World map only (`GameMapType.World`, `resources/maps/world`, generator source `map-generator/assets/maps/world`). Other preset maps stay in the repo and are not regenerated in this pass.

Mountain's row names capture speed, and forest's row names movement speed. Whether those are one stat or two is open.

### Pace

The game runs slower than current OpenFront. The knobs are `troopIncreaseRate`, `goldAdditionRate`, army move and capture speed, and structure construction duration. No factor is specified. Tune after armies exist, unless a factor is chosen first.

### Bots

The first playable is a single-player game, so the nation and tribe AI has to be able to play it. Updating them until the project compiles is not enough. On the World map a nation has to expand, build, fight, siege, and defend under the new rules, or the match has no opponent.

`NationExecution` keeps structure placement, alliances, emoji, warships, and the farm, mine, and depot route. It loses nuke and MIRV behavior. Trade ships stay. The non-tribe confirm is only for the human's own deploy.

What the AI has to do:

- Deploy armies at 20% of troops on hand, send them onto land, and siege or defend cities. `NationAttackBehavior` and `TribeAttackBehavior` stop using the tile flood.
- Build and upgrade cities, ports, defense posts, farms, and mines. The build order is already port, farm, mine. Later, pay for those with the new resources (city upgrades in food).
- Take bronze weapons and markets when it can use them. Use the 3:1 exchange instead of sitting on a useless stock of one resource.
- Sail warships as melee transports: load troops, cross water, unload, and fight ships that are camping the coast. `NationWarshipBehavior` drops shell and nuke assumptions.
- Tribes stay the early, weaker neighbors. They still attack with armies. They do not need the full economy.

`NationExecution` is the tick that wires this (`maybeAttack`, `handleStructures`, `maybeSpawnWarship`). Nuke and MIRV calls on that tick are deleted. Difficulty already exists on the single-player modal (`this.selectedDifficulty`) and stays the strength knob.

---

## First playable

Single player on the regular World map. That is the only match this pass has to run.

- Start from `SinglePlayerModal` with `gameType: GameType.Singleplayer`. It already defaults `selectedMap` to `GameMapType.World`. Lock this pass to that map at normal size. Compact World, Giant World Map, World Inverted, and every other entry in `Maps.gen.ts` are ignored: no biome generation, no balance pass, and the picker does not need to offer them yet.
- One human. The opponents are the nations baked into World (`defaultNationCount` 72, scaled by the nations slider) and the tribes that spawn on empty land.
- Multiplayer lobbies, public games, and team games are out of this pass. Leave their code in place.
- The AI bar is in **Bots**. A game on World should be playable against nations that expand and fight, not a map of idle spawn points.

## Add

These are new. They are listed here so the remove list is not read as the whole version.

- Army unit, selection, and a two-click order.
- Deploy confirmation when the enemy is not a tribe.
- Path preview and target marker.
- Influence field and the Space overlay.
- Food and science, and the 3:1 exchange panel unlocked by Markets.
- Bronze weapons and Markets.
- Farm and mine buildings on the click wheel.

---

## Leave in place

- Cities and ports, including port placement rules and `buildCity` / `buildPort`.
- The click wheel as the way to build and upgrade (`BuildMenu`, `UpgradeStructureExecution`).
- Tribes, nations, and humans. The deploy prompt depends on the tribe check.
- Alliances, embargoes, donate gold, donate troops, emoji, and quick chat.
- Win check by tiles owned. Influence and armies change who owns tiles; the win rule still reads tile counts.
- Gold as the sim identifier for money.
- Determinism boundaries in `tests/LayerBoundaries.test.ts`.

---

## Decided

- Factories and trains are repurposed as farms, mines, and road depots. Trade ships stay.
- Transport ships are removed. Warships carry troops.
- Biomes are a stored map layer generated from shoreline and elevation. Highland is retired.
- Farms and mines are wheel buildings. Markets is a science unlock for the 3:1 exchange. Mines convert 3 money into 1 food.
- An army deploys 20% of troops on hand. The attack-ratio slider is removed.
- A single border click does not conquer. Armies and influence change ownership.
- A city upgrade is paid in food. Science unlocks technologies.
- Biomes are assigned by the distance rule in **Land types**. Near and far distances are tuning values.
- Mine money and city money each follow a bell curve in that structure's own level. The peak level and the width are tuning values.
- The first playable is single player on the World map only. Other preset maps are ignored. Nation and tribe AI has to play the new rules well enough to be a real opponent.

## Still open

1. **Food price discount.** The upgrade is paid in food, and a larger food stock lowers that price. The discount shape is unspecified.

2. **Siege end, warship melee, pace.** A siege needs to say whether the city flips or is destroyed, and the defense curve. Melee needs a range and when the hit lands. Pace has no factor yet; it waits until one is named. The third technology stays out until it has a name.

3. **Mountain capture vs forest movement.** The land table names slower capture for mountain and slow movement for forest. Say whether capture speed and march speed are separate stats.
