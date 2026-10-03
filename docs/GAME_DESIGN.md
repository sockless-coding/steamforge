# SteamForge: Game Design

## Pitch

SteamForge is a survival city builder set in a Victorian-steampunk world. You lead a few families into untouched
northern land and keep them alive. Citizens are the only real resource, and winter is the first antagonist. Steam turns
a frontier camp into an industrial town, and the town's own coal smoke becomes the second antagonist. The identity
redesign in progress is in [REDESIGN.md](REDESIGN.md).

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
6. Grow: couples need empty homes to marry and have children, and travellers sometimes ask to join.
7. Industrialise:
   - smelt iron and copper
   - forge tools and machine cogs
   - pipe steam to workshops
   - turn steam into galvanic power
8. Breathe: every chimney and stove puts out soot that the wind carries over the colony. Site homes upwind, keep
   forest belts, and answer it with apothecaries and precipitators.

## Time

- 10 simulation ticks per game-second and 180 game-seconds per month, so one year is 36 minutes at ×1 and 108 seconds
  at ×20.
- Twelve months: Early, mid and Late Spring, then Summer, Autumn and Winter in the same pattern.
- **Day and night** (`rules.json` → `day`): each month has two 90-second days (`daysPerMonth`), 24 a year. Months
  turn over at noon, so a colony is founded in daylight. `daylight` gives each month's share between sunrise and sunset: 70% at midsummer,
  50% at midwinter (60% on average). The HUD shows the clock and a sun or moon.
  - At night citizens go home to sleep (the homeless bed down in the Steamforge). Unlit work stops at nightfall, and
    the job in hand is picked up again the next morning if the worker returns to the same job. Children always sleep.
  - Work is set in seconds, while needs, fuel and wear are set per month. Changing `secondsPerMonth` changes how
    much work fits into a month, so keep the balance in one of two ways:
    - Scale the work durations (`seconds`, `work`, `plantSeconds`, `harvestSeconds`) with it. People then do less
      per day.
    - Or keep the work durations and scale every per-second rate written per month by the same factor:
      - multiply the citizen needs (`hungerPerMonth`, `coldPerMonth`, `warmUpPerMonth`, health rates),
        `firewoodPerMonth`, shelter warmth and generator `fuel`
      - divide the use-based lifetimes (`toolLifeMonths`, `coatLifeMonths`, `windMonths`)
      - multiply output tied to the calendar: crop `yieldPerTile`, forage harvest amounts, forest regrowth,
        `spoilagePerYear`, airship cargo, and starting food and firewood

      Ages, births, events, seasons and crop growth months stay as they are. The 90-second day was made this way
      (×1.5 from 60 seconds).
  - Workplaces and construction sites lit by a **Gas Lamp** (radius 7) or a **Galvanic Arc Lamp** (radius 12, needs
    power) keep working through the night at `nightWorkFactor` (60%) speed.
  - Automatons work through the night at full speed.
  - Eating and warming up still happen at night. Sleeping in a heated home keeps people warm.
- Monthly base temperatures come from `rules.json`, with random jitter and cold snaps on top. Below the comfort
  temperature (8 °C), difficulty's `winterSeverity` multiplies the cold.
- Speeds are Pause, ×1, ×2, ×5, ×10 and ×20. Keys: Space toggles pause, 1–5 set speed. The game auto-pauses when the tab
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
  2. after dark: lamplit work, otherwise sleep
  3. collecting tools or coats
  4. stocking the home pantry and firewood
  5. the job (workplace or builder)
  6. labour: supply sites, service buildings (keep the Steamforge fuelled), clear land, haul goods
  7. idle

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
| Health | Apothecary (brews glasshouse herbs into lung tonic; homes within 16 tiles take 60% less soot damage while tonic lasts) |
| Clean air | Galvanic Precipitator (clears 12% of the soot within 12 tiles each second; needs power) |
| Amenities | Gas Lamp (+6% happiness within 7 tiles), Galvanic Arc Lamp (+5% within 9; needs power), Clock Tower (+12% within 18; needs steam). Homes take at most +25% from amenities |
| Lighting | Gas Lamp (radius 7), Galvanic Arc Lamp (radius 12; needs power): night work goes on in their light |
| Trade | Airship Mast (see below) |
| Logistics | Steam Tram Depot, Pneumatic Depot, Safety Valve (see below) |
| Automatons | Automaton Works (see below) |

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

