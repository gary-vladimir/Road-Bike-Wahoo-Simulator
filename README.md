# BikeSIM

A private, local cycling simulator for one rider: a Giant Contend AR 1 on a Wahoo KICKR CORE 2, training for triathlon in Oaxaca. Ride real Oaxaca roads in 3D with the trainer following the terrain, or follow structured workouts with the trainer holding your watts. Everything runs in Chrome on this Mac; rides stay in the browser and export to Strava as FIT files.

## Quick start (Docker only)

Docker Desktop must be running. Node and npm run only inside the devcontainer.

```sh
docker compose -f .devcontainer/compose.yaml up -d --build
docker compose -f .devcontainer/compose.yaml exec bikesim npm ci
docker compose -f .devcontainer/compose.yaml exec bikesim npm run dev
```

Open <http://localhost:5186> in Chrome. The port is bound to `127.0.0.1` only. Keep using the same browser profile and URL: that is where your rides and settings live.

Editors with Dev Containers support can instead **Reopen in Container** and run `npm run dev` in its terminal.

## What you can ride

**Real Oaxaca roads.** Built from OpenStreetMap and SRTM elevation, with the real terrain around them and a live map in the ride screen ([how they are made](docs/REAL_ROADS.md)).

| Road                | Distance | Climb  | Steepest | Character                                            |
| ------------------- | -------- | ------ | -------- | ---------------------------------------------------- |
| Monte Albán         | 10.6 km  | +388 m | 13.9%    | From the Zócalo up the Carretera Ramal to the ruins  |
| San Felipe del Agua | 6.0 km   | +151 m | 6.7%     | Steady climb from El Llano into the sierra foothills |
| El Tule to Mitla    | 34.5 km  | +363 m | 8.7%     | Long valley road past Tlacolula; endurance miles     |
| Teotitlán del Valle | 3.7 km   | +81 m  | 6.4%     | Short, gentle rise toward the weaving village        |

**Practice roads.** Valley warm-up (3 km), Rolling foothills (6 km), Descent to the valley (2 km, for feeling coasting and momentum) and The steady ascent (5 km).

**Workouts.** 25 presets across recovery, endurance, tempo, sweet spot, threshold, VO2max, anaerobic, hills, torque, cadence and race pace, drawn from [cycling_presets.md](cycling_presets.md). Each shows planned TSS and IF and how relevant it is to triathlon; the Ride page suggests one for today. Customize any preset into your own copy. Workouts ride on their own generated road that climbs where the hard intervals are.

**FTP ramp test.** Workouts → **Take an FTP test** (with trainer control on) estimates FTP as 75% of your best measured minute and saves it to Settings ([protocol](docs/FTP_ASSESSMENT.md)).

Every ride source can be:

- **Demo**: a simulated rider with an effort slider, for trying things without the bike.
- **Live power**: real KICKR power drives the ride; the trainer's load is left alone.
- **Trainer sets the slope / holds the watts**: BikeSIM controls the KICKR (see below).

During a ride, Space or Esc pauses (resuming is always a click), ↑/↓ change workout intensity (80–110%) or demo effort, the eye button hides everything but the essentials, and the speaker button mutes the countdown and interval cues. The summary shows normalized power, IF, TSS and time in zones when your FTP is known; History adds 7- and 28-day totals.

## Riding with the KICKR

**Pair.** Click **Pair your KICKR** at the top right, then **Pair KICKR via Bluetooth**, pick the KICKR in Chrome's chooser and pedal. Pairing only reads power, cadence and speed; it never changes the load. A page refresh restores the telemetry connection when Chrome allows it; otherwise pair again.

**Let BikeSIM control the load.** In **Settings → Trainer**, turn on **Let BikeSIM control my KICKR**. It is off by default, a backup import never turns it on, and even when it is on the load only changes during a ride you start:

| During a controlled ride              | Road (SIM)                                                   | Workout (ERG)                                                                |
| ------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Start                                 | Flat road before the countdown                               | 50 W once you pedal above 50 rpm                                             |
| Riding                                | Road slope × trainer difficulty; you shift as outdoors       | Interval targets, rising at most 25 W per second                             |
| Stop pedaling                         | Coasting is fine; gravity still moves you downhill on screen | After 3 s below 50 rpm it eases to 50 W; spin above 55 rpm for 2 s to return |
| Pause (button, Space/Esc, hidden tab) | Holds a flat road                                            | Holds 50 W                                                                   |
| Finish                                | Leaves the trainer on a flat road                            | Leaves the trainer on a flat road                                            |
| Connection or command fault           | Tries FTMS Stop, pauses the ride and explains                | Same                                                                         |

