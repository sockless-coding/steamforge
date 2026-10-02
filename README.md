# SteamForge

A steampunk colony builder inspired by Banished. Lead a handful of families into a river valley and keep them alive
through the winters. Fell timber, quarry stone, sink mines, smelt iron and forge tools. Raise steam to power your
workshops and warm your homes.

- **3D world with an RTS camera.** Pan with WASD or a right-drag, rotate with Q/E or a middle-drag, zoom with the wheel.
  Touch is supported (pan, pinch and twist).
- **Pause and build.** Press Space to stop time. You can still place buildings, roads and fields, mark land for clearing
  and reassign workers. Nothing is built until time runs again. Speeds are ×1, ×2, ×5 and ×10.
- **Citizens are the economy.** There is no money. Families need homes, food variety, firewood, tools and coats. They
  marry, have children, age and die. Starvation and cold are the enemy.
- **Four difficulty presets:**
  - *Tinkerer*
  - *Engineer*
  - *Ironclad*
  - *Brass Inferno*

  They change your starting families and supplies, how harsh the winters are, how often disasters strike, production
  speed, birth rate, spoilage and wear.
- **Extensible.** Everything is JSON content, including every building's 3D model. New mechanics plug into
  component, effect, system and event registries. See [CLAUDE.md](CLAUDE.md) and
  [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md).

## Running locally

```bash
# Backend (SQLite) on http://localhost:5220
dotnet run --project src/SF.Application --launch-profile http

# Client on http://localhost:5173
cd src/SF.Client
npm install
npm run dev
```

You can also run `build-and-run.bat` to build the client into the server's `wwwroot` and serve everything from port
5220.

## Tests

```bash
dotnet test SF.slnx
cd src/SF.Client && npm run test
```

The client tests cover determinism, save and load continuity, pause and build, construction, survival, and a 10-year
scripted soak run.