## Airship trade

An Airship Mast (needs steam for its winches) is the colony's counting house with the Meridian Steam Company.
Resources with a `value` in `resources.json` can be traded. Trade orders are set per resource in the Stores panel:

- **Export above N**: laborers carry stock above N to the mast, where it is credited at once at value × `sellFactor`.
- **Import up to N**: every `visitMonths` a Company airship flies in and moors at the mast's cone. It sells imports
  at value × `buyFactor`, as far as credit and its cargo allow. Laborers haul the goods into storage.

Prices and factors live in `rules.json` (`trade`) and the mast's `airship` component.

## Clockwork automatons

The Automaton Works (needs steam) assembles automatons from cogs, copper and iron, up to an optional target count.
Automatons join the workforce like adult laborers but:

- never eat, freeze, fall ill, marry or need a home, and work at a steady 90% with no tools
- wind themselves with 2 coal from storage every 6 months; without coal they run down and stand idle
- seize up for good after about 12 years of service (`rules.json` → `automaton`)

A colony with only automatons left is still lost.

## Steam logistics and pressure

- **Steam tramways** (a road type with `needsDepot`): citizens travel at 3× walking pace while any Steam Tram Depot
  has steam, and at 1.6× otherwise. Trams visibly run on the rails.
- **Pneumatic depots** (`pneumatic` component): powered depots on the same steam grid even out their unreserved
  goods every second, so anything delivered to one can be collected at any other.
- **Overpressure**: each month, a fuelled boiler on a grid drawing more than 110% of its supply may burst (scaled by
  `disasterRate`, never in the grace year, never the Steamforge). A **Safety Valve** on the grid bleeds 2 psi and
  prevents bursts. Warnings come first.

**Production limits** (in the Stores panel) stop producers once storage holds the limit.

**Food spoils** at a per-resource yearly rate, scaled by `spoilageRate`.

## Soot and wind

Coal smoke is simulated (`soot.ts`, settings in `rules.json` → `soot` and `wind`).

- **Wind** blows from a prevailing direction for each season (`wind.prevailing`, compass degrees; spring 250°, summer
  225°, autumn 270°, winter 315°), within `variance` (50°) of it, at 0.25–1 tiles per second. It changes each month,
  drawn from a generator seeded by the colony and the month, so it needs no saved state.
- **The soot field** is a grid with one cell per 4×4 tiles. Every second:
  1. Sources add soot:
     - working buildings with an `emitter` component (`soot` per second, laid down `stack` tiles downwind)
     - lit generators, scaled by their load, with banked fires at a quarter
     - home stoves, by the firewood they burn (`stoveSootPerFirewood`)
     - burning buildings
  2. Powered precipitators (`scrubber`) clean the cells around them.
  3. The wind carries the soot, which spreads to neighbouring cells. Soot blown off the map is gone.
  4. The soot disperses (faster over forest, slower in winter) and settles as **grime**. A twentieth of the grime
     washes away each month.
- **Exposure** is soot ÷ `fullSoot` (16), capped at 1:
  - Above `lungSafe` (0.25), people lose up to 0.3 health a month, and children and elders twice as fast. The damage
    also stops health recovering. Death by soot is recorded as black lung.
  - Smoke at the home lowers the happiness target by up to 0.2.
  - A Hunter's Lodge loses up to 60% of its catch in sooty air, a Fishing Dock 30%.
