# SteamForge

Victorian-steampunk survival city builder in the spirit of Banished, rendered in 3D (Three.js) with an RTS camera, installable as a PWA. The design lives in [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md); read it before feature work and keep it in sync.

## Standing rules

- **Content is data.** Resources, nature features, buildings (including their 3D models), recipes, crops, professions, events, difficulty presets, map generation, energy networks (`rules.json`), research and the story are JSON under `src/SF.Application/Content/`. The server merges content packs (`Content/packs/<pack>/<kind>.json`, merged by `id`), validates everything with `ContentValidator` (startup fails on invalid content), stores it in `ContentDocuments`, and serves it verbatim at `GET /api/content` with an ETag.
- **The simulation is deterministic.** `src/SF.Client/src/game/sim` is pure TypeScript with no DOM: never use `Math.random` or the wall clock there, iterate in insertion order, and draw all randomness from `sim.rng`. Rendering and audio may use `Math.random` freely.
- **Pause and build.** Every player command goes through `Simulation.perform(action)` and is valid while paused; placements create construction sites that only progress while time runs. Do not add commands that bypass `perform`.
- **The renderer only reads.** `game/render` never mutates simulation state. It reacts to `SimEvent`s and re-reads state every frame.
- **Saves are snapshots.** `sim.serialize()` produces versioned JSON (gzip + base64 on the wire). `Simulation.deserialize` must reproduce the exact same future; derived caches are rebuilt via system `restore()` hooks, never by advancing time. Bump `SAVE_VERSION` when the snapshot shape changes.
- **Vertical Slice Architecture** in the backend: `Features/<Slice>/{Commands,Queries,Dtos,Validators,Endpoints,Entities}`, one namespace per slice, handlers implement `IHandler` and return `Result<T>`, endpoint modules implement `IEndpointModule` (both auto-registered). No repositories, no MediatR; FluentValidation on every request. Add entities as `DbSet`s on `AppDbContext` and run `scripts/add-migration.sh <Name>` (creates SQLite and Postgres migrations).
- **Visual bar:** procedural, warm steampunk art (brass, copper, brick, steam). No image assets, no placeholder primitives in finished content.

## Extending the game

- **New building**: add it to `buildings.json` (size, cost, components, model parts). No code needed if it uses existing component kinds. Lock it behind research by listing it in a `research.json` item's `unlocks`; make it need energy with a `consumer` component (`required`, `workBonus` or `heatBonus`).
- **New research / dispatch**: data only (`research.json`, `story.json`); the validator checks references and requirement cycles.
- **New energy network**: add it to `rules.json` → `networks` (max 8; a converter's input network must come first), then use it in `generator`/`consumer` components.
- **New mechanic**: write a component handler in `game/sim/components/` (`registerComponent`), import it in `components/index.ts`, add the kind to `ContentValidator.ComponentKinds`, then use it in content. Handlers can add named effects (`registerEffect`) for task steps.
- **New global system**: `registerSystem` in `game/sim/systems.ts` (tick / second / month / restore hooks).
- **New event/disaster**: `registerEvent` in `game/sim/events.ts`, add the kind to `ContentValidator.EventKinds`, then add an entry to `events.json`.
- **New difficulty preset / map type**: data only (`difficulty.json`, `mapgen.json`).

## Stack

- Backend: ASP.NET Core 10, C#, EF Core (PostgreSQL in production, SQLite for local dev), OpenTelemetry.
- Frontend: TypeScript, React 19, Vite 8, Three.js (WebGL, PCF shadows, bloom on high tiers), zustand, TanStack Query, vite-plugin-pwa.

## Layout

```
SF.slnx
src/SF.Application/          ASP.NET Core host + Content/*.json
src/SF.Client/               Vite + React + Three.js client
  src/game/sim/              deterministic simulation (+ Vitest tests)
  src/game/render/           Three.js world renderer
  src/game/GameController.ts loop, input tools, HUD bridge, autosave
tests/SF.Application.Tests/  xUnit integration tests
docs/GAME_DESIGN.md          specification
```

## Commands

- Backend build/test: `dotnet build SF.slnx`, `dotnet test SF.slnx`
- Backend run (SQLite, http://localhost:5220): `dotnet run --project src/SF.Application --launch-profile http`
- Client (in `src/SF.Client`): `npm install`, `npm run dev` (http://localhost:5173, proxies `/api` to 5220), `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`
- Visual review: `npm run dev`, then `/dev/sandbox?difficulty=engineer&seed=42&size=small&terrain=valley`. In dev builds the controller is exposed as `window.steamforge`, and `await window.steamforgeShowcase()` fills the map with one of every building. `/dev/models` shows every building model (`?id=<building>` for one, `&still=1` to stop turning).
- One-step local build: `build-and-run.bat`. Docker: `docker compose up` (needs `POSTGRES_PASSWORD`, `JWT_SIGNING_KEY`).
