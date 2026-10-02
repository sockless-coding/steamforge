# SteamForge: Game Design

## Pitch

SteamForge is a survival city builder in the spirit of Banished, set in a Victorian-steampunk world. You lead a few
families into untouched land and keep them alive. Citizens are the only real resource, winter is the main antagonist,
and coal-fired steam is the late-game edge.

## Core loop

1. Gather: fell trees, clear boulders, forage, hunt and fish.
2. Build: lay out homes, storage and workplaces. Every site goes through clearing, then material delivery, then building.
3. Staff: assign professions at the Guildhall. Anyone without a job is a laborer.
4. Survive the seasons: crops grow from spring to autumn, and winter drains warmth and food.
5. Grow: couples need empty homes to marry and have children, and travellers sometimes arrive.
6. Industrialise:
   - smelt iron
   - forge tools
   - sew coats
   - machine cogs
   - raise steam

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

- place a building, a road, a field (drag to size), or a clearing mark
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
  - Warmth: lost outdoors in the cold, more slowly with a coat, and regained in a heated home or the Guildhall shelter.
  - Health: drops while starving, freezing or sick, and recovers faster with a varied diet.
  - Happiness: affects work speed and birth chance.
- **Gear**: tools wear out over about 30 months and coats over about 36 (scaled by `wearRate`). Working without tools
  runs at 55% speed.
- **Households**: one family per house. An empty house goes, in order of preference, to:
  1. a homeless couple
  2. a homeless adult
  3. a couple still living with their parents
  4. two unrelated single adults, who marry

  Children follow their parents. Homeless adults shelter in the Guildhall. Births happen in houses with a couple and a
  free bed.
- **Aging**: children become laborers at 12, can marry from 16, and become elders at 58 (slower). Death from old age
  grows likely towards 85.
- **Task AI**, in priority order:
  1. urgent needs
  2. collecting tools or coats
  3. stocking the home pantry and firewood
  4. the job (workplace or builder)
  5. labour: supply sites, clear land, haul goods
  6. idle

  Tasks are plain data (steps plus reservations), so they serialize.

## Economy

All values live in content JSON.

| Chain | Buildings |
|---|---|
| Logs → firewood | Forester's Lodge (fells and replants), Woodcutter's Shed, Steam Sawmill (needs steam) |
| Food | Forager's Hut (berries, mushrooms; seasonal), Hunter's Lodge (scales with nearby forest), Fishing Dock (needs shore), Crop Field (potatoes, cabbage, barley) |
| Stone / ore / coal | Quarry, Iron Mine and Coal Pit, each placed over a matching seam |
| Iron → tools / cogs | Smelter (ore + coal), Toolworks (iron + logs), Machine Works (iron → cogs) |
| Leather → coats | Hunter's Lodge byproduct → Tailor's Shop |
| Steam | Boiler House: burns coal with a stoker. Gives +50% work speed and −50% firewood for buildings within 10 tiles |
| Storage | Guildhall (all goods), Stockyard (materials, fuel), Warehouse (food, goods) |
| Safety | Well: fires within 14 tiles are put out quickly. Otherwise a burning building is lost and the fire spreads |

**Production limits** (in the Stores panel) stop producers once storage holds the limit.

**Food spoils** at a per-resource yearly rate, scaled by `spoilageRate`.

## Difficulty presets (`difficulty.json`)

| Preset | Families | Start | Winters | Disasters | Production |
|---|---|---|---|---|---|
| Tinkerer | 6 | Large stores, 4 cottages, a stockyard and a warehouse | ×0.6 | ×0.4 | ×1.2 |
| Engineer | 5 | Modest stores and a stockyard | ×1 | ×1 | ×1 |
| Ironclad | 4 | Thin stores | ×1.35 | ×1.6 | ×0.95 |
| Brass Inferno | 3 | Scraps | ×1.7 | ×2.4 | ×0.85 |

Presets also scale `birthRate`, `spoilageRate`, `wearRate` and `hungerRate`.

## Events (`events.json`)

Disasters (scaled by `disasterRate`, with none in the first year) and blessings are rolled monthly:

- **Fire**: spreads between nearby buildings; a nearby well stops it.
- **Boiler burst**: a fire at a lit boiler.
- **Blight**: wipes out a field's crop.
- **Fever**: a share of citizens fall ill and lose health.
- **Cold snap**: −9 °C for two months.
- **Travellers** (blessing): new families arrive.
- **Bumper season** (blessing): crops grow faster.

## World

The seeded map generator (`mapgen.ts`, presets in `mapgen.json`: Valley, Highlands, Lakeland; sizes 128/160/208)
builds the land in layers:

1. fbm elevation with a mountain rim
2. meandering rivers carved with shelving banks, plus lakes
3. sand along the shore
4. stone, iron and coal seams near the mountains (one stone seam is always close to the start)
5. forests, boulders, ironstone, berry bushes and mushroom rings
6. a flattened founding site holding the Guildhall and a short road

## Rendering

- Three.js WebGL renderer.
- Terrain: chunked heightfield with a per-tile colour texture (terrain, roads). A shader adds slope rock, seasonal tint
  and snow.
- Instanced nature, citizens and crops.
- Buildings built from JSON part lists, merged per material. Gears spin and furnaces glow while working.
- Particles: chimney smoke, boiler steam, fire and snowfall.
- Seasonal light and fog, with a shadow frustum that follows the camera.
- Quality tiers (low, medium, high, ultra) adapt automatically.

## Persistence and backend

- Saves are full snapshots (gzip + base64). Local slots and an autosave (every 3 minutes, on pause and on exit) live in
  IndexedDB. Six cloud slots are available per account (`/api/saves`).
- Accounts: a silent guest account is created on first founding and can be upgraded to a registered one. JWT access
  tokens with rotating refresh tokens.
- Colony records (`/api/stats`): colonies founded, best years survived and peak population per difficulty. These are
  personal bests only, so there is no anti-cheat.

## Future work

- Schools and education, trade airships and a market, pastures and orchards.
- Taverns and chapels for happiness, an apothecary and herbs for health.
- Production graphs and a nomad policy setting.
