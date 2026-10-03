# SteamForge: Game Design

## Pitch

SteamForge is a survival city builder in the spirit of Banished, set in a Victorian-steampunk world. You lead a few
families into untouched land and keep them alive. Citizens are the only real resource, winter is the main antagonist,
and steam is what turns a frontier camp into an industrial town.

## Backstory (`story.json`)

The Meridian Steam Company sends you north beyond the last railhead as Chief Engineer, with a handful of families and
Steamforge No. 9, a sealed pressure engine. Eleven forges went before yours; four still answer telegrams. The
**Brass Charter** (shown when a colony is founded) asks for a self-sufficient colony within the decade.

**Dispatches** from the Company's Board arrive on milestones: a research completed, a building finished, a year
reached or a population passed. Each trigger fires once. Dispatches appear as notices and are kept in the Dispatches
ledger. The charter counts as fulfilled when an Analytical Engine stands in the colony.

## Core loop

1. Gather: fell trees, clear boulders, forage, hunt and fish.
2. Build: lay out homes, storage and workplaces. Every site goes through clearing, then material delivery, then building.
3. Staff: assign professions in the Guild panel. Anyone without a job is a laborer.
4. Research: engineers at a Drafting Office unlock new buildings, roads, conduits and recipes.
5. Survive the seasons: crops grow from spring to autumn, and winter drains warmth and food.
6. Grow: couples need empty homes to marry and have children, and travellers sometimes arrive.
7. Industrialise:
   - smelt iron and copper
   - forge tools and machine cogs
   - pipe steam to workshops
   - turn steam into galvanic power

## Time

- 10 simulation ticks per game-second and 40 game-seconds per month, so one year is 8 minutes at ×1 and about
  48 seconds at ×10.
- Twelve months: Early, mid and Late Spring, then Summer, Autumn and Winter in the same pattern.
- Monthly base temperatures come from `rules.json`, with random jitter and cold snaps on top. Below the comfort
  temperature (8 °C), difficulty's `winterSeverity` multiplies the cold.
- Speeds are Pause, ×1, ×2, ×5 and ×10. Keys: Space toggles pause, 1–4 set speed. The game auto-pauses when the tab
  is hidden.

## Pause and build

Every command goes through `Simulation.perform` and is accepted while paused:

- place a building, a road, a conduit (steam pipe or copper conduit), a field (drag to size), or a clearing mark
- choose or clear research
- demolish, cancel a site, or prioritise a site
- set workers, builders, production limits, and building options (crop or recipe)

A placed building is a site. Its stages are:

1. **Clearing**: laborers remove features in the footprint and get their yield.
2. **Building**: laborers haul materials from storage while builders add work. Progress can never exceed the fraction
   of materials delivered.

Prioritised sites are served first. Cancelling refunds the delivered materials. Demolishing returns half the cost.

## Citizens

- **Needs**:
  - Hunger: they eat a meal of mixed foods from their home pantry or straight from storage.
  - Warmth: lost outdoors in the cold, more slowly with a coat, and regained in a heated home or the Steamforge shelter.
  - Health: drops while starving, freezing or sick, and recovers faster with a varied diet.
  - Happiness: affects work speed and birth chance.
- **Gear**: tools wear out over about 30 months and coats over about 36 (scaled by `wearRate`). Working without tools
  runs at 55% speed.
- **Households**: one family per house. An empty house goes, in order of preference, to:
  1. a homeless couple
  2. a homeless adult
  3. a couple still living with their parents
  4. two unrelated single adults, who marry

  Children follow their parents. Homeless adults shelter in the Steamforge. Births happen in houses with a couple and a
  free bed.
- **Aging**: children become laborers at 12, can marry from 16, and become elders at 58 (slower). Death from old age
  grows likely towards 85.
- **Task AI**, in priority order:
  1. urgent needs
  2. collecting tools or coats
  3. stocking the home pantry and firewood
  4. the job (workplace or builder)
  5. labour: supply sites, service buildings (keep the Steamforge fuelled), clear land, haul goods
  6. idle

  Tasks are plain data (steps plus reservations), so they serialize.

## Economy

All values live in content JSON.

| Chain | Buildings |
|---|---|
| Logs → firewood | Forester's Lodge (fells and replants), Woodcutter's Shed, Steam Sawmill (needs steam) |
| Food | Forager's Hut (berries, mushrooms; seasonal), Hunter's Lodge (scales with nearby forest), Fishing Dock (needs shore), Crop Field (potatoes, cabbage, barley), Steam Glasshouse (tomatoes all year; needs steam) |
| Stone / ore / coal | Quarry, Iron Mine, Coal Pit and Copper Mine, each placed over a matching seam |
| Metal → tools / cogs | Smelter (ore + coal → iron or copper), Arc Furnace (ore → twice the metal; needs power), Toolworks (iron + logs), Machine Works (iron → cogs; needs steam) |
| Leather → coats | Hunter's Lodge byproduct → Tailor's Shop |
| Energy | Steamforge, Boiler House, Galvanic Dynamo (see below) |
| Research | Drafting Office, Analytical Engine (needs power) |
| Storage | Steamforge (all goods), Stockyard (materials, fuel), Warehouse (food, goods) |
| Housing | Settler's Cottage, Brick Rowhouse, Steam Tenement (steam radiators replace firewood) |
| Safety | Pump Well (radius 14) and Steam Fire Station (radius 24, puts fires out in seconds; needs steam). Otherwise a burning building is lost and the fire spreads |

## The Steamforge

The headquarters (`"headquarters": true` in `buildings.json`; exactly one) is placed at founding and can neither be
demolished nor burn. It stores all goods, shelters the homeless and is a small steam generator: it burns coal, or
firewood if it has no coal, from its own stores, and laborers top it up from other storage. Workshops built against
its walls get its steam without any pipes.

