# Deadzone Command — browser RTS prototype

A **single-player pixel-art RTS prototype** inspired by classic base-building strategy games. You control a human military outpost, escort survivors, rebuild a settlement, and research an infection cure while defending against raiders and roaming zombies.

This is an original prototype, **not a Command & Conquer / Red Alert derivative using their characters or assets**. All graphics are generated at runtime with Phaser primitives; no game assets or external API keys are needed. A Google Fonts import is optional and falls back to system fonts.

## Run locally

Requires Node.js 20.19+ or 22.12+ and npm.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Use `npm run build` for the production output in `dist/` and `npm run preview` to check the production build.

## Deploy to Vercel

1. Push this folder as a repository to GitHub.
2. Import the repository in Vercel; framework preset **Vite**.
3. Build command: `npm run build`.
4. Output directory: `dist`.
5. Deploy. No server, database, environment variables, or serverless functions are needed for this prototype.

## Gameplay

- **Start New Operation:** enter a map seed, or randomize it. The seed chooses Forest, Coastal, Islands, or Downtown and recreates the same terrain, bases, and survivor camps.
- **Left click** a friendly unit/building to select; **left-drag** selects several units.
- **Right click** a destination to move selected units, or right-click a visible enemy to attack it.
- **WASD / arrow keys:** pan the camera; **mouse wheel:** zoom; **Space:** return to the home base.
- **Construct:** choose a building on the right panel, click clear grass/sand near your base (within 10 tiles of a friendly structure). Right-click or **Esc** to cancel placement.
- **Produce:** queue infantry in Barracks, armor in War Factory.
- **Research:** build a Research Institute for infantry/defense upgrades, and a Vehicle Garage for vehicle research and nearby vehicle repairs. Research is global to your army and consumes time/resources.
- **Save:** serializes game state into browser `localStorage`; the main menu offers **Continue Saved Operation**.
- **P** pauses or resumes the game.

### Systems included

- Four procedurally generated 82x58 battlefields feature forest clearings, river and coastal crossings, bridged islands, or downtown streets and ruined blocks.
- Friendly construction system: HQ, Barracks, Power Plants, Scrap Yards, Oil Refineries, Farms, War Factory, Research Institute, Vehicle Garage, Armory, Guard Towers, Walls, Radar, Hospital, Workshop, Depot, and Academy.
- Resource economy (scrap, oil, food) and generated/consumed electricity. Workshops, hospitals and income buildings function on a timed tick.
- Friendly units: riflemen, heavy gunners, snipers, APCs, tanks. Raider riflemen and technicals. Infected walkers, runners, and brutes.
- Grid A* pathfinding, targeting, shooting, unit health, veterancy, multiple-unit selection, raider reinforcement waves, zombie roaming.
- Two defended raider compounds that send attacks toward your headquarters; zombies can attack raiders or humans.
- Fog-of-war with exploration, minimap, unit and base indicators, tactical command panel, structure levels, two research tracks (institute and garage).
- Restore Humanity by escorting 24 survivors to your HQ, running a powered Food Farm and Field Hospital, and completing Infection Cure research at a Research Institute. You lose if your HQ is destroyed.

### Scope and limitations

This is a playable **vertical slice**, not a finished commercial RTS. Sprite art is simple generated pixel art. Enemy strategy is basic; there is no sophisticated base rebuilding, full campaign, multiplayer, air/naval systems, vehicle passenger transport, sound design, or PvP. Resources are produced passively by built structures; dedicated resource-hauling vehicles have not been implemented. The minimap shows units and explored terrain, but does not draw the camera viewport. Saves are local to the current browser and are not synchronized across devices. Unit orders do not persist in a saved game (units resume from saved positions).

### Project layout

- `src/game/model.ts` — entity definitions, prices, stats and research
- `src/game/map.ts` — deterministic map generation and A* pathfinding
- `src/game/RtsScene.ts` — Phaser world, combat, simulation, rendering and save/load
- `src/game/bridge.ts` — React/Phaser command and UI snapshot bridge
- `src/App.tsx` — menus, sidebar, minimap, HUD
- `src/styles.css` — responsive UI styling

No changes are made to any existing local repositories.
