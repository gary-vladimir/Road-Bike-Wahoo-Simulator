# Implementation status and decisions

September 7, 2026. Implements the initial usable slice approved after review of both implementation plans.

## Useful additions adopted from IMPLEMENTATION_PLAN.md

- Per-interval ramp targets and a repeat-generated preset catalog.
- Current/next interval cues, target cadence, and a continuous power-profile strip.
- In-ride intensity adjustment within 80–110% of the configured workout.
- A dedicated trainer module and read-only diagnostics, separated from rendering and workout timing.
- Session event history and exports, local persistence, and phased hardware validation.
- Oaxaca-inspired procedural scenery before committing to real route data or expensive assets.

## Decisions resolved without further product questions

| Topic               | Decision                                                                                                                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transport           | Bluetooth first. Its browser API and standard FTMS service let us validate the actual trainer without introducing an unofficial TCP control protocol. Wi-Fi remains an allowed future option. |
| Runtime             | All package/build/test/server scripts in `.devcontainer`; frontend rendering and Bluetooth in the browser on this Mac.                                                                        |
| Stack               | React, TypeScript, Vite, Three.js/React Three Fiber, IndexedDB. No backend is necessary for this first browser-Bluetooth slice.                                                               |
| Workouts            | ERG-style power targets in demo; live-power riding provides guidance without controlling resistance.                                                                                          |
| Unknown FTP         | No invented rider FTP. A 200 W example is labeled in demo. Live workouts require a user-entered value in Settings.                                                                            |
| Unknown weight      | 75 kg is a disclosed virtual-speed assumption editable in Settings. It does not set trainer load.                                                                                             |
| Heart rate          | Decoder accepts FTMS heart-rate data if supplied; dedicated HR pairing/HUD remains deferred until relevant hardware is known.                                                                 |
| Strava              | Local JSON/CSV now; FIT/manual upload after hardware reliability. No automatic account connection.                                                                                            |
| Initial location    | An Oaxaca foothills-inspired environment, explicitly labeled procedural. No claim of geographic accuracy.                                                                                     |
| Other training apps | Do not close unrelated apps automatically. Detect and report pairing/control problems; a competing trainer controller must be resolved during hardware validation.                            |

ROUVY informed the library → workout detail → ride flow, editable interval duration/%FTP/cadence, and keeping power-target workouts distinct from route resistance. Sources: [ROUVY workouts](https://support.rouvy.com/hc/en-us/articles/33398875835921-Workouts-in-ROUVY), [ROUVY workout creator](https://rouvy.com/blog/how-to-create-a-workout), [ROUVY ERG switch](https://support.rouvy.com/hc/en-us/articles/40289751085201-ERG-Mode-Switch-for-Workouts).

## Corrections to the other plan

The proposed universal “safe state” was too strong: a crashed process or broken connection cannot reliably send a shutdown command, and SIM 0% is not inherently an unloaded physical stop. Neither the process watchdog nor a reset-on-exit can guarantee a resistance reduction. This release therefore contains no actual load-control write path. Future recovery behavior must be verified on the exact trainer, including failed writes and lost connections.

Capabilities and target ranges are discovered, not assumed from the model name. The other plan's opcode table is not treated as an executable specification. Before writes are implemented, verify byte widths, scaling, allowable modes, acknowledgements, and the chosen stop behavior against the Bluetooth SIG specification and actual device responses.

The Direct Connect description is community documentation, not an official guarantee of CORE 2 support or Docker discovery. Adding a backend solely for unverified Wi-Fi would delay a testable simulator. Bluetooth is the bounded first integration. Sources: [Chrome Web Bluetooth](https://developer.chrome.com/docs/capabilities/bluetooth), [Bluetooth SIG FTMS](https://www.bluetooth.com/specifications/specs/fitness-machine-service-1-0/), [community Direct Connect documentation](https://github.com/elfrances/wahoo-fitness-tnp).

## Delivered

- Reproducible Docker Compose-backed devcontainer; localhost-only port 5186.
- Workout studio with eight presets covering all seven first-release categories.
- Custom workout copies, ramp endpoints, duration/cadence editing, and interval add/remove.
- Demo ride with countdown, stable first-person scene, live HUD, virtual speed/distance, current/next block, intensity adjustment, and pause/stop/resume.
- Read-only FTMS Bluetooth adapter with optional feature/range discovery, strict packet parsing, per-field freshness, and diagnostics export.
- Live-power ride mode with fresh-power/FTP prerequisites and no hardware writes.
- Session checkpointing every five seconds, history, interrupted-session recognition, summaries, CSV/JSON downloads, and versioned backup/import.
- Settings for FTP, virtual rider mass, and graphics quality.
- Unit tests and container browser workflow tests.

## Still gated or deferred

- **Actual KICKR validation:** requires selecting the device and pedaling on this Mac. No synthetic fixture proves physical device behavior.
- **Automatic ERG/SIM:** not implemented or enabled; implement and fault-test the control supervisor before a supervised low-load test.
- **Wi-Fi:** not implemented; no trainer IP or LAN-wide scanning performed.
- **Performance:** software-rendered container checks do not establish 60 fps on the actual Mac/external display.
- **Route realism:** procedural landscape only. Real route geometry/elevation, GPX, licensed terrain, and Blender assets remain later milestones.
- **Data features:** FIT, normalized power/TSS, automatic Strava upload, and advanced training families remain deferred.
- **WebMCP:** optional read-only workout catalog registration is included; native WebMCP availability is browser-dependent and has not been verified in a supported agent context.

Periodic checkpoints currently save a complete session snapshot; chunked recording is a future optimization if long-ride storage measurements justify it. On storage failures, the ride displays an error and provides a downloadable summary. An abrupt closure can lose the samples since the last successful checkpoint.

## Verification completed

The 23 unit tests pass, covering FTMS parsing, the no-control-write adapter boundary, connection cleanup, interval boundaries/ramps, pause/resume, stale power, a six-hour simulated ride, IndexedDB round-trip, interrupted-session recovery, and atomic backup validation. All four browser workflows pass: custom workout persistence, full countdown/pause/resume/finish/history, settings/backup, and narrow-screen controls. TypeScript, production build, and formatting checks pass.

Initial scene compilation now precedes the workout countdown. Idle scenes stop continuously rendering; low graphics mode reduces resolution/detail/frame rate and removes backdrop blur. These changes allow the complete ride workflow to pass in software-rendered container Chromium without loosening the timing-fault guard. Local Chrome visual review also found and corrected overlapping road-surface layers.

## Next implementation step

Complete HT-1 in `HARDWARE_TESTS.md`. Use its actual capabilities and observations to implement a mock-tested, serialized, bounded control supervisor and protocol acknowledgements. Keep control unavailable until HT-2 confirms low-load behavior with the rider present. Then integrate validated ERG into the existing workout engine; retain read-only and demo as explicit alternatives.
