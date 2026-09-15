# Implementation status and decisions

## September 15 — road visuals and interface refresh

Road paint now shares the asphalt UVs and remains aligned through bends, hills and streamed section replacements. SIM scenery follows route elevation; near-road frames and distant terrain sampling prevent mesh folds. Textured ground, mesquite foliage, agaves, grass, fencing, delineators and a mountain background replace the earlier primitive landscape. The route library uses actual scene thumbnails, clearer selection and a responsive setup panel. A compact ride HUD adds an optional road-focus view while retaining metrics, controller status and Pause/Stop.

Three Nano Banana Pro assets were generated through Replicate at an estimated $0.45 total; an earlier Imagen request failed without an output. Assets ship locally, and the generation credential is excluded from Git and blocked by the development server. All generation and processing scripts ran inside Docker. See [asset receipts, reproduction steps and visual limitations](VISUAL_REFRESH.md). This visual work does not change trainer control authorization, physics, export behavior or outstanding hardware validation.

Verification: 90 unit tests pass. All 24 browser workflows passed across the full suite and a nine-test rerun covering corrected checks. Cold software-renderer preparation is now awaited separately from the ten-second countdown; the countdown and runtime watchdog were not relaxed. The focus test now follows the existing Stop → paused → Finish & save flow. A stale running Vite configuration initially left the local credential URL readable; the server was restarted with an explicit deny middleware, the request trace was removed, and direct/encoded/raw-import requests now return 403. Default and pilot production builds, formatting, asset checksums and whitespace checks pass. The existing large Three.js bundle warning remains. Desktop/mobile and all four route previews were visually reviewed; no physical trainer commands were sent.

## September 12 — bounded automatic SIM road integration

The opt-in control build now offers **KICKR · automatic SIM terrain** on Ride. Valley warm-up stays within the already tested slope range. Steeper routes remain previews; the app rejects unsupported control routes rather than clamping physical slope while showing a different hill. The shared SIM adapter retains ±1% authorization, quarter-percentage-point ramps, fresh-power guards, exclusive browser ownership, and acknowledged command serialization. No ERG targets are sent.

Startup waits for controller readiness before the countdown advances. Pause/Stop, visibility loss, and control faults end control; pending preparation is cancellable. Resume deliberately creates a fresh session after shutdown completes. Finish waits for shutdown and saving before opening the summary. Zero-watt/zero-cadence telemetry remains valid for coasting. Saved sessions identify SIM control and include acknowledged slope/state changes and stop outcomes in their events; FIT remains a manual activity export.

The rider's next check is a complete controlled Valley warm-up ride, including pause/resume, coasting/re-engagement, Stop behavior and manual FIT import. SIM slope response is already confirmed; complete lifecycle behavior is not. ERG tracking remains unresolved and does not block this SIM check. The default build still disables all trainer control.

Verification: 87 unit tests pass. All 21 browser workflows passed across the suite and targeted reruns. The first suite found an outdated preview-copy assertion and one demo timing-watchdog pause while builds ran concurrently; the assertion was updated and the isolated rerun passed without relaxing the watchdog. Default and opt-in production builds, formatting, and whitespace checks pass. The existing large Three.js bundle warning remains. Visual inspection confirmed the controlled-ride HUD. These checks used synthetic hardware only. The ERG table now says “Power/Cadence after 10 s” instead of implying that its averaging window proves settling.

## September 11 — physical SIM response confirmed

The rider completed BikeSIM's manual SIM slope check and reports clear, realistic resistance changes. This clears the slope-response prerequisite for implementing full route control; restart/fault behavior and complete controlled rides still need verification. ERG remains separate: the latest capture shows acknowledged commands, repeated near-target power mixed with lower readings, and another cadence-zero-triggered Stop. See the current [hardware findings](HARDWARE_TESTS.md). Repeating ERG is not required before progressing with SIM riding. Historical “SIM response pending” statements below are superseded by this observation.

## September 11 — manual Strava export delivered

Completed/stopped and recovered saved rides now expose **Download FIT for Strava** on the summary, including through history. The file is generated locally using Garmin's official FIT SDK; the rider manually imports it through Strava's file-upload page. No account integration or automatic upload is needed. Files preserve power/cadence, virtual speed/distance, and new per-record UTC timestamps/timer events so pauses are excluded from active duration. Older rides use their recorded active timeline with a visible limitation; demo data is explicitly labeled. See [export details](STRAVA_EXPORT.md). This supersedes the historical FIT deferral below.

## September 10 delivery — current status

This update supersedes conflicting September 9 details retained below as implementation history.

