# OpenFront: Bronze Age Kingdoms — Design Brief

## Purpose

Extend OpenFront's simple, direct map strategy with slower territorial expansion, light kingdom development, resource management, and city sieges. Preserve the core interaction loop of claiming territory and using the click wheel to build or add units.

## Core Gameplay Loop

- Click a territory to conquer land.
- Use the click wheel to build or add units.
- Click an army to select it, then click a target to send it there.
- Armies capture land as they advance and can target cities, infrastructure, or land.
- Capturing cities increases influence nearby, helping expand and defend territory.
- The game progresses more slowly than current OpenFront.

## Influence and Borders

Cities generate influence within a radius. Higher city levels produce exponentially more influence.

- Strong positive influence helps hold land and expand borders.
- Medium influence has a weaker effect.
- Negative influence causes land to be gradually ceded.
- Capturing a city strengthens influence in the surrounding area.
- Pressing **Space** displays the influence overlay:
  - Green: strong positive influence
  - Yellow: medium influence
  - Red: weak or negative influence

## Armies and Sieges

Double-clicking a border deploys an army equal to **20% of troop capacity**, rather than instantly conquering the land.

Army orders use a two-click interaction:

1. Click an army to select it.
2. Click a target to send it there.

Valid targets:

- Enemy cities to besiege
- Infrastructure to attack
- Land to conquer
- Besieged friendly cities to defend

City siege protection increases exponentially with city level. A defense post adds further protection. Players can deploy armies to attack or defend during a siege.

Before deploying against an enemy that is **not a tribe**, show a confirmation prompt.

## Cities and Resources

Use OpenFront's existing **money resource allocation and payout behavior** as the model for assigning resources to land and structures. Apply the same allocation approach to food; science is earned at **one-quarter the rate**.

Resource bars:

- **Food** — supports city growth and upgrades.
- **Money** — pays for infrastructure.
- **Science** — unlocks upgrades.

More available food reduces the cost of upgrading a city. Farms produce food, and mines produce money. Higher money levels are tied to a slower rate of production or progress.

### Standard Resource Exchange Ratios

Use a simple **3:1 ratio** for market exchange:

- A market converts **3 food into 1 money**.
- A mine can use the same ratio in reverse: **3 money into 1 food**.

The interface should show the exchange ratio before resources are committed.

## Technology

- **Bronze weapons** — increases all unit strength by one-third.
- **Markets** — enables the 3:1 food and money exchange.
- **Third upgrade** — not yet defined.

## Land Types

| Land type | Food | Defense | Movement | Mine money | Distinctive role |
|---|---|---|---|---|---|
| Mountain | Low | High | Land capture is slower | High | Defensive, resource-rich terrain |
| Plains | Low | Medium | Fast troop movement | — | Good for moving armies |
| Desert | Low | Low | Fast | High | Fast expansion and mining |
| Lush | High | Low | Medium | — | Food production |
| Coast | Medium | Medium | Medium | Low | Naval access and port potential |
| Forest | Medium | High | Slow | — | Defensive terrain |

## Units and Structures

Keep **cities, ports, and warships**.

Remove **missile silos, nukes, MARVs, SAMs, and missile-object attacks**.

Warships are melee units and transports for land units. They can load and unload troops but do not fire missiles.

## Recommendations

- Keep land resource payouts on the same allocation model as OpenFront money, so food and science fit naturally into the existing system.
- Make the 3:1 exchange visible in the market interface before a player commits resources.
- Make coast valuable through ports and naval access, rather than giving it high bonuses to every land stat.
- Give army targeting clear visual feedback, such as a path preview and a marker on the selected target.
