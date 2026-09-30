# The 3D world

How the ride scene is built (`src/scene`, `src/ride/course.ts`). Rewritten September 29, 2026; the September 15–16 version is in [history](history/VISUAL_REFRESH.md).

## One course for physics and scene

A `Course` is the road's world-space centerline and absolute elevation, sampled every 2 m, with a spatial grid for nearest-road queries. The engine reads grade from it, the trainer gets its SIM grade from it, and the scene draws it, so what you see, what you feel and how fast you go agree.

- **Real roads** follow their OpenStreetMap polyline through a Catmull-Rom spline ([real roads](REAL_ROADS.md)).
- **Practice roads** bend gently and take elevation from their grade profile.
- **Workouts** get an endless road. When each hard interval starts, the course predicts where you will be by simulating the target power from your current state, and raises a climb there. Each 200 m extension re-syncs that prediction; road already built never changes. ERG ignores this grade; it is for the eyes and the virtual speed.

Fast descents brake for sharp corners at about 0.35 g of cornering, looking 60 m ahead. Gentle procedural bends never limit speed.

## Terrain

- **Tiles.** 256 m world-space tiles in three detail levels: 4 m grid spacing for the tiles around the rider, 8 m out to three tiles, and 32 m out to six (about 1.7 km). Tiles build a few per frame within a time budget. A tile changing detail keeps its old mesh until the new one is ready, and skirts hide seams between levels.
- **Far ring.** From 1.5 km to 16 km, a ring re-centered every 700 m shows distant terrain in every direction: the coarse height grid on real roads, procedural sierra ranges elsewhere.
- **Road bed.** A cut-and-fill corridor flattens the ground under the road, its shoulders and a gravel edge strip, then blends back into natural terrain (at most 95 m out on steep hillsides), so coarse terrain never pokes through the shoulder.
- **Ground** uses a tiled soil texture tinted by slope, height and noise; the untextured far terrain is darkened to match it.

## Road, props and sky

- The road is a ribbon with lane paint in its texture, UVs anchored to route distance so paint never drifts on bends or when sections load.
- Instanced props, placed deterministically on the nearest two detail levels: crossed-card mesquite trees, organ-pipe cacti, agaves, grass, rocks, delineator posts and kilometer posts, with soft contact shadows on the ground triangles.
- A gradient sky dome with sun glow and slowly drifting clouds, plus exponential fog.

## Camera and motion

The ride ticks at 10 Hz; the scene never waits for it. Each frame extrapolates distance from the last tick's speed (`predictDistance`) and follows smoothly, so the camera moves evenly between physics updates. The camera rides the right lane at 1.55 m eye height, looks slightly down the road and leans a little into bends. A moving scene renders every display frame; a stopped one renders on demand.

## Graphics quality

**High** (default) renders at up to 1.5× device pixels with full near-terrain resolution and props. **Low** renders at 1× pixel ratio, halves near-terrain resolution and thins props. Change it in Settings → Display.

## Tools

With the dev server running in the container:

| Tool                                                                    | Purpose                                                                                    |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `/tests/visual/scene.html?route=monte-alban&distance=2400&quality=high` | Scene at a fixed road position, for inspection in a browser                                |
| `node tests/visual/probe.mjs <route> <meters> [quality]`                | Headless screenshot of that harness, with tile-streaming timings                           |
| `node tests/visual/capture.mjs [--previews]`                            | Screenshots of every page to `test-results/visual/`; `--previews` refreshes the road cards |

In development builds `window.__bikesimScene` exposes the live world, course and camera for debugging. Headless captures use software rendering, so they check layout and composition, not frame rate on the Mac's GPU.