- **Grime** ÷ `fullGrime` (40) cuts field yields by up to half.
- **Emitters** (soot per second at full work, and stack height in tiles):

  | Building | Soot | Stack |
  |---|---|---|
  | Smelter | 3 | 2 |
  | Boiler House | 2.5 | 6 |
  | Toolworks | 1.2 | 1 |
  | Steamforge | 1 | 3 |
  | Machine Works | 1 | 2 |
  | Coal Pit | 0.8 | 0 |
  | Automaton Works | 0.8 | 2 |
  | Steam Sawmill | 0.6 | 1 |
  | Iron Mine, Copper Mine | 0.4 | 0 |
  | Woodcutter's Shed, Quarry | 0.3 | 0 |

  The galvanic dynamo and the arc furnace are clean.
- **Answers:**
  - put homes upwind of furnaces
  - keep forest belts
  - build tall stacks such as the boiler house's
  - heat homes by steam rather than with stoves
  - build an Apothecary (Sanitary Science) and a Galvanic Precipitator (Electrostatic Precipitation)
- **Calibration:** four heavy workshops running nonstop beside 16 cottages give the nearest homes 0.6–1.0 exposure and
  the median home 0.2–0.3. Wood stoves alone stay below the lung threshold.

## Difficulty presets (`difficulty.json`)

| Preset | Families | Start | Winters | Disasters | Production | Soot |
|---|---|---|---|---|---|---|
| Tinkerer | 6 | Large stores, 4 cottages, a stockyard, a warehouse; Masonry and Tailoring researched | ×0.6 | ×0.4 | ×1.2 | ×0.6 |
| Engineer | 5 | Modest stores and a stockyard | ×1 | ×1 | ×1 | ×1 |
| Ironclad | 4 | Thin stores | ×1.35 | ×1.6 | ×0.95 | ×1.3 |
| Brass Inferno | 3 | Scraps | ×1.7 | ×2.4 | ×0.85 | ×1.6 |

Presets also scale `birthRate`, `spoilageRate`, `wearRate` and `hungerRate`.

## Events (`events.json`)

Disasters (scaled by `disasterRate`, with none in the first year) and blessings are rolled monthly
(`rules.json` → `events`). An event that cannot happen right now (a boiler burst with no lit boiler, blight with no
crop in the ground) is set aside and another is drawn, so the configured rates hold. Disasters are at least
`minMonthsBetweenDisasters` (3) months apart.

- **Fire**: spreads between nearby buildings; a nearby well stops it.
- **Boiler burst**: a fire at a lit generator (never the Steamforge).
- **Burst steam main**: a short run of live pipe is torn out; builders re-lay it.
- **Blight**: wipes out a field's crop.
- **Fever**: a share of citizens fall ill and lose health. Children and elders lose health `vulnerableFactor` (2.2)
  times faster, which can kill them if they were already weak.
- **Cold snap**: −9 °C for two months.
- **Black lung**: 35% of the people breathing sooty air (exposure 0.35 or more) fall ill for three months. It cannot
  strike a clean colony.
- **Rain squall** (blessing, spring to autumn): washes 80% of the soot from the air and 35% of the grime from the
  ground. It is only drawn when there is soot to wash.
- **Travellers** (blessing): a group of 3–7 asks to join and waits at the Steamforge for the player to welcome or turn
  them away (`answerPetition`). Only one group waits at a time, and it moves on after `waitMonths` if nobody answers.
  They bring no tools. Some groups (`feverChance`) carry fever, which the petition card warns about. Welcoming them
  makes about half of them and a few colonists ill.
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
- Terrain:
  - a chunked heightfield with a per-tile colour texture (terrain, roads)
  - a cold moor palette with patches of heather and bracken
  - a shader that adds slope rock, seasonal tint and snow
  - grime from the soot field (one texel per cell, eased over a few seconds), which dulls grass to ash-brown, heavy
    grime to cinder, and snow to grey slush. The ground looks fully blackened at half the grime that fully fouls
    the soil.
  - water downstream of industry that turns oily brown
  - the **soot map**, a heat map of airborne soot that is clear below the lung threshold and red-black above it,
    toggled from the HUD and shown automatically while placing homes, emitters, apothecaries or precipitators
