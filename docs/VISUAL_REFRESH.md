# September 15 visual refresh

The road surface, edge lines and dashed centerline now use the same sampled ribbon. Paint is part of the asphalt texture, with UVs anchored to route distance, so it cannot drift away from the road on bends or jump when the next section loads. Camera height, shoulders and nearby props share the road frame. SIM elevation comes from the same route profile used by the ride engine. Distant terrain straightens its sampling rows to avoid folded triangles outside a bend.

The scene adds textured soil with two blended scales, mesquite foliage, agaves, grasses, rocks, delineator posts, timber fencing, softer daylight, atmospheric fog and a mountain backdrop. Object placement uses world coordinates and deterministic seeds. Instancing limits draw calls; low graphics quality reduces vegetation, terrain resolution, pixel ratio and rendering frequency. A stopped scene uses demand rendering. The scene waits for initial assets before the ride countdown.

The library now has large scene previews, route thumbnails, clearer selection and a responsive setup panel. Previews are captures of the actual renderer, and the library itself no longer runs WebGL. The ride HUD uses smaller panels and adds **Focus on the road** beside fullscreen. Focus hides secondary detail while keeping power, cadence, speed, slope, controller status and Pause/Stop available. Mobile retains controls and the slope panel. No trainer protocol, ride physics or FIT serialization changes were made in this refresh.

## Assets and budget

Research used Replicate's [current text-to-image collection](https://replicate.com/collections/text-to-image), [Imagen 4 Ultra](https://replicate.com/google/imagen-4-ultra), [Nano Banana Pro](https://replicate.com/google/nano-banana-pro), and [TRELLIS](https://replicate.com/firtoz/trellis). Image assets offered useful scenery detail without introducing unreviewed generated mesh topology. No 3D generation or Blender processing was needed.

Three 2K images were generated with **google/nano-banana-pro**, with model fallback disabled. The quoted price was **$0.15 each**, or **$0.45 estimated for the three successful outputs**. An earlier Imagen 4 Ultra request failed with an upstream model-not-found 404 and produced no image; its quoted output price was $0.06. Account billing was not inspected, so these figures are estimates rather than a verified invoice. No other paid generations were submitted; the authorized budget was $10.

| Asset                 | Runtime use                            | Processing                                                                         |
| --------------------- | -------------------------------------- | ---------------------------------------------------------------------------------- |
| `oaxaca-tree.png`     | Source only, outside `public`          | White-matte removal, color decontamination, alpha crop and 1536 px WebP conversion |
| `oaxaca-tree.webp`    | Instanced foliage cards                | Alpha-tested silhouette, rooted placement                                          |
| `valley-ground.jpg`   | Repeating ground texture               | Two rotated/scaled samples and broad vertex-color variation                        |
| `sierra-horizon.jpg`  | Distant mountain/sky background        | Cropped texture framing                                                            |
| `public/scenes/*.jpg` | Library hero and four route thumbnails | Local renderer captures, no additional AI generations                              |

Exact prompts are in `assets/requests/landscape.json`. Provider job IDs, statuses, output hashes and estimated prices are in `assets/receipts/`. Runtime scenery textures total approximately 2.9 MB, plus four preview JPEGs. Generated tree source is kept separately for reproducibility.

`token.txt` is ignored by Git and denied by the Vite development server. The credential is read only by the Docker-only development script, sent in the Replicate API Authorization header, and never imported by the app. The app loads all finished artwork locally and makes no runtime requests to Replicate. Generation receipts prevent blind resubmission after an uncertain paid request.

## Reproduce the visuals

Run with the development server already available inside the devcontainer:

```sh
docker compose -f .devcontainer/compose.yaml exec -T bikesim node scripts/prepare-textures.mjs
docker compose -f .devcontainer/compose.yaml exec -T bikesim node tests/visual/capture.mjs
```

The first command rebuilds the transparent tree from its preserved source without calling an AI service. The second refreshes the four committed thumbnails and captures desktop/mobile library, ride, focus and summary images in ignored `test-results/visual/`. It uses only an isolated demo browser, never the user's trainer connection. The fixed-distance scene harness is at `/tests/visual/scene.html?route=ascent&distance=2400&quality=high` during development; it is not a production entry point.

## Scope and verification

This remains procedural scenery inspired by Oaxaca, not a geographically mapped route. Mountains are a background image and trees are photographic cards, not fully volumetric scanned assets. The roads and nearby terrain/props are 3D. In particular, the background does not provide full parallax during turns. Real route data, terrain scans and more diverse volumetric vegetation remain future visual work.

Geometry regressions cover road width/orientation, shared elevation, streaming position/paint continuity, upward terrain normals, valid vertices and terrain clearance. Browser regressions cover local previews, narrow layouts, focus-mode control access and credential-file blocking, alongside existing ride, trainer and export workflows. Screenshots are inspected separately from numerical tests; software-rendered container captures do not establish frame rate on the rider's Mac or physical trainer behavior.

Final checks: **90 unit tests**, **24 browser workflows** across the suite and targeted reruns, default/pilot production builds, formatting and asset checksums pass. Initial browser failures exposed cold-start preparation assumptions, an incorrect test expectation that Stop immediately saves, and a still-running server configuration that had not applied the credential deny rule. The checks now distinguish preparation from countdown and follow the actual Stop/Finish flow; the restarted server explicitly refuses credential requests. No countdown duration, timing watchdog or trainer authorization was weakened.
