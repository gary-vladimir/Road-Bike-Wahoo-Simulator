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

The proposed universal “safe state” was too strong: a crashed process or broken connection cannot reliably send a shutdown command, and SIM 0% is not inherently an unloaded physical stop. Neither the process watchdog nor a reset-on-exit can guarantee a resistance reduction. Control therefore remains disabled by default; a separate opt-in, explicitly armed diagnostic pilot supports only bounded ERG testing. Recovery behavior must be verified on the exact trainer, including failed writes and lost connections.

Capabilities and target ranges are discovered, not assumed from the model name. The other plan's opcode table is not treated as an executable specification. Standard ERG pilot payloads and responses have been checked against protocol documentation; actual acknowledgements and stop behavior remain the HT-2 gate.

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
- Opt-in supervised 50–100 W ERG pilot with serialized acknowledged commands, browser-tab ownership, cadence/freshness/timing guards, gradual target changes, stop priority, and an exportable audit log. No automatic workout control.

## Still gated or deferred

- **Actual KICKR validation:** read-only pairing and pedaling confirmed on this Mac. Reconnect/fault and physical load responses still require hardware observations.
- **Automatic ERG/SIM:** not implemented or enabled; the separate low-load ERG pilot is ready for supervised HT-2. SIM remains deferred.
- **Wi-Fi:** not implemented; no trainer IP or LAN-wide scanning performed.
- **Performance:** software-rendered container checks do not establish 60 fps on the actual Mac/external display.
- **Route realism:** procedural landscape only. Real route geometry/elevation, GPX, licensed terrain, and Blender assets remain later milestones.
- **Data features:** FIT, normalized power/TSS, automatic Strava upload, and advanced training families remain deferred.
- **WebMCP:** optional read-only workout catalog registration is included; native WebMCP availability is browser-dependent and has not been verified in a supported agent context.

Periodic checkpoints currently save a complete session snapshot; chunked recording is a future optimization if long-ride storage measurements justify it. On storage failures, the ride displays an error and provides a downloadable summary. An abrupt closure can lose the samples since the last successful checkpoint.

## Verification completed

The 45 unit tests pass, covering FTMS parsing, the no-control-write pairing boundary, connection cleanup, interval boundaries/ramps, pause/resume, stale power, a six-hour simulated ride, IndexedDB round-trip, interrupted-session recovery, atomic backup validation, serialized command acknowledgements, refusal/timeouts, stalled writes, ramp limits, exclusive pilot ownership, visibility loss, and asynchronous stop cleanup. Regressions cover starting at zero cadence, cancellation/retry without disconnection, failed preparation, unsupported saved permissions, and cancelled reconnection. Nine browser workflows pass: the four simulator/storage/layout workflows plus five synthetic-GATT control/reconnection workflows. These cover readiness, 50→75 W ramp, Stop/audit export, zero-cadence waiting/retry, telemetry-only refresh restoration, deliberate disconnect/reconnect, and cancellation during preparation. TypeScript and production builds pass; formatting is checked before commit.

The original pilot's initial low-cadence rejection incorrectly disconnected the actual trainer and stranded the Stop button. That lifecycle is corrected; HT-2 documents the evidence and retest. Full-refresh reconnection is browser-dependent: this Mac's Chrome did not restore saved permission during the real check, so the explicit Pair fallback is still required here. No claim of seamless physical reconnection or verified load response is made.

Initial scene compilation now precedes the workout countdown. Idle scenes stop continuously rendering; low graphics mode reduces resolution/detail/frame rate and removes backdrop blur. These changes allow the complete ride workflow to pass in software-rendered container Chromium without loosening the timing-fault guard. Local Chrome visual review also found and corrected overlapping road-surface layers.

## Next implementation step

Establish the comfortable baseline described in `TRAINER_SETUP.md` before repeating HT-2. Record actual acknowledgements and physical resistance/stop feedback. The rider clarified that normal riding must preserve outdoor-style physical shifting: prioritize a separately validated SIM/terrain mode for that experience, with ERG retained as an explicit power-workout option. Neither mode should assume that the trainer begins unloaded.
