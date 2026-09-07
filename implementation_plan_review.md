# BikeSIM implementation plan

Status: proposed for review — implementation has not started.

Prepared: September 7, 2026. Based on `about.md` and `cycling_presets.md`.

## 1. Intended outcome

Build a private, local, single-rider training app for the existing Giant road bike and Wahoo KICKR CORE 2 with its 11-speed cassette. The rider chooses a workout, adjusts it, starts a countdown, and rides through a convincing first-person 3D environment while the app displays live metrics and manages the trainer.

Start with a simple, attractive procedural road and dependable workouts. Expand toward recognizable, geographically accurate roads around Oaxaca only after trainer control and session reliability are proven.

The repository currently contains the two requirements documents and no application. This plan proposes the initial architecture; it does not assume a working device integration.

## 2. First usable release

The initial release should support:

- A workout library with purpose, duration, interval preview, intensity, cadence guidance, and control mode.
- Editable duration, repetitions, recovery periods, and targets expressed as watts or a percentage of user-entered FTP. Save customized copies of presets.
- An explicit demo mode using simulated telemetry, usable without connecting hardware.
- User-initiated pairing with the actual KICKR, live power and available cadence/speed readings, and clear connection/control status.
- A start countdown, warm-up, intervals, recovery, cooldown, pause/resume, and an always-visible stop control with a keyboard shortcut.
- A first-person road scene with forward motion, curves, climbs, scenery, and a stable camera suited to the external display.
- A readable HUD: power and target, cadence when available, elapsed/remaining time, current/next interval, virtual speed/distance, and route progress.
- Automatic local session saving, a session summary/history, and downloadable backup and CSV/JSON data.

Exclude multiplayer, accounts, leaderboards, subscriptions, cloud dependencies, automatic training prescription, and automatic Strava uploads from this release. Physical shifting uses the existing cassette. Steering, bike tilt, and outdoor handling skills are not simulated by the trainer.

## 3. Proposed architecture and execution boundary

Use TypeScript, React, and Vite for the interface; Three.js with React Three Fiber for the scene; IndexedDB for local persistence; Vitest for domain tests; and Playwright for browser workflows with a mock trainer. Pin dependency versions during setup and commit the lockfile. These are proposed choices, not existing dependencies.

All dependency installation, development servers, builds, test runners, asset processing, and application scripts run inside `.devcontainer`. Use Docker tooling available during implementation, keep ports bound to the local machine, and avoid privileged hardware passthrough as a default.

