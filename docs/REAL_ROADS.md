# Real Oaxaca roads

Four real roads ship with the app: Monte Albán, San Felipe del Agua, El Tule to Mitla and Teotitlán del Valle. `scripts/build-routes.mjs` built them once inside the devcontainer from public map and elevation data. The app then rides them fully offline.

## How a road is built

1. **Route.** Each catalog entry is a few waypoints (latitude, longitude). The public [OSRM](https://project-osrm.org/) demo server routes them over OpenStreetMap roads. Monte Albán has a waypoint on the modern Carretera Ramal so the route does not take the much steeper old road up the east face.
2. **Centerline.** The route is projected to local meters around its start (x east, z south), resampled every 10 m and eased to remove digitizing kinks.
3. **Elevation.** Heights come from [Terrarium tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen/Tilezen on AWS, mostly SRTM around Oaxaca) at zoom 14, sampled bilinearly. Tiles are cached in `.cache/terrain/` (ignored by Git).
4. **Road profile.** A DEM sees the hillside where a road cuts across a slope or winds through switchbacks, so a raw profile overstates ramps (Monte Albán showed 27.7% over 100 m). The builder median-filters spikes, smooths over about 60 m and then applies a forward/backward grade limiter (14% by default) that keeps both ends and the total climb. Monte Albán's steepest 100 m became 13.9%. Grades are stored every 20 m.
5. **Terrain.** A detailed grid (25 m spacing, 2.2 km around the road, zoom 14) and a coarse grid (160 m spacing, 17 km around it, zoom 11) are written to `public/routes/<id>-near.bin` and `-far.bin` as little-endian uint16 (`height = offset + value × 0.1 m`).
6. **Route data.** `src/ride/routes/<id>.json` holds the name, description, attribution, origin, start elevation, 10 m path, 20 m grade profile, grid descriptors and a summary (distance, climb, top, steepest 100 m).

| Road                | Distance | Climb  | Top     | Steepest 100 m |
| ------------------- | -------- | ------ | ------- | -------------- |
| Monte Albán         | 10.6 km  | +388 m | 1,898 m | 13.9%          |
| San Felipe del Agua | 6.0 km   | +151 m | 1,700 m | 6.7%           |
| El Tule to Mitla    | 34.5 km  | +363 m | 1,699 m | 8.7%           |
| Teotitlán del Valle | 3.7 km   | +81 m  | 1,682 m | 6.4%           |

Rebuild one or all roads (network access required; results are deterministic for the same upstream data):

```sh
docker compose -f .devcontainer/compose.yaml exec bikesim node scripts/build-routes.mjs monte-alban
docker compose -f .devcontainer/compose.yaml exec bikesim node tests/visual/capture.mjs --previews
```

The second command refreshes the road card images in `public/scenes/`. To add a road, append a catalog entry with waypoints (and a `cap` if its real ramps exceed 14%), build it, import its JSON in `src/ride/catalog.ts` and add it to `tests/unit/roads.test.ts`.

## In the app

- **Validation.** `validateRoute` checks every profile and path, and accepts only terrain files named like BikeSIM's own `<id>-near.bin` / `<id>-far.bin`, so imported data cannot point the app elsewhere.
- **Course.** The ride engine and the 3D scene share one course: the road polyline through a Catmull-Rom spline, sampled every 2 m with absolute elevation. Physics grade, the trainer's SIM grade, the camera and the scenery all read the same road.
- **Terrain.** Before the countdown, the ride loads both grids and blends them: the detailed grid near the road, fading into the coarse grid at its edge, with ±1.2 m of procedural detail. Past the detailed terrain tiles, a far ring draws the coarse grid's real mountains out to 16 km. The road sits in a cut-and-fill corridor so terrain never covers it.
- **Air.** The road's real starting altitude sets air density for the ride.
- **Map.** The Ride page shows a north-up map of the road with credits. The ride screen shows your position on it.
- **Strava.** Rides on real roads export as FIT virtual rides with latitude, longitude and altitude along the road geometry (never a recorded GPS track). Strava draws the map and counts the climb, and virtual rides stay off real-world segment leaderboards. See [FIT export](STRAVA_EXPORT.md).

## Limits

- SRTM has about 30 m resolution and predates some road cuts, bridges and new construction. Smoothing makes the profile realistic to ride, not surveyed. Expect the feel of the climb, not every exact meter.
- The road follows OpenStreetMap's centerline. Roadside scenery (cacti, agaves, mesquite, fences, kilometer posts) is procedural, not a model of the real buildings or landmarks.
- Trainer slope stays within −10% to +12% ([trainer control](TRAINER_CONTROL.md)), so short ramps above 12% feel capped on the bike while the screen shows the real grade.

## Attribution

Road geometry © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under the Open Database License, routed with OSRM. Elevation: Mapzen Terrain Tiles on AWS Open Data, derived from SRTM (NASA) and other public sources. The app shows this attribution with every real road.