- Instanced nature, citizens and crops.
- Buildings built from JSON part lists, merged per material. Shapes include boxes, roofs, gears, banded stacks,
  riveted tanks, flanged pipes, tori and domes. Materials are procedural (brick, slate, clay tile, riveted plate,
  copper, brass, verdigris), and building metals reflect a studio environment map. Gears spin, pistons and stamps
  stroke (`bob`), furnaces and galvanic coils glow, and vents puff steam (`emit`) while a building works.
- Conduits: copper steam mains on iron trestles with brass flanges and valve wheels, and copper power lines on
  insulated poles.
- Particles: chimney smoke, steam vents and valve hiss, fire and snowfall.
  - Coal-burning buildings belch thick black smoke in proportion to their soot, and stoves give off a grey wisp.
  - Plumes leave the chimney upright and lean with the simulation's wind.
- Atmosphere:
  - The light follows the simulation's sun, with dusk tints and moonlight. The "Night darkness" setting hides the
    dark, but night still passes.
  - Windows and lamps brighten at night, and lamps cast pools of light.
  - Skies over the untouched frontier are pale and cold.
  - The airborne soot around the camera, and a share of the worst in the colony, turns the sky brass-amber and draws
    the fog in. At night the haze glows with the furnaces.
  - Above the low tier, a grade pass gives amber highlights, teal shadows, a little contrast and a vignette. Smog
    warms it, and night cools the shadows. The low tier uses a CSS sepia filter instead.
- Airships: Company dirigibles approach, moor at and leave each airship mast, and cosmetic dirigibles drift over the
  valley. Automatons are brass-barrel figures with a glowing eye. Steam trams run on iron rails.
- HUD energy gauges are small brass pressure dials (red past full load).
- The soot barometer and wind vane HUD chip shows:
  - a dial needle for the mean exposure at homes, red past the lung threshold, with a dot for the worst home
  - a brass vane pointing where the smoke is carried
  - a label: Clean, Hazy, Smoky or Choking

  Clicking the chip toggles the soot map.
- Seasonal light and fog, with a shadow frustum that follows the camera.
- Quality tiers (low, medium, high, ultra) adapt automatically.

## Persistence and backend

- Saves are full snapshots (gzip + base64), currently version 5, migrated one version at a time:
  - Version 1: the Guildhall becomes the Steamforge, all research counts as done and all dispatches as received.
  - Version 2: gains empty trade orders and no credit.
  - Version 3: the clock is rescaled from 40- to 120-second months so the colony keeps its date. It gains no waiting
    travellers and no recent disaster.
  - Version 4: gains clean air (no soot or grime) and the season's prevailing wind at middling strength.
- Snapshots hold the soot and grime fields as base64 `Float32Array`s, and the wind in `weather`.
- Local slots and an autosave (every 3 minutes, on pause and on exit) live in IndexedDB. Six cloud slots are
  available per account (`/api/saves`).
- Accounts: a silent guest account is created on first founding and can be upgraded to a registered one. JWT access
  tokens with rotating refresh tokens.
- Colony records (`/api/stats`): colonies founded, best years survived and peak population per difficulty. These are
  personal bests only, so there is no anti-cheat.

## Future work

The planned identity redesign (pressure, soot, guilds, the Lost Forges and an industrial-amber look) is in
[REDESIGN.md](REDESIGN.md).

- Schools and education, a market and trade airships to order, pastures and orchards.
- More power consumers and dispatches that set charter goals.
- Taverns and chapels for happiness.
- Production graphs.
- Traveller arrivals that depend on how attractive the colony is (free homes, food, happiness).

## Balance testing

`BALANCE=1 npm run test -- balance` plays a scripted build order (`game/sim/autoplay.ts`, shared with the soak test)
on eight seeds for twelve years. It prints average population per year, colonies lost, and births, arrivals and
deaths per colony-year. `BALANCE_DIFFICULTY`, `BALANCE_SEEDS` and `BALANCE_YEARS` adjust the run. Compare the report
before and after any tuning change, because a single seed is too noisy to judge balance by.