- **Confirmed profile:** 70 kg rider and 700×32C stock tubeless tires. Settings now supports tire dimensions and circumference; 2155 mm circumference and 9 kg bike mass are disclosed estimates. Existing custom settings are preserved; this Mac's Chrome profile was explicitly saved with the confirmed values.
- **Four routes and improved physics:** the new downhill-start route demonstrates gravity immediately. Zero watts/cadence can accelerate downhill and accumulate distance, while flat/uphill coasting slows gradually. Integration resolves stopping without phantom distance, samples terrain along the path, and preserves motion across update rates. The scene follows engine distance. [Assumptions and verification](ROAD_PHYSICS.md).
- **Real SIM adapter implemented:** the opt-in Trainer panel has a separate ±1% SIM test, using quarter-percentage-point ramps at most once per second, fresh-power checks with zero cadence allowed, explicit readiness, shared ERG/SIM browser ownership, and acknowledged Stop/cancellation/fault handling. It sends no ERG watt targets. Evidence includes slope commands, observations, and confirmed app profile.
- **Wahoo SIM confirmed by the rider:** slope changes feel realistic and physical shifting works. BikeSIM SIM response is not yet physically verified; no actual trainer control was sent during this development. Full route resistance remains disabled pending [HT-3](HARDWARE_TESTS.md).
- **Profile boundary:** FTMS SIM has no mass/tire-size field. App settings do not rewrite Wahoo's profile; readiness requires matching profile and comfortable baseline confirmation. Exported values are not trainer readback. Cross-app persistence remains a physical check.
- **Checks:** 73 unit tests pass, including analytical downhill terminal speed, gradual uphill stopping, mass/update-rate behavior, fresh-zero live coasting, wheel storage/imports, SIM lifecycle and existing six-hour soak. Browser checks cover editable profile persistence, visible zero-watt downhill distance, synthetic SIM slope/Stop commands, and existing ERG/reconnect/road/workout flows. These are software checks, not physical load validation.

Final verification: all 16 container browser workflows passed, along with default and opt-in pilot production builds, formatting, and whitespace checks. Visual review confirmed the coasting HUD displays 0 W / 0 rpm while speed and distance increase. The existing large Three.js bundle warning remains; these checks do not establish physical trainer response or Mac frame rate.

Next: the rider runs **Trainer → SIM · terrain test** as described in HT-3. No repeated low-power ERG test is required to establish the intended road mode. Route development can continue independently; automatic real resistance follows observed BikeSIM slope, coasting/re-engagement, handoff, and Stop behavior.

## September 9 implementation history

Updated September 9, 2026. Implements the initial usable slice and the rider's SIM-first direction after review of both implementation plans.

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
- Live-power workout mode with fresh-power/FTP prerequisites and no hardware writes.
- Session checkpointing every five seconds, history, interrupted-session recognition, summaries, CSV/JSON downloads, and versioned backup/import.
- Settings for FTP, virtual rider mass, and graphics quality.
- Unit tests and container browser workflow tests.
- Opt-in supervised 50–100 W ERG pilot with serialized acknowledged commands, browser-tab ownership, cadence/freshness/timing guards, gradual target changes, stop priority, and an exportable audit log. No automatic workout control.
- SIM road selection is the default, with three distance-based procedural routes, elevation profiles, route progress/ascent, and distance-based completion. ERG workouts remain a separate library.
- Free road rides use adjustable demo effort/coasting or fresh live power with no FTP or prescribed cadence. Virtual physics includes rider/bike mass, grade, rolling resistance, and aerodynamic drag. No gear-position sensor is assumed and measured power is not scaled by gearing.
- SIM sessions persist their route, mode, mass assumptions, and optional FTP in summaries/history/backups; existing records remain compatible. Settings exposes bike mass with a disclosed 9 kg default.
- A synthetic-transport SIM controller and FTMS encoder support bounded terrain commands, acknowledged startup/stop, explicit baseline/profile prerequisites, 0.25 percentage-point gradient steps at most once per second, freshness/timing faults, and coasting without the ERG cadence threshold. This controller has no real Bluetooth adapter or ride hookup.
- ERG response diagnostics separate selected/acknowledged watts from fresh trainer power/cadence, record stable-target averages with settling excluded, preserve raw status notifications, and capture post-stop readings. Evidence checkpoints save separately from ride backups and restore only for export.

## Still gated or deferred

- **Actual KICKR validation:** read-only pairing and pedaling confirmed on this Mac. Reconnect/fault and physical load responses still require hardware observations.
- **September 9 control evidence:** the actual KICKR acknowledged 50→75→100 W ramps and Stop. The rider felt light load at every target and a heavier load after termination. The captured test ended on the cadence guard about 6.5 seconds after acknowledging 100 W. The earlier log lacked measured watts/cadence, so physical tracking remains unresolved; the new recorder enables the next comparison. See HT-2 and its captured fixture.
- **Automatic ERG/SIM:** actual ride control remains disabled. The separate ERG diagnostic supports supervised HT-2; SIM protocol/control logic is mock-tested only. Baseline handoff, trainer mass/profile configuration, physical slopes, and stop/failure behavior remain unverified.
- **Wi-Fi:** not implemented; no trainer IP or LAN-wide scanning performed.
- **Performance:** software-rendered container checks do not establish 60 fps on the actual Mac/external display.
- **Route realism:** procedural landscape only. Real route geometry/elevation, GPX, licensed terrain, and Blender assets remain later milestones.
- **Data features:** FIT, normalized power/TSS, automatic Strava upload, and advanced training families remain deferred.
- **WebMCP:** optional read-only workout catalog registration is included; native WebMCP availability is browser-dependent and has not been verified in a supported agent context.