The browser on this MacBook displays the app served from the container and performs Bluetooth access. Chrome documents Web Bluetooth support on macOS, secure-context requirements, and user-gesture pairing. Local browser/device validation remains necessary. [Chrome Web Bluetooth documentation](https://developer.chrome.com/docs/capabilities/bluetooth)

**Review assumption:** the instruction to use a browser on this computer permits the page's JavaScript/WebGL and Bluetooth calls to execute in that browser. All development/runtime tooling stays in the container; no native host-side application or Bluetooth bridge is proposed. If “never run code on my machine” also prohibits page JavaScript, this browser architecture needs revision before implementation.

```text
Devcontainer: dependencies → build/test → localhost web server
                                            │
MacBook Chrome: UI + 3D scene + workout engine + local storage
                                            │
                               safety controller → Bluetooth → KICKR
```

Keep these modules separate:

| Module | Responsibility |
| --- | --- |
| Trainer adapter | Discover capabilities, parse telemetry, serialize commands, report acknowledgements/errors; interchangeable real and mock adapters. |
| Safety controller | Own all hardware writes, validate limits, handle stale data and faults, and arbitrate stop requests. |
| Workout engine | Deterministic interval timing, target generation, transitions, and pause/resume state. |
| Ride model | Estimate virtual speed/distance from power, mass, gradient, and configurable resistance assumptions. |
| Scene renderer | Render road/scenery and camera motion from ride state; never write to the trainer. |
| Persistence | Store settings, versioned workouts, sessions, telemetry chunks, and recovery checkpoints. |
| Interface | Library, workout editor, pairing/setup, ride HUD, summaries, and actionable connection messages. |

Suggested layout: `.devcontainer/`, `src/trainer/`, `src/safety/`, `src/workouts/`, `src/ride/`, `src/scene/`, `src/storage/`, `src/ui/`, `tests/`, `public/assets/`, and `docs/`.

## 4. Resolve hardware access early

Prefer Bluetooth directly from the local browser. Do not assume the container can access the Mac's built-in Bluetooth radio. Docker documents USB/IP as a separate device-forwarding mechanism and does not guarantee all devices work; no passthrough dependency is needed for the proposed browser approach. [Docker USB/IP documentation](https://docs.docker.com/desktop/features/usbip/)

Begin with a read-only capability probe: user selects the KICKR, the app discovers supported services/features and subscribes to available telemetry. It must not request trainer control or send resistance, target-power, calibration, or firmware commands in this mode. Notification subscription itself can involve Bluetooth configuration writes, but must not alter training load.

Investigate standard Fitness Machine Service (FTMS) first, using the Bluetooth SIG specification and its command-response requirements. Actual services, supported modes, target ranges, and units must be checked on this exact trainer and firmware; the existence of FTMS does not establish which commands this device accepts. [Bluetooth SIG Fitness Machine Service](https://www.bluetooth.com/specifications/specs/fitness-machine-service-1-0/)

If required functionality is unavailable, retain the mock simulator and document the missing capability. Evaluate a documented Wahoo-specific interface only after verifying its semantics; do not guess command bytes or probe unknown write characteristics.

Wi-Fi is a later transport option, not an assumed HTTP API. Wahoo documents secure pairing for Wi-Fi setup, but that alone does not establish a usable third-party control protocol. Investigate documented access and container networking only if Bluetooth proves inadequate. [Wahoo secure pairing guidance](https://support.wahoofitness.com/hc/en-us/articles/38241783421714-Securely-pair-a-KICKR-KICKR-BIKE-or-CORE-2-to-the-Wahoo-app)

## 5. Workout behavior and road matching

Support two explicit control modes, with only one commanding the trainer at a time:

| Mode | Trainer command source | Visual behavior |
| --- | --- | --- |
| ERG structured workout | Workout target power | Scenery and road profile communicate effort: climbing blocks look uphill and recovery looks easier. Visual grade does not send a competing slope command. |
| SIM route/hill ride | Route gradient and validated simulation parameters | Road grade determines the requested load; physical gears and cadence affect the rider's resulting power. Power goals are guidance, not guaranteed ERG targets. |

For ERG workouts, generate the workout road ahead of the rider using interval progress, with smooth transitions aligned to climbing/recovery blocks. Treat it as a workout environment, not a geographically accurate route. For SIM routes, grade is a function of distance along fixed geometry. Keep virtual speed explicitly identified as an estimate, separate from any trainer-reported speed.

Use a monotonic clock for workouts, independent of frame rate. Define how pause, missed timing deadlines, lost telemetry, and browser suspension affect time; never jump through missed intervals and replay their commands after resuming. Unavailable cadence or speed should appear as unavailable, not fabricated measurements.

Use `cycling_presets.md` as a catalog brief rather than a personalized coaching prescription:

| Delivery | Preset families |
| --- | --- |
| First release | Recovery, endurance/Zone 2, tempo, sweet spot, threshold, cadence drills, and a moderate hill-repeat example. |
| Next expansion | VO₂max, low-cadence/torque, user-defined race pace, long rides, and bike-to-run brick transition prompts. |
| Later/optional | Over-unders, anaerobic intervals, sprints, aero-position cues, and user-configured fueling reminders. |

Each preset includes explicit warm-up, work, recovery, and cooldown blocks; editable repeat counts; mode; cadence cues; and terrain intent. Validate the total duration and expanded block sequence before starting. Require an entered FTP for percentage-based workouts or let the rider choose explicit watt targets. Do not invent an FTP, race intensity, or nutrition prescription. Maximal efforts require a separate design review rather than simply translating “max effort” into a high ERG command.

## 6. Trainer control safety

Implement the safety layer before enabling real load control:

- States: disconnected, connecting, read-only ready, armed, countdown, running, paused, stopping, complete, and faulted. Pairing alone never arms a workout.
- Enable a start only when capabilities, telemetry freshness, user targets, and control ownership are valid. Confirm no other training app is actively controlling the trainer during validation.
- Validate every command against device-reported capabilities/ranges and a conservative app envelope. Record actual numerical caps, ramp rates, stale-data deadlines, and acknowledgement timeouts during the hardware milestone; these are release-blocking configuration decisions, not unspecified defaults.
- Serialize writes, correlate responses, bound retries, rate-limit updates, and discard obsolete targets. Stop/fault handling supersedes queued workout commands.
- Reject invalid units, non-finite values, malformed packets, unsupported modes, and out-of-range targets. Do not silently alter a workout beyond the rider's selected limits.
- On stale telemetry, command rejection, control loss, unexpected disconnect, low-cadence/stall risk, or timing suspension: pause progression and attempt the documented, validated load-reduction/stop sequence when communication remains available. Resume requires an explicit rider action and gradual re-entry.
- Prevent a second tab from controlling the device. Treat page hiding, reload/navigation, laptop sleep, renderer failure, and browser closure as fault scenarios to test.
- Never issue calibration, firmware, factory-reset, or unknown vendor commands from this app.

An on-screen stop is a best-effort software control, not a physical emergency stop. Browser crashes and Bluetooth loss can prevent a command from arriving, and disconnecting is not proof that resistance fell. Validate and document the trainer's observed behavior and the rider's manufacturer-supported recovery procedure before routine use. Do not claim that a browser watchdog can act while the browser is suspended.

## 7. Delivery sequence and review gates

### Milestone 0 — Reproducible foundation

Create `.devcontainer`, scripts, pinned dependencies, lint/typecheck/build commands, module boundaries, and a mock trainer with deterministic telemetry and injectable faults. Document local startup and the host-browser boundary. Preserve existing requirement edits and make focused Git commits without co-author metadata.

**Exit:** a fresh container can build and run the app; local Chrome opens it; automated tests run in the container; no real hardware commands are possible by default.

### Milestone 1 — Read-only hardware proof

Build a minimal connection/diagnostics screen. Validate browser permissions, device identity, supported services, telemetry units, missing fields, freshness, disconnect/reconnect behavior, and competing-controller conditions. Record findings without retaining unnecessary Bluetooth identifiers in general logs.

**Exit:** actual power and available cadence are displayed during gentle pedaling; observed capabilities and uncertainties are documented; no trainer load changes have been sent. This gate determines whether the proposed transport can proceed.

### Milestone 2 — Complete demo ride

Build the library, editor, workout engine, countdown, HUD, procedural flat/rolling/hill scenery, estimated ride physics, pause/stop flow, and a basic local session summary using the mock adapter. Add all first-release presets and terrain alignment.

**Exit:** a full demo workout completes correctly, the camera remains comfortable, hill/recovery blocks are visually recognizable, and edited workouts survive reload. Review this experience before investing in detailed art.

### Milestone 3 — Validated real trainer control

Implement the serialized control path and safety state machine with protocol fixtures and fault-injection tests. Prepare a concrete manual test script including target limits, expected acknowledgements, stop behavior, and abort/recovery steps. Arrange a supervised session with the rider present, beginning at agreed low loads. Verify ERG and SIM separately, then transitions, pauses, and controlled fault cases.

**Exit:** the rider confirms expected load changes; command responses and observed behavior agree; stop, stalled pedaling, disconnect, and explicit resume behavior are documented. Real control stays disabled for any mode that has not passed this gate.

### Milestone 4 — First usable training release

Connect the validated trainer adapter to the full ride experience. Finish durable session recording, summaries/history, export/import, persistence migrations, and interrupted-session recovery. Recovered rides remain stopped until the rider explicitly restarts; no automatic control on reload.

Tune fullscreen HUD readability, camera smoothing, lighting, roadside variety, render resolution, and quality presets on the actual MacBook/display. Proposed target: stable 60 fps at 1080p internal rendering with a lower-quality fallback; confirm hardware and display resolution before accepting this target.

**Exit:** complete a representative real workout and a long mock soak session; verify interval timing, command behavior, local saved data, export round-trip, and usable frame pacing without external internet access once dependencies/assets are installed.

### Milestone 5 — Oaxaca routes and richer training

Add local GPX import, elevation validation/smoothing, a distance-based route model, and route previews. Start with one short route the rider recognizes. Evaluate licensed road/elevation data, cache assets locally, retain attribution, and distinguish geographically accurate geometry from approximate scenery. GPS traces alone do not provide photorealistic surroundings.

Improve terrain, vegetation, landmarks, audio, and optional Blender-produced assets only where they improve the ride. Expand the remaining workout families and optional FIT export for manual upload to services such as Strava. Direct account integration requires a separate privacy/scope decision.

**Exit:** one offline Oaxaca route has verified geometry/elevation provenance, reasonable gradients, and consistent scene/control behavior. Expand the route collection after rider review.

## 8. Validation and data handling

Automated checks should cover meaningful failures: FTMS packet parsing and units, unsupported capabilities, malformed data, rejected/time-out responses, duplicate commands, stop priority, ramp/limit enforcement, cadence loss, workout boundaries, clock discontinuities, ERG/SIM exclusivity, virtual-ride stability, storage failures, and interrupted-session recovery.

Browser tests run inside the container against the mock adapter. Real Web Bluetooth permissions, trainer behavior, fullscreen readability, and GPU performance require manual validation in the browser on this computer. Do not substitute a browser attached to another computer for these checks.

Store settings, workout definitions, immutable session workout snapshots, timestamped samples, pause/fault events, and route references locally. Write telemetry in chunks during a ride rather than only on completion. Handle quota/write failures visibly while preserving control responsiveness. Support versioned backup/import and individual/all-data deletion. Browser storage can be cleared, so provide downloadable backups.

Use no analytics, remote fonts, CDN runtime assets, or default cloud synchronization. Local storage is private to the browser profile/origin, but is not a promise of application-level encryption. Keep the localhost origin/port stable so stored rides remain accessible. Exporting a file is a deliberate user action; no automatic transmission to Wahoo or Strava is part of the app.

## 9. Decisions for review

The recommended defaults are: local Chrome with browser Bluetooth; container-only development tooling; ERG-first structured training plus a separately validated SIM hill mode; IndexedDB storage; simple procedural scenery; and Oaxaca routes after the first reliable training release.

Before live-control validation, establish the rider's chosen FTP or watt targets, comfortable initial test load, maximum app load/grade limits, actual macOS/Chrome/device firmware versions, and external-display resolution. These inputs do not block creating the container, mock simulator, or read-only diagnostics after this plan is approved.

The largest dependency is proving safe control of the exact trainer through the local browser. Treat that as an early go/no-go milestone, not a final integration task. Do not commit to delivery dates for detailed route realism until this dependency and the first full training ride are validated.