BikeSIM never sends FTMS Stop in normal riding, because Stop hands the KICKR back to its own default load, which feels heavier. **Trainer difficulty** (default 100%) scales only what your legs feel on hills; the screen and your virtual speed always use the real grade. The trainer slope stays within −10% to +12%, so Monte Albán's 13.9% ramp feels like 12%.

Before the first controlled ride: in the Wahoo app, set the same rider weight and wheel size as BikeSIM's Settings (the KICKR uses its own profile in SIM), then close the Wahoo app, Zwift and anything else that controls the trainer. For ERG, Wahoo recommends the small chainring and a middle cog. The trainer page (the same top-right chip) has a manual check for feeling small slope or power changes and comparing the two ways to end control. Details, safeguards and the pending hardware checklist: [trainer control](docs/TRAINER_CONTROL.md).

## Physics

Virtual speed comes from measured power and road forces, never from the trainer's flywheel or your gearing: gravity and rolling resistance for your weight plus the bike, aerodynamic drag for your riding position in Oaxaca's thinner air (about 1,550 m), and wheel inertia. Coasting keeps momentum, gains speed down real descents and slows on climbs; riders brake for hairpins. See [road physics](docs/ROAD_PHYSICS.md).

## Strava

Finish a ride, click **Download FIT for Strava**, then **Open Strava file upload** and choose the file. Real roads export as virtual rides with the road's positions and elevation, so Strava draws the map without putting you on real-world segments; practice roads and workouts export as indoor rides. Nothing is uploaded automatically. See [FIT export](docs/STRAVA_EXPORT.md).

## Development

All commands run in the container, for example `docker compose -f .devcontainer/compose.yaml exec bikesim npm test`.

| Command                              | What it checks                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| `npm run typecheck`                  | TypeScript                                                                                    |
| `npm test`                           | Unit tests: physics, trainer session, course, terrain, FIT, storage, workouts                 |
| `npm run test:browser`               | Playwright workflows against the running dev server, with a synthetic KICKR                   |
| `npm run format:check`               | Prettier                                                                                      |
| `npm run build`                      | Production build                                                                              |
| `node tests/visual/capture.mjs`      | Screenshots of every page into `test-results/visual/` (`--previews` refreshes the road cards) |
| `node scripts/build-routes.mjs [id]` | Rebuilds real roads from OpenStreetMap and SRTM (needs internet)                              |

Install Playwright's browser once with `npx playwright install --with-deps chromium`. Tests use synthetic Bluetooth and software rendering; they do not prove GPU frame rate, physical resistance or real Bluetooth behavior.

Code map: `src/ride` (engine, physics, course, roads, workouts on the trainer, FTP test), `src/trainer` (Web Bluetooth, FTMS encoding, the control session), `src/scene` (terrain tiles, road, props, sky), `src/pages` and `src/ui` (interface), `src/export` (FIT), `src/storage` (IndexedDB). How the 3D world is built: [scene](docs/SCENE.md).

## Data and privacy

No accounts, analytics, CDNs or remote fonts; after setup the app works offline. Rides, workouts, settings and FTP tests live in this browser profile's IndexedDB (not encrypted). Download a backup from Settings before clearing browser data or switching browsers. A ride interrupted by a refresh is saved as interrupted and never restarts on its own.

## Credits

- Road geometry © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL), routed with [OSRM](https://project-osrm.org/).
- Elevation from [Mapzen Terrain Tiles on AWS](https://registry.opendata.aws/terrain-tiles/) (SRTM and other public sources).
- Barlow and Barlow Condensed fonts by Jeremy Tribby (SIL Open Font License), bundled.
- FIT encoding with Garmin's [FIT JavaScript SDK](https://github.com/garmin/fit-javascript-sdk).
- Ground and tree textures generated for this project; prompts and receipts are in `assets/` ([history](docs/history/VISUAL_REFRESH.md)).

Project history, decisions and hardware findings: [implementation status](docs/IMPLEMENTATION_STATUS.md) and [hardware log](docs/HARDWARE_TESTS.md).
