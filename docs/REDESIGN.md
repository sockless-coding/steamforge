# SteamForge: Identity Redesign

Status:
- **Phase 1** (soot and the industrial-amber look) is built and documented in [GAME_DESIGN.md](GAME_DESIGN.md), except
  for the items listed as deferred under Phase 1 below.
- Phases 2–4 are proposals.

As each phase lands, move its sections into GAME_DESIGN.md.

## Why

Today SteamForge plays and looks like Banished with brass trim:

- The first hour is berries, mushrooms, venison, firewood, potatoes and timber cottages under a blue sky over green
  land.
- Steam is a mid-game upgrade layer. A colony can survive for years without laying a pipe.
- The smog is cosmetic (a sky tint in `WorldRenderer.smogGoal`), and nothing in the simulation pays for industry.
- The best hook in the setting ("Eleven forges went before yours; four still answer telegrams") is only flavour text.

The goal is a game whose **core loop** is steampunk, not just its art. Four pillars replace Banished systems instead of
sitting on top of them.

| Pillar | Replaces | The tension it creates |
|---|---|---|
| **Pressure is life** | Firewood, foraging, hunting, timber-first economy | Every home and workshop hangs off a steam main that loses pressure with distance; the town's shape is a plumbing problem |
| **Soot & progress** | Cosmetic smog | Each furnace and stove puts out soot that drifts on the wind and harms lungs, crops and morale; growth fights health |
| **Clockwork society** | Faceless professions | Guilds with standing; automatons boost output but threaten the trades they replace |
| **The Lost Forges** | Static story dispatches | Airship expeditions to the eleven other forges bring back salvaged blueprints, survivors and relics |

### Not Frostpunk either

A central heat engine, expeditions, automatons and discontent together are Frostpunk's core too. Each pillar is built
on a mechanic Frostpunk does not have:

- Heat travels through **pipes with pressure loss**, not a radius around a generator. Layout and main grades are the
  puzzle.
- **Soot is a spatial field moved by the wind.** Where you put chimneys matters, and tall stacks only move the problem
  downwind.
- Society runs on **guilds and petitions** with concrete trade-offs about mechanising particular trades. There is no
  law book and no hope/discontent bar.
- Expeditions visit **named sister colonies with persistent fates** and a telegraph relationship, not anonymous map
  nodes.
- There is no "the city must survive the storm" countdown. The antagonists are still winter and the colony's own
  industry.

## Pillar 1: Pressure is life

Steam is the colony's blood from the first day. The Steamforge sits at the heart of a pipe network, and everything that
needs warmth or power hangs off it.

### Fuel and heat