## Energy networks

Networks are data (`rules.json` → `networks`): **Steam** (psi), carried by riveted steam pipes, and **Galvanic
Power** (volts), carried by copper conduits. Builders lay conduits like roads; they cost materials per tile, run over
roads and stay walkable.

- A **grid** is a connected group of conduit tiles plus every participating building they touch. Buildings also
  connect through their own footprint, so neighbouring buildings need no pipe between them.
- **Generators** (`generator` component) supply energy while lit: the Steamforge (12 psi), the Boiler House (40 psi;
  coal and a stoker) and the Galvanic Dynamo (30 volts, drawn from 20 psi of steam). Fuel burns with grid load, and
  an idle generator banks its fire to a quarter.
- **Consumers** (`consumer` component) draw energy while staffed, or for homes while occupied in the cold. Each gets
  its grid's supply/demand ratio (at most 1):
  - `required` buildings cannot work without it, and partial supply slows them down
  - `workBonus` speeds work up
  - `heatBonus` replaces a home's firewood
- Unpowered required buildings and cold generators show a floating badge. A Burst Steam Main tears out a short run
  of pipe and queues its repair.

## Research (`research.json`)

Each research item has a tier, a point cost, requirements and unlocks (buildings, roads, networks, recipes). Content
that no research unlocks is available from the founding. Engineers at a Drafting Office (1 point per work cycle;
faster with galvanic lamps) and the Analytical Engine (4 points) work on the first item in the plan. Choosing an item
plans its unfinished requirements first, and progress is kept when the plan changes. The tree runs from Masonry,
Deep Mining and Tailoring through Metallurgy, Pressure Piping and Copper to Steam Engines, Galvanism and Analytical
Engines. Presets may start with research done (`startingResearch`).

**Production limits** (in the Stores panel) stop producers once storage holds the limit.

**Food spoils** at a per-resource yearly rate, scaled by `spoilageRate`.

## Difficulty presets (`difficulty.json`)

| Preset | Families | Start | Winters | Disasters | Production |
|---|---|---|---|---|---|
| Tinkerer | 6 | Large stores, 4 cottages, a stockyard, a warehouse; Masonry and Tailoring researched | ×0.6 | ×0.4 | ×1.2 |
| Engineer | 5 | Modest stores and a stockyard | ×1 | ×1 | ×1 |
| Ironclad | 4 | Thin stores | ×1.35 | ×1.6 | ×0.95 |
| Brass Inferno | 3 | Scraps | ×1.7 | ×2.4 | ×0.85 |

Presets also scale `birthRate`, `spoilageRate`, `wearRate` and `hungerRate`.

## Events (`events.json`)

Disasters (scaled by `disasterRate`, with none in the first year) and blessings are rolled monthly:

- **Fire**: spreads between nearby buildings; a nearby well stops it.
- **Boiler burst**: a fire at a lit generator (never the Steamforge).
- **Burst steam main**: a short run of live pipe is torn out; builders re-lay it.
- **Blight**: wipes out a field's crop.
- **Fever**: a share of citizens fall ill and lose health.
- **Cold snap**: −9 °C for two months.
- **Travellers** (blessing): new families arrive.
- **Bumper season** (blessing): crops grow faster.
- **Supply airship** (blessing): Company crates of iron, tools, coats and cogs land at the Steamforge.

## World

The seeded map generator (`mapgen.ts`, presets in `mapgen.json`: Valley, Highlands, Lakeland; sizes 128/160/208)
builds the land in layers:

1. fbm elevation with a mountain rim
2. meandering rivers carved with shelving banks, plus lakes
3. sand along the shore
4. stone, iron, coal and copper seams near the mountains (one stone seam is always close to the start)
5. forests, boulders, ironstone, berry bushes and mushroom rings
6. a flattened founding site holding the Steamforge and a short road

## Rendering

- Three.js WebGL renderer.
- Terrain: chunked heightfield with a per-tile colour texture (terrain, roads). A shader adds slope rock, seasonal tint
  and snow.
- Instanced nature, citizens and crops.
- Buildings built from JSON part lists, merged per material. Shapes include boxes, roofs, gears, banded stacks,
  riveted tanks, flanged pipes, tori and domes. Materials are procedural (brick, slate, clay tile, riveted plate,
  copper, brass, verdigris), and building metals reflect a studio environment map. Gears spin, pistons and stamps
  stroke (`bob`), furnaces and galvanic coils glow, and vents puff steam (`emit`) while a building works.
- Conduits: copper steam mains on iron trestles with brass flanges and valve wheels, and copper power lines on
  insulated poles.
- Particles: chimney smoke, steam vents and valve hiss, fire and snowfall.
- Seasonal light and fog, with a shadow frustum that follows the camera.
- Quality tiers (low, medium, high, ultra) adapt automatically.

## Persistence and backend

- Saves are full snapshots (gzip + base64), currently version 2. Version 1 saves are migrated: the Guildhall becomes
  the Steamforge, all research counts as done and all dispatches as received. Local slots and an autosave (every 3 minutes, on pause and on exit) live in
  IndexedDB. Six cloud slots are available per account (`/api/saves`).
- Accounts: a silent guest account is created on first founding and can be upgraded to a registered one. JWT access
  tokens with rotating refresh tokens.
- Colony records (`/api/stats`): colonies founded, best years survived and peak population per difficulty. These are
  personal bests only, so there is no anti-cheat.

## Future work

- Schools and education, a market and trade airships to order, pastures and orchards.
- More energy consumers (pneumatic tubes, galvanic street lamps for happiness), and dispatches that set charter goals.
- Taverns and chapels for happiness, an apothecary and herbs for health.
- Production graphs and a nomad policy setting.