Periodic checkpoints currently save a complete session snapshot; chunked recording is a future optimization if long-ride storage measurements justify it. On storage failures, the ride displays an error and provides a downloadable summary. An abrupt closure can lose the samples since the last successful checkpoint.

## Verification completed

September 9 diagnostic checks: 63 unit tests and seven synthetic-GATT browser workflows pass. The new regression uses a trainer that accepts 100 W but continues reporting 50 W, and verifies that the UI exposes this mismatch rather than treating the acknowledgement as measured performance. Saved evidence survives reload while controls remain disarmed. The actual September 9 command log is retained as a fixture; it supplies protocol evidence only. Default and pilot builds compile, and formatting/whitespace checks pass.

September 8 checks: 56 unit tests pass. Default and opt-in pilot production builds compile successfully; the only build warning is the existing large Three.js bundle. Formatting and whitespace checks pass. Browser workflow results are described below.

The unit suite covers FTMS parsing, the no-control-write pairing boundary, connection cleanup, interval boundaries/ramps, pause/resume, stale power, a six-hour simulated ride, IndexedDB round-trip, interrupted-session recovery, atomic backup validation, serialized command acknowledgements, refusal/timeouts, stalled writes, ramp limits, exclusive pilot ownership, visibility loss, and asynchronous stop cleanup. Regressions cover starting at zero cadence, cancellation/retry without disconnection, failed preparation, unsupported saved permissions, and cancelled reconnection.

SIM regressions add signed protocol units and explicit command authorization, baseline/profile prerequisites, bounded gradient transitions, coasting, stale/timing/grade faults, distance/elevation integration, downhill physics, route completion, invalid live data, no-FTP riding, and backup validation. Thirteen browser workflows cover the simulator/storage/layout flows, synthetic-GATT control/reconnection, default road selection, no-FTP live road rides with zero control writes, free demo effort/coasting, route history, and narrow-screen layout. These are synthetic software checks, not physical load validation.

The original pilot's initial low-cadence rejection incorrectly disconnected the actual trainer and stranded the Stop button. That lifecycle is corrected; HT-2 documents the evidence and retest. Full-refresh reconnection is browser-dependent: this Mac's Chrome did not restore saved permission during the real check, so the explicit Pair fallback is still required here. No claim of seamless physical reconnection or verified load response is made.

Initial scene compilation now precedes the workout countdown. Idle scenes stop continuously rendering; low graphics mode reduces resolution/detail/frame rate and removes backdrop blur. These changes allow the complete ride workflow to pass in software-rendered container Chromium without loosening the timing-fault guard. Local Chrome visual review also found and corrected overlapping road-surface layers.

## Next implementation step

The September 10 [flywheel review](FLYWHEEL_REVIEW.md) replaces repeated low-power ERG attempts with a Wahoo SIM comparison. Latest actual telemetry repeatedly follows 50 W before power dips and a single reported zero cadence triggers Stop. This is partial target-response evidence, not proof of exact flywheel modeling or all-target validation. Confirm actual trainer profile configuration and SIM coasting/re-engagement feel, then add a separately armed, bounded SIM hardware pilot before enabling road control. Neither mode may assume that the trainer begins unloaded. Ordinary route UI/physics development can continue independently.

## SIM protocol and physics boundary

FTMS Set Indoor Bike Simulation Parameters uses opcode `11` followed by signed little-endian wind speed in 0.001 m/s, signed little-endian grade in 0.01%, rolling resistance in 0.0001 units, and wind resistance in 0.01 kg/m units. The command is seven bytes; the similarly named status notification has a different opcode. References: [Bluetooth SIG FTMS test specification](https://files.bluetooth.com/wp-content/uploads/dlm_uploads/2024/10/FTMS.TS_.p6.pdf), [published FTMS implementation table](https://hci.informatik.uni-due.de/fileadmin/fileupload/I-HCI/CHI2024_Learning_from_CyclingHCI_Position_Paper_Buying_vs_Building.pdf).

The software model uses rolling coefficient 0.004, wind coefficient 0.18 kg/m, still air, and 97% drivetrain efficiency. These are explicit simulation assumptions, not measurements of this bicycle. The encoder rejects SIM commands unless a separate gradient grant is supplied; the existing real ERG pilot supplies no such grant. The mock startup sequence requests control, sends flat SIM parameters, and starts, but flat SIM still includes drag and rolling load. This sequence is not yet approved by physical observation, and its confirmation flags are internal test inputs rather than evidence about the actual trainer. Stop acknowledgement likewise does not establish unloading.