- **Firewood stays** as the frontier fuel for home stoves. It is what a family burns before the main reaches them.
- **Coal is the industrial fuel from day one.** Mapgen guarantees a shallow **coal outcrop** near the founding site
  (like today's near-start stone seam), and the Coal Pit is available at founding. Deep Mining moves to iron and
  copper.
- **Homes are heated in one of two ways:**
  - **On a main:** any home touching a steam grid is radiator-heated, in proportion to the pressure it receives. Its
    firewood use falls by the same share.
  - **Off the grid:** a home burns firewood in its own stove, which emits soot at street level (see Pillar 2). A
    wood stove is lighter on soot than a coal furnace, but a hundred of them blacken a district.

  The `heatBonus` consumer already does this. It becomes the default for housing, with a full bonus on every home
  type, so cottages also run on steam once a main reaches them. As the grid grows, firewood moves from being a necessity to
  being a backup for when the pressure fails.
- **Steam Pipe is available at founding.** Pressure Piping research instead unlocks **lagged mains** (lower loss).

### Pressure loss

Today every building on a grid gets the same supply/demand ratio. The new model:

- Each conduit grade has a `lossPerTile` (`rules.json` → `networks[].conduits[]`, a list of grades). Examples: bare
  iron 2%, lagged 0.8%, high-pressure 0.3%.
- Energy now runs in two steps:
  1. A multi-source shortest-path pass from every generator gives each consumer its *head* (pressure after loss).
  2. The supply/demand ratio is then applied to that head.

  This happens once a second (`energy.ts` already recomputes grids on change), so the cost is small.
- **Booster Pump** (building): restores head along a main and consumes some pressure to do so.
- The overlay shows pressure as a colour gradient along the pipes, so a starved far end is visible at a glance.
- Long sprawl now costs something, and dense blocks around a boiler house become the natural form. That is the
  opposite of Banished's spread-out hamlets.

### Feedwater

- Boilers turn **water + coal → steam**. Water is a new network that comes first in `networks`, carried by **water
  mains** from a **Pump House** on the shore or a **Deep Well** (slow, works anywhere).
- The Boiler House becomes a converter (water → steam), in the same way the Dynamo is (steam → power). The engine
  already supports converters, so this is mostly data.
- Rivers and lakes become strategic. Boilers cluster where water can reach them.
- The Steamforge has an internal cistern, so the first colony works with no water network.

### Food

The forager, berries and mushrooms go. The **Hunter's Lodge stays**: it is still the source of leather for coats, and
the wild game it depends on thins out where soot builds up. The other food sources are industrial and mostly need steam:

| Building | Produces | Notes |
|---|---|---|
| Company ration crates | Tinned rations | Starting stock; never spoils; also comes by supply airship |
| Hunter's Lodge | Venison, leather | Unchanged, except that soot near the lodge cuts its catch |
| Fishing Dock → **Steam Trawler Dock** | Fish | The trawler upgrade triples the catch; needs steam |
| Crop Field | Potatoes, cabbage, barley | Yield ×`soot` factor; a **Steam Tractor Shed** speeds planting and harvest within a radius |
| **Steam Glasshouse** | Tomatoes, greens | Moves to tier 1 so winter food never depends on luck |
| **Bakehouse** | Barley → bread | Needs steam; bread spoils slowly |
| **Cannery** | Fish/vegetables + iron → tinned food | No spoilage; a strong export |
| **Pneumatic Kitchen** (late) | Feeds every home on its pneumatic grid | Ends pantry runs |

Diet variety stays and now spans processed foods.

## Pillar 2: Soot & progress

### Simulation

- **Soot field:** a coarse grid with one cell per 4×4 tiles (32×32 cells on a small map), stored as `Float32Array`
  in a `soot` system.
- **Every second** (deterministic, insertion order):
  1. **Emit:** each working `emitter` and each home burning firewood adds soot to its cell, or to a cell `stackHeight` cells downwind (a tall stack
     disperses soot further away).
  2. **Advect** along the wind vector, then diffuse.
  3. **Decay:** faster over forest (trees filter soot), slower in winter inversions.
  4. **Deposit** a fraction onto a persistent **grime** layer.
- **Wind** (`rules.json` → `wind`) has a prevailing direction for each season and drifts monthly through `sim.rng`.
  Rain events wash soot out and halve the grime.

### Effects (all thresholds in `rules.json` → `soot`)

- **Lungs:** citizens who sleep or work in sooty cells lose health. Elders and children lose it faster. The Fever
  event gains a "Black Lung" variant that is more likely in sooty colonies.
- **Crops:** field yield is multiplied by `1 − grime × cropPenalty`.
- **Morale:** soot near homes lowers happiness, and amenities can only partly offset it.
- **Snow and ground** visibly blacken (see Visuals).

### Counter-play

| Answer | Cost |
|---|---|
| Tall stacks (`emitter.stackHeight`; a **Stack Extension** upgrade on a building) | Soot moves downwind, so placing homes upwind is the plan |
| **Forest belts** | Trees filter soot, so forests are worth keeping rather than levelling |
| **Galvanic Precipitator** | Clears soot in a radius; draws power |
| Grid heating over stoves | One boiler with a tall stack instead of many street-level stoves |
| **Apothecary** | Treats lung damage; uses herbs from the glasshouse |
| Arc furnace instead of smelter | Already in the game; coal-free smelting gains a clean-air purpose |

### New components and validation

- `emitter`: `{ sootPerSecond, stackHeight }`. It goes on the smelter, boiler, Steamforge, woodcutter and other
  furnaces.
- `housing.sootPerSecond`: homes emit while burning firewood, scaled by the share of heat they still take from the
  stove. A radiator-heated home emits nothing.
- `scrubber`: `{ radius, rate }`, with a `consumer` component for power.
- `ContentValidator`: new component kinds, a `rules.soot` and `rules.wind` schema, and a rain event kind.

### Difficulty

Each preset gains `modifiers.sootRate`, which scales emissions:

| Preset | `sootRate` |
|---|---|
| Tinkerer | ×0.6 |
| Engineer | ×1 |
| Ironclad | ×1.3 |
| Brass Inferno | ×1.6 |

Phase 3 adds a `guildTemperament` (see Pillar 3).

## Pillar 3: Clockwork society

### Guilds

- Each profession declares a `guild` in `professions.json`. There are four guilds (`guilds.json`, merged like other
  content):
  - **Brotherhood of Stokers & Miners:** stokers, miners, quarrymen, smelters
  - **Artisans' Guild:** smiths, tailors, machinists, bakers
  - **Engineers' Institute:** engineers, galvanists
  - **Land & Water Union:** farmers, fishers, glasshouse keepers, foresters
- Each guild has a **standing** from 0 to 100, recalculated monthly from data-weighted factors:
  - the soot exposure, hunger and cold of its members
  - night shifts (lamplit work)
  - the number of automatons doing its trades
  - its **Guild Hall** (an amenity for that guild only)
  - recent petition answers
- **High standing** (≥70): +10% work speed for members, and the Engineers' Institute speeds research.
- **Low standing:**
  - below 30: **work-to-rule** (members work at 70%)
  - below 15: a **strike** (members idle for a month)
  - at 0: **sabotage** events (smash an automaton, open a valve, cut a main) and members emigrating

### The machine question

- Automatons arrive earlier (tier 3) and can be **assigned to a specific trade**. They no longer act only as laborers.
- Every automaton in a trade costs that trade's guild standing, so mechanising mining is cheap in coal but expensive
  with the Brotherhood.
- The Engineers' Institute *likes* automatons. Pleasing one guild can anger another.

### Petitions

These reuse the traveller petition flow (`answerPetition`). A guild raises a card with two or three choices, each with
data-defined consequences. Examples:

- "The Brotherhood asks for a fortnight's rest after the winter shift." Effects: boilers −20% for a month, or standing
  −15.
- "The Institute requests the Analytical Engine's spare cycles." Effects: research +25% for the Institute, or −10
  standing for the Union.
- "Workers ask that no automaton be built for six months." Effects: an accepted lock, or −20 standing and a risk of
  sabotage.

Petitions are data (`petitions.json`: trigger conditions, choices, effects). Effects are named, like `registerEffect`
today.

### Difficulty

Each preset gains a `guildTemperament`:

- `startingStanding`
- `standingDrift`: a multiplier on monthly losses
- `petitionsPerYear`

| Preset | `startingStanding` | `standingDrift` |
|---|---|---|
| Tinkerer | 70 | ×0.6 |
| Engineer | 55 | ×1 |
| Ironclad | 45 | ×1.3 |
| Brass Inferno | 35 | ×1.6, and sabotage is possible from standing 10 |

## Pillar 4: The Lost Forges

### The world map

- **Hollowmere** is a second screen: a stylised brass-and-parchment chart. The colony sits at the centre, and the
  **eleven other forges** and a handful of points of interest (wrecks, Company caches, survey stations) are placed by
  seed.
- Each forge has a name, a number, and a **fate** drawn from `forges.json`:

  | Fate | Count | What the player finds |
  |---|---|---|
  | **Answering** | four | Live colonies with a telegraph relationship (below) |
  | **Frozen** | | Buildings intact, everyone dead. Salvage and records |
  | **Overpressure** | | A crater. The Forge core ruptured. Dangerous, rich salvage |
  | **Revolt** | | Guild collapse. Survivors to recruit, and an automaton graveyard |
  | **Abandoned** | | The colony left for the south. Diaries |
  | **Unknown** | | Only resolved on arrival |

### Expeditions

- They need an **Airship Yard** (builds an expedition airship from cogs, copper and **envelope silk** from the
  tailor) and a **crew** of 2–5 citizens. The crew is away from the colony for the voyage.
- Each voyage takes months, depending on distance. Hazards (storms, a hard landing) are rolled from `sim.rng` when the
  expedition launches, so saves replay exactly. The crew may come back hurt, or not at all.
- **Rewards:**
  - **Blueprints:** salvage-only research items (`research.json` → `"salvage": true`) such as Lagged Mains Mk II, the
    Aether Condenser and the Forge Core Retrofit. Engineers cannot research these from scratch.
  - **Survivors** who join through a petition card.
  - **Relics:** unique colony-wide bonuses (e.g. Forge No. 4's governor: the Steamforge never banks its fire).
  - Bulk salvage (iron, cogs, copper).

### The telegraph

- A **Telegraph Office** connects to the four answering forges. Each has a persona (who writes, how they write), a
  current crisis and running needs.
- **Contracts:** "Forge No. 7 needs 60 coal before winter; they will send 20 cogs." These are honoured by airship.
- Their fates **evolve**. Ignored, a forge can go silent, and your next expedition finds out why. Helped, it can grow
  and offer rarer trades.
- This replaces most of today's milestone dispatches with a living correspondence. The Board keeps its voice for the
  charter.

### Story arc

The campaign has three acts. The charter stays the first goal, and the Lost Forges arc is what comes after.

**Act I: The Brass Charter (years 1–10).** This is today's charter. Survive, industrialise, and raise an Analytical
Engine. The Board writes as before. Fulfilling the charter makes the colony yours, and the game can continue
indefinitely.

**Act II: The Silent Forges.** This act starts once a Telegraph Office stands, or at year 4 at the latest.

- The four forges that still answer each write from inside one of the colony's own failure modes:
  - Forge No. 7 is losing a winter.
  - Forge No. 11 is on the edge of a guild revolt.
  - Forge No. 3 is choking on its own soot.
  - Forge No. 5 is thriving, and boasts that it no longer needs the Company.
- The player can help, ignore or exploit them.
- Every ruin's fate mirrors one of those modes, so the player reads what lies ahead in the ruins. Diaries and records
  recovered on expeditions are kept in the Dispatches ledger as a second volume, **The Forge Papers**.

**Act III: Pressure Creep.** This act starts once the player has recovered three sets of Forge Papers that mention it,
or at year 12.

- **The reveal:** the Company knew. The sealed pressure engines creep. After about a decade, their core pressure
  rises on its own, a little each year.
  - Forge No. 2 is the crater on the chart.
  - Forge No. 5's boasting stops mid-telegram.
  - The Board's dispatches about "self-sufficiency within the decade" now read differently: the Board needed every
    colony to stand on its own before its forge failed.
- **The threat:** Steamforge No. 9 starts creeping.
  - It gains pressure each year, which feels good at first: more free steam.
  - Overpressure warnings follow. Safety valves bleed some of it, but only for a time.
  - The fate of the colony depends on one decision before the core fails.
- **The choice** is a final petition-style card. Both endings are kept in the save and stated in the colony's stats:
  - **Unseal and retrofit.** This needs the salvage-only *Forge Core Retrofit* blueprint and an Engineers' Institute
    standing of 60 or more. The retrofit is a long construction site at the Steamforge. While it is under way, No. 9
    is offline and the colony runs on its own boilers.
    - Success: No. 9 becomes a controllable high-pressure generator.
    - Low Brotherhood standing during the work: sabotage risks a burst.
  - **Vent and decommission.** Bleed the core and seal it for good. No. 9 becomes a cold monument: storage and shelter
    only, no steam. The colony must already have the boilers to survive this. Some workers celebrate and others
    protest: the Brotherhood gains standing, and the Institute loses it.
  - **Do nothing.** The core ruptures, as at Forge No. 2.
- **Epilogue:** a final telegram from whichever forges are still answering, and from the Board. Its tone depends on
  the choice and on how the player treated the other forges.

This ties the pillars together:

- Pressure is the threat.
- Guild standing gates both solutions.
- Expeditions provide the blueprint and the warning.
- A colony that never built its own boilers, and so is still too dependent on No. 9, loses either way.

Pressure creep only starts once Act III has been triggered. A player who never builds a Telegraph Office still meets
it, at year 12, through a Board dispatch, so the ending cannot be missed.

## Visuals: industrial amber

The land itself changes as the colony industrialises. Green and blue belong to the untouched frontier, and soot and
brass to the town.

### Sky, light and grade

- **Base sky:**
  - before industry: pale, cold northern grey-blue (from `#9ec4dc` to a desaturated `#a9b8bf`)
  - as soot rises: towards brass-amber haze (`#b8925a`), not today's brown `#8a7a62`
- **Grade:** replace the light sepia with an amber-highlight, teal-shadow split tone. Raise contrast slightly and add
  a vignette.
- **Sun shafts** through the haze on high tiers (a screen-space god-ray pass from the sun position).
- **Night:**
  - deep teal-blue ambient
  - sodium-orange gaslight pools
  - furnace glow that lights the underside of the smoke (an emissive fog tint near working furnaces)

### Ground and water

- **The terrain shader samples a grime texture** uploaded from the sim's grime layer.
  - Grime darkens and desaturates grass towards ash-brown and stains snow grey-black.
  - Heavy grime turns ground to cinder.
  - Upwind land stays green, so the wind is visible on the map.
- **Spoil tips:** mines and smelters grow procedural slag heaps beside them. They are a deterministic sim feature
  (`spoil`), so they can be cleared for stone.
- **Water** picks up an oily green-brown sheen downstream of industry. The shader reads the grime of nearby cells.
- **Unclaimed land is colder:** cooler greens, more exposed rock and frost-burnt heather instead of lush grass, so the
  first colony reads as a frontier, not a meadow.

### Buildings and machinery

- **Smokestacks** become a signature: tall banded brick stacks on boiler houses, smelters and the Steamforge. Plumes
  bend with the sim wind and darken with the building's soot output.
- **Brick and iron replace timber** as the default look from the start:
  - Settler's Cottage → **Company Row Cottage** (soot-stained brick, slate, iron stove pipe)
  - Forester → **Timber Yard** with a steam crane
- **Exposed machinery on every workplace:** a visible flywheel, piston, conveyor or crane that animates while
  working. Today only some buildings have one.
- **Pipes everywhere:** homes on a main show a branch pipe and radiator vent. Pressure is visible as vent plumes
  (strong, weak, none).
- **Weathering:** buildings in sooty cells get a darker material tint (a per-instance attribute), so old industrial
  districts look old.

### People

- They already wear hats and coats. Add soot-blackened faces and aprons for stokers and miners, goggles for engineers
  and galvanists, and breath vapour in the cold.
- When a guild strikes, its members gather at their Guild Hall with placards (a cheap, readable signal).

### HUD

- A **pressure gauge** cluster (exists), plus a **soot barometer** and a **wind vane**.
- **Guild standing** shown as four enamel badges.
- The Hollowmere chart is a parchment-and-brass overlay with an animated airship marker.

## Phased plan

Each phase is shippable on its own:

- bump `SAVE_VERSION` with a migration
- extend `ContentValidator`
- add sim tests (determinism, the save round trip)
- run the balance report before and after
- move the finished sections into GAME_DESIGN.md

### Phase 1: Soot & industrial amber (built)

Built:
- the soot field, wind and grime (save version 5)
- the `emitter`, `scrubber` and `clinic` components
- lung, crop, hunting and happiness effects
- the Black Lung and Rain Squall events
- the Apothecary (herbs → lung tonic) and the Galvanic Precipitator
- `sootRate` on difficulty presets
- ground and water grime, a colder palette, the amber smog sky
- wind-bent coal plumes and the amber/teal grade pass
- the soot barometer, wind vane and soot map

Deferred:
- **Stack Extension upgrade:** buildings have no upgrade mechanic yet. For now, stack heights are fixed per building.
- **Weathering tint:** building materials are shared and merged per material, so a per-building tint needs a vertex
  attribute.
- **Spoil tips:** slag heaps beside mines and smelters need a sim feature that grows over time.
- **Sun shafts, and furnace glow lighting the smoke from below.**

### Phase 2: Pressure is life (the core loop changes)

1. Conduit grades with `lossPerTile`, head propagation in `energy.ts`, Booster Pump, pressure overlay.
2. Water network, Pump House, Deep Well, boiler as water → steam converter, Steamforge cistern.
3. Every home type gets a full radiator `heatBonus` on a main, and firewood stays as the off-grid stove fuel. Coal
   Pit at founding, with a guaranteed coal outcrop near the start.
4. Food rework:
   - Remove the forager, berries and mushrooms. Keep the Hunter's Lodge, with soot reducing its catch.
   - Add rations, trawler, bakehouse, cannery and tractor shed.
   - Move the glasshouse to tier 1.
5. Re-tier research (piping at founding, Deep Mining for ore only). Rebalance difficulty presets' starting stock.
6. Save migration: demolish foragers with a refund, remove berry and mushroom features, and convert stored berries and
   mushrooms to rations. Bump `SAVE_VERSION` for each phase in turn.
7. Rewrite the balance autoplay build order and retune.

### Phase 3: Clockwork society

1. `guilds.json`, `guild` on professions, a monthly standing system with data-weighted factors.
2. Guild Hall buildings, work-to-rule/strike/sabotage effects, emigration.
3. Trade-assigned automatons. Move automatons to tier 3.
4. `petitions.json` and generalise the petition UI from travellers to guild petitions.
5. HUD guild badges and striker gatherings.

### Phase 4: The Lost Forges

1. `forges.json` (names, personas, fates, rewards), a seeded world chart, a `world` system for voyages.
2. Airship Yard, envelope silk, expedition crews (citizens away from the map but kept in the save).
3. Salvage-only research, relics as named effects.
4. Telegraph Office, contracts, evolving forge fates, and dispatches rewritten as correspondence.
5. The Hollowmere chart UI and the story arc.

## Decisions

1. **Firewood stays** as the stove fuel for homes off the steam grid, and radiators replace it as mains spread. Home
   stoves emit soot.
2. **Hunting stays.** The Hunter's Lodge keeps supplying venison and leather for coats, and soot reduces its catch.
   Foraging is removed.
3. **Story:** the three-act arc above. The charter is Act I, the Silent Forges Act II, and Pressure Creep with its
   retrofit or decommission choice Act III.
4. **Difficulty:** presets gain `sootRate` (Phase 1) and `guildTemperament` (Phase 3).
