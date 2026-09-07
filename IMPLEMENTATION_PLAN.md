# BikeSIM — Implementation Plan (draft v0.1, for review)

A local, private, 3D point-of-view bike simulator for a **Wahoo KICKR Core 2** and a **Giant Contender AR 1**, focused on structured triathlon training. Rouvy-style roads, Zwift-style metrics and workouts, none of the multiplayer.

How to review this document:

- Items marked **❓ DECISION** need your answer. They are collected again in section 13 so you can reply by number.
- Items marked **✅ RECOMMENDED** are my proposed default when you have no preference.
- Everything is phased. Phase 0–3 is the "start small" core. Phases 4+ add realism and the Oaxaca dream.

---

## 1. Goals and non-goals

**Goals**

1. Run entirely on your Mac, inside a devcontainer, with data stored locally.
2. Talk to the KICKR Core 2 safely: read power/cadence/speed, set ERG target power and simulated grade.
3. Ship a ready-to-go workout library derived from `cycling_presets.md`, with a countdown, an interval HUD, and automatic trainer control.
4. Show a 3D first-person road whose terrain matches the workout (hills during hard intervals, flat during recovery).
5. Record every session and export it in a format Strava accepts.
6. Be visually pleasing: this is a simulator, not a spreadsheet.

**Non-goals (deliberately out of scope)**

- Multiplayer, online racing, social features, accounts.
- Supporting other trainers, ANT+, Windows, or mobile.
- Replacing the Wahoo app for firmware updates or device settings.

---

## 2. Hardware and connectivity analysis

### 2.1 What the KICKR Core 2 exposes

The KICKR Core 2 speaks the standard Bluetooth **FTMS** (Fitness Machine Service) profile plus Cycling Power and Cycling Speed & Cadence. The same GATT services are also reachable over Wi-Fi through Wahoo's **Direct Connect** protocol (a small TCP protocol that tunnels GATT read/write/notify, the one Zwift and TrainerRoad use).

Everything the app needs is in FTMS:

| Need | FTMS characteristic | Direction |
| --- | --- | --- |
| Live power, cadence, speed | Indoor Bike Data (0x2AD2) | notify, ~1–4 Hz |
| ERG: hold a target power | Control Point (0x2AD9) op `0x05 Set Target Power` | write |
| SIM: set road grade / wind / rolling resistance | Control Point op `0x11 Set Indoor Bike Simulation` | write |
| Take / release control, reset | Control Point ops `0x00`, `0x01`, `0x07`, `0x08` | write |
| Trainer status changes | Fitness Machine Status (0x2ADA) | notify |
| Supported power / resistance ranges | 0x2AD8 / 0x2AD6 | read once |

Standard opcodes only. We never write to vendor or firmware (DFU/OTA) characteristics; those are explicitly blocklisted in code (section 3).

### 2.2 Two ways to reach the trainer, and why the devcontainer matters

| | A. Wi-Fi Direct Connect (from the backend, inside the container) | B. Web Bluetooth (from Chrome on the host) |
| --- | --- | --- |
| Where the device code runs | Node backend inside the devcontainer | JavaScript in the browser tab |
| Respects "never run code on my machine" | Yes, fully | Grey area: the browser itself runs on the host |
| Works from Docker on macOS | Yes for plain TCP to a LAN IP. mDNS discovery does **not** cross Docker's NAT, so we configure the trainer IP | Yes, Chrome on macOS supports Web Bluetooth |
| Safety supervision (watchdog, logging, caps) | Server-side, always on, testable | Only while the tab is alive |
| Testability without hardware | Mock trainer server in the container | Harder |
| Protocol risk | Direct Connect is community-documented, not officially published | FTMS is an official Bluetooth spec |

**✅ RECOMMENDED: A as primary, B as a fallback transport.** You already hinted at Wi-Fi, it keeps all device logic in the container where it can be logged and guarded, and it lets us develop against a mock. Both paths speak identical FTMS bytes, so the codec is shared and only the transport differs. If Direct Connect on the Core 2 turns out to behave unexpectedly, we switch the transport without touching the rest of the app.

**❓ DECISION 1:** Do you agree with Wi-Fi first? To find the trainer's IP without me running anything on your Mac, either read it from the Wahoo app (device settings), or run this read-only command yourself in this session with the `!` prefix:

```
! dns-sd -B _wahoo-fitness-tnp._tcp local.
```

### 2.3 One controller at a time

Trainers only honor one controlling app. During our sessions the Wahoo app (and anything else, like Zwift) should be closed or at least not connected. **❓ DECISION 2:** OK to close the Wahoo app while BikeSIM runs?

---

## 3. Safety model (top priority)

Safety is designed in as its own module, the **Safety Supervisor**, sitting between the workout engine and the trainer. Nothing reaches the trainer without passing through it.

### 3.1 Rules enforced in code

1. **Control is off by default.** The backend starts read-only. Writes are only enabled with an explicit flag (`TRAINER_CONTROL=on`) *and* a confirmation click in the UI. Phase 1 has no write path at all.
2. **Allowlist, not blocklist.** Only the FTMS control point may be written, with only the opcodes listed in 2.1. Every other characteristic is read/notify only. Firmware/DFU services are refused even if requested.
3. **Hard caps**, configurable, with conservative defaults: target power ≤ min(150% FTP, 450 W); grade between −10% and +15%; resistance level within the trainer's reported range.
4. **Ramp limiting.** Target power changes are ramped over ~3 s instead of stepped, so an interval never feels like hitting a wall.
5. **Cadence guard (ERG "spiral of death").** If cadence drops below 40 rpm for 5 s during an ERG interval, target power is cut to a floor (e.g. 50 W) until you spin up again. The interval clock keeps running.
6. **Watchdog / dead man's switch.** The UI sends a heartbeat every second. If the backend misses 5 heartbeats, or the trainer stops sending data for 10 s, the supervisor puts the trainer in the **safe state**: SIM mode, 0% grade (feels like a flat road, resistance depends only on how hard you pedal). The same happens on any backend crash or shutdown (graceful exit sends SIM 0% then FTMS Reset).
7. **Emergency stop.** A large always-visible button plus `Esc` and `Space` on the keyboard. Immediately: safe state, workout paused, audible tone. Re-arming needs a deliberate click.
8. **Full audit log.** Every write to the trainer is logged with timestamp, opcode, payload, and the trainer's response code. Available in a diagnostics screen.
9. **Mock first.** All features are built and tested against a simulated trainer. The real KICKR is touched only in the explicit hardware test sessions below, with you present.

### 3.2 Hardware test protocol (you in the loop)

Each test starts only after you type a go-ahead in chat. I narrate each step before sending it.

| Test | Phase | What I do | What you confirm |
| --- | --- | --- | --- |
| HT-1 Read-only | 1 | Connect, list services, subscribe to Indoor Bike Data. No writes. | Pedal; the HUD numbers match the Wahoo app / your feel |
| HT-2 Control basics | 2 | Request control → ERG 100 W → ERG 150 W → SIM 0% → SIM 3% → safe state | You feel each change and can say "yes" or "no" |
| HT-3 Kill switches | 2 | Press E-stop mid-effort; then kill the backend process mid-effort | Resistance drops to flat-road feel both times |
| HT-4 First workout | 3 | Run a 10-minute preset end to end | Intervals change on time, cadence guard works if you stop pedaling |

---

## 4. Architecture and tech stack

```
 Chrome on your Mac                       Devcontainer (Docker)                        LAN
┌──────────────────────────┐   WebSocket  ┌──────────────────────────────┐   TCP     ┌───────────────┐
│  web  (React + Three.js) │◄────────────►│  server (Node/TypeScript)    │◄─────────►│ KICKR Core 2  │
│  • 3D POV simulation     │  telemetry,  │  • Direct Connect transport  │  Direct   │ (Wi-Fi)       │
│  • HUD, workout browser  │  commands,   │  • FTMS codec (shared pkg)   │  Connect  └───────────────┘
│  • countdown, e-stop     │  heartbeat   │  • Safety Supervisor         │
│  (optional Web Bluetooth │              │  • Workout Engine            │
│   fallback transport)    │              │  • Session recorder + FIT    │
└──────────────────────────┘              │  • Mock trainer (dev)        │
                                          └──────────────────────────────┘
```

**Stack** (✅ RECOMMENDED)

- **Language:** TypeScript everywhere. One language, and the FTMS codec is shared between the backend and the browser fallback.
- **Backend:** Node 22, Fastify + `ws`. SQLite via `better-sqlite3` for session history and settings.
- **Frontend:** Vite, React, **react-three-fiber** + drei (Three.js), Zustand for state, Tailwind for the HUD. Postprocessing (bloom, tone mapping, fog) for the "pleasing" part.
- **FIT export:** Garmin's official `@garmin/fitsdk` encoder. Strava accepts FIT uploads directly.
- **Monorepo:** pnpm workspaces.

**Repository layout**

```
BikeSIM/
├── .devcontainer/
│   ├── devcontainer.json        # typescript-node:22 image, ports 5173 + 8080, TRAINER_* env
│   └── Dockerfile               # only if we need extra tooling (e.g. nc for connectivity tests)
├── docs/
│   ├── SAFETY.md                # the rules in section 3, kept current
│   ├── PROTOCOL_NOTES.md        # what we verify about FTMS / Direct Connect on this device
│   └── HARDWARE_TESTS.md        # HT-1..HT-4 checklists and their results
├── packages/
│   ├── protocol/                # pure TS: FTMS + Direct Connect codecs, unit-tested with byte fixtures
│   ├── presets/                 # workout library as typed JSON (from cycling_presets.md)
│   ├── server/                  # Fastify app: transports, supervisor, engine, recorder, WS API
│   └── web/                     # Vite + React + R3F app
├── data/                        # git-ignored: sessions, exports, settings.db
├── about.md, cycling_presets.md, IMPLEMENTATION_PLAN.md
└── package.json, pnpm-workspace.yaml
```

**Devcontainer notes**

- Base image `mcr.microsoft.com/devcontainers/typescript-node:22`. Vite binds `0.0.0.0` so the forwarded port works in your browser.
- Env: `TRAINER_HOST`, `TRAINER_PORT` (Direct Connect default 36866), `TRAINER_CONTROL=off`.
- Phase 0 includes a connectivity smoke test from inside the container (`nc -vz $TRAINER_HOST $TRAINER_PORT`) that opens and closes a TCP socket without sending any bytes. If Docker's network cannot reach the trainer, we know on day one and fall back to Web Bluetooth.

**Git:** commit on `main` after each meaningful step, conventional-commit style messages, no co-author trailers (per your note).

---

## 5. Data model

**Rider profile:** name, FTP (W), weight (kg), bike weight (default 9 kg), CdA (default 0.32, hoods), Crr (default 0.004), power zones derived from FTP (Coggan 7-zone), optional max HR.

**Workout schema** (TypeScript types + JSON; conceptually the same as Zwift `.zwo`):

```ts
type Workout = {
  id: string; name: string; category: WorkoutCategory;      // e.g. "sweet-spot"
  description: string; triathlonPriority: 1 | 2 | 3;         // the ⭐ rating from cycling_presets.md
  estimatedTSS: number; durationSec: number;
  steps: Step[];
};
type Step =
  | { kind: "steady";  sec: number; target: Target; cadence?: [number, number]; cue?: string }
  | { kind: "ramp";    sec: number; from: Target; to: Target; cue?: string }
  | { kind: "repeat";  times: number; steps: Step[] }
  | { kind: "freeSim"; sec: number; grade: number; cue?: string };    // rider-driven, e.g. sprints
type Target = { pctFtp: number } | { watts: number };
```

**Session record:** 1 Hz samples (power, cadence, speed, distance, grade, target, HR if present), interval markers, events (pauses, e-stops, bias changes), summary (avg/NP power, IF, TSS, kJ, time in zones, best 5s/1m/5m/20m power). Stored in SQLite, exported to FIT on demand.

---

## 6. Ride modes and how the road matches the workout

| Mode | Trainer control | Where the resistance comes from | Use |
| --- | --- | --- | --- |
| **Structured workout** | ERG | Target power from the step; the trainer holds it regardless of gear/cadence | All presets by default |
| **Route ride** | SIM | Grade of the road under you; you shift and push like outdoors | Free riding, real roads, hill repeats if you prefer "real" hills |
| **Free ride** | SIM | Manual grade slider / keyboard | Warm-ups, playing around |

For structured workouts, the 3D road is **generated from the workout profile**: each step maps to a road segment whose grade is a function of intensity (recovery ≈ 0–1%, Z2 ≈ 1–2%, sweet spot ≈ 3–4%, threshold ≈ 5–6%, VO₂max ≈ 7–9%). ERG keeps the physical resistance exactly on target while the visuals say "you are climbing". This is how Zwift workouts feel and it keeps the physiology of the preset intact.

**❓ DECISION 3:** For "hill repeats", do you want (a) ERG with visual hills ✅ RECOMMENDED as default, or (b) real SIM-mode grade where you must shift and grind? I propose supporting both with a toggle on the workout start screen, ERG default.

Sprints and "max effort" steps cannot be ERG (there is no target). They run as `freeSim` at a modest grade with a big **SPRINT!** cue.

**Virtual speed** is computed from your power with the standard cycling power model (rolling resistance + aero drag + gravity on the current grade, integrated each frame for realistic acceleration), not read from the trainer's flywheel. Air density defaults to Oaxaca's altitude (~1,550 m) because we can.

---

## 7. 3D simulation design

**v1 (Phase 4, "very simple and minimalistic")**

- Road: a smooth spline extruded into a two-lane asphalt ribbon with center/edge markings, following the generated elevation profile.
- Camera: first-person at handlebar height, subtle bob tied to cadence, slight lean into curves. Handlebars and front wheel visible in frame.
- Scenery: low-poly rolling terrain from a heightmap, instanced trees and bushes, distance markers every km, sky dome with sun, fog for depth.
- Motion: driven by the virtual speed model. Stop pedaling → coast and slow down, like outdoors.
- Performance target: 60 fps on the MacBook's GPU with a quality slider (draw distance, shadows, post effects).

**Later (Phase 6–7)**

- Bike model, road textures, guardrails, road signs, villages: authored in **Blender** via the MCP add-on, exported as glTF.
- Time of day and weather presets (dawn, midday, golden hour, overcast).
- Sound: wind proportional to speed, tire hum, interval beeps.
- **Real roads from Oaxaca**: import a GPX track, fetch elevation, build terrain from public DEM data around the track, dress it with Oaxaca-flavored assets (agaves, ochre hills, terracotta roofs). Candidate first routes: the climb to Monte Albán, Oaxaca → San Felipe del Agua, and the flatter Oaxaca → Tule → Mitla road. You know the area, so you pick.

---

## 8. UI screens

1. **Home:** trainer connection status (with big green/red), rider profile summary, "Quick ride" and "Workouts".
2. **Workout library:** cards grouped by the categories in `cycling_presets.md`, filter by duration / zone / triathlon priority ⭐, mini power-profile chart and estimated TSS on each card.
3. **Workout start:** description, full profile chart, ERG/SIM toggle where relevant, pre-ride checklist (trainer connected, FTP set, control armed, "start pedaling"), **Start**.
4. **Countdown:** full-screen 10 → 1 with beeps, trainer in safe state until 0.
5. **Ride:** full-screen 3D. HUD: current vs target power (color-coded by zone), cadence with target band, interval time left and total elapsed, next step preview, scrolling power-profile strip with your position, speed / distance / elevation / grade, optional HR. Controls: pause, skip step, ±5% intensity bias, **E-STOP**.
6. **Summary:** power and cadence charts, time in zones, NP / IF / TSS, best efforts, notes field, **Export FIT**, "Upload to Strava" later.
7. **History:** list of past sessions, trends (weekly TSS, FTP history).
8. **Settings:** profile, trainer (IP, transport, control arming), safety caps, graphics quality.
9. **Diagnostics:** raw service/characteristic list, live notification stream, write audit log. Built early because it is how we validate the protocol in Phase 1.

---

## 9. Phased roadmap

Sizes are rough: S = a session, M = a few sessions, L = several sessions.

| Phase | Deliverable | Exit criteria | Hardware |
| --- | --- | --- | --- |
| **0 · Foundation** (S) | Devcontainer, monorepo scaffold, CI-style scripts (lint, test), `docs/SAFETY.md`, mock trainer | `pnpm dev` serves a hello page from the container in your browser; `nc` reaches the trainer's port | TCP open/close only |
| **1 · Read the trainer** (M) | Direct Connect transport, FTMS decoder, diagnostics screen, plain-text live HUD | HT-1 passes: live power/cadence/speed while you pedal, matches the Wahoo app | Read-only |
| **2 · Control + safety** (M) | Control point encoder, Safety Supervisor, watchdog, E-stop, audit log, arming UI | HT-2 and HT-3 pass; every rule in 3.1 has an automated test against the mock | ERG / SIM writes, supervised |
| **3 · Workouts** (M) | Workout engine (steps, ramps, repeats, bias), preset library from `cycling_presets.md` + FTP tests, library / start / countdown / ride HUD screens, session recording | HT-4 passes; you finish a real 10–20 min preset with correct transitions | Full workouts |
| **4 · Minimal 3D** (M) | Procedural road matched to the workout, POV camera, terrain, sky, virtual speed physics | You ride a full workout on the 3D screen at ≥ 60 fps and it "feels like moving" | Same as 3 |
| **5 · Records & export** (S–M) | SQLite history, summary screen with NP/IF/TSS and best efforts, FIT export accepted by Strava | A BikeSIM ride shows up correctly in Strava after manual upload | — |
| **6 · Polish & realism** (L) | Blender assets (bike, roadside), lighting/time-of-day, post-processing, sound, cadence bob, HR monitor support | Screenshots you would be happy to show someone | Optional HRM |
| **7 · Real roads** (L) | GPX import, elevation, DEM terrain, Oaxaca asset pack, SIM-mode route rides, route library | You ride Monte Albán from your living room | SIM |

Phases 0–3 are the functional core and are strictly sequential. Phase 4 can start in parallel with 3 once the telemetry stream exists. 5–7 are ordered by value but flexible.

---

## 10. Testing strategy

- **Unit tests** (`protocol`): encode/decode against recorded byte fixtures for every FTMS message and Direct Connect frame we use. Fixtures come from real captures in Phase 1, so the mock stays faithful.
- **Mock trainer**: a Direct Connect server inside the container that simulates the KICKR (responds to control, produces plausible power/cadence). The whole app runs against it with zero hardware. It can also inject faults (dropped connection, stale data, error response codes) to exercise the supervisor.
- **Supervisor tests**: one automated test per rule in 3.1.
- **Workout engine tests**: given a preset and a clock, assert the exact sequence of targets sent.
- **Hardware tests**: HT-1..HT-4, results logged in `docs/HARDWARE_TESTS.md`.
- **Browser checks**: I use Chrome on this Mac only, via the extension, for visual verification.

---

## 11. Risks and mitigations

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Docker on macOS cannot reach the trainer's LAN IP | Low–medium | Day-one `nc` test; fallback to Web Bluetooth transport in the browser |
| Direct Connect details differ on Core 2 firmware | Medium | Read-only discovery first, diagnostics screen, byte-level logging, FTMS spec is the same either way |
| Wahoo app keeps control of the trainer | Medium | Close it during sessions (Decision 2); detect and warn when control requests are refused |
| ERG spiral of death / uncomfortable jumps | Medium | Cadence guard, ramp limiting, ±bias, E-stop |
| Any command that could harm the device | Very low | Standard FTMS opcodes only, allowlist, no vendor/DFU writes, caps on every value |
| 3D performance or motion discomfort | Low | Quality slider, camera bob toggle, stable horizon |
| Scope creep (this doc is already ambitious) | High | Phase gates; nothing from section 12 starts before Phase 3 passes HT-4 |

---

## 12. Above-and-beyond backlog (ideas, not commitments)

Tagged with the earliest phase they make sense in.

- **FTP tests** (3): 20-minute test and ramp test presets that compute and offer to save your new FTP. Everything else is % FTP, so this comes early.
- **Intensity bias** (3): ±% on the fly, like Zwift, when a day is better or worse than planned.
- **Cadence metronome** (3): visual/audio tick for torque work (55–65 rpm) and cadence drills (110–120 rpm).
- **Fueling reminders** (3): configurable carbs/fluids nudges on long rides, straight from the "fueling workouts" idea in the presets doc.
- **Brick mode** (3): when the bike portion ends, a T2 checklist and a run timer so the whole brick is one session.
- **Coach summary** (5): plain-language post-ride notes: interval compliance, zone drift, cadence discipline.
- **Training pyramid planner** (5): a simple weekly plan builder following Base → Muscular endurance → FTP → VO₂max → Race specificity → Bricks.
- **Voice cues** (6): Web Speech API reads step cues ("3 minutes at sweet spot, settle in").
- **Ghost rider** (7): your previous best on the same route drawn ahead of or behind you.
- **Strava upload** (5+): direct API upload instead of manual FIT upload. Needs a Strava API app registration on your account.
- **Aero position timer** (6): segments that ask you to hold position, with a gentle reminder overlay.
- **Spanish UI** (6): toggle, given where the roads will be.

---

## 13. Open questions for you

Reply by number, one line each is enough.

1. **Wi-Fi Direct Connect first, Web Bluetooth as fallback?** And the trainer's IP (from the Wahoo app, or `! dns-sd -B _wahoo-fitness-tnp._tcp local.`).
2. **Close the Wahoo app during BikeSIM sessions?**
3. **Hill workouts:** ERG with visual hills by default, SIM optional?
4. **Your FTP and weight** (or "unknown, start with an FTP test"). Defaults otherwise: 200 W, 75 kg.
5. **Strava:** manual FIT upload OK for v1, direct API upload later?
6. **Heart-rate monitor:** do you own a Bluetooth HRM you want in the HUD?
7. **Safety caps:** happy with 150% FTP / 450 W max target and −10% … +15% grade?
8. **Tech stack:** any objection to TypeScript + React + Three.js + Node?
9. **Oaxaca routes:** which road would you want first?

---

## Appendix A — FTMS control point quick reference

| Opcode | Name | Payload | Notes |
| --- | --- | --- | --- |
| 0x00 | Request Control | — | Must succeed before any other write |
| 0x01 | Reset | — | Returns trainer to defaults; used on shutdown |
| 0x04 | Set Target Resistance Level | uint8 (0.1 units) | Not used in v1 |
| 0x05 | Set Target Power | int16 W | ERG mode |
| 0x07 | Start / Resume | — | |
| 0x08 | Stop / Pause | uint8 (1 stop, 2 pause) | |
| 0x11 | Set Indoor Bike Simulation | int16 wind (0.001 m/s), int16 grade (0.01 %), uint8 Crr (0.0001), uint8 Cw (0.01 kg/m) | SIM mode |

Responses arrive as indications on the same characteristic: `0x80, requestOpcode, resultCode` (0x01 success, 0x02 not supported, 0x03 invalid parameter, 0x04 operation failed, 0x05 control not permitted).

## Appendix B — Wahoo Direct Connect notes (to verify in Phase 1)

- Advertised via mDNS as `_wahoo-fitness-tnp._tcp`, TXT records include serial number and the GATT service UUIDs offered.
- Plain TCP. Each message: 6-byte header (protocol version, message id, sequence number, response code, 16-bit payload length) followed by the payload. Message ids cover discover services, discover characteristics, read, write, enable notifications, and unsolicited notifications. UUIDs are 128-bit.
- We will confirm framing, port, and the exact service list against the real device with read-only traffic in HT-1, and record the captures as test fixtures in `packages/protocol`.

## Appendix C — Preset library (first draft, from cycling_presets.md)

| Category | Presets | Default mode |
| --- | --- | --- |
| Recovery | 30 / 45 / 60 min Z1 | ERG |
| Endurance / Z2 | 60 / 90 / 120 / 180 min, 55–75% FTP, fueling reminders on the long ones | ERG |
| Tempo | 3 × 20 min @ 80% | ERG |
| Sweet Spot | 3 × 15 @ 90%; 2 × 30 @ 88–90% | ERG |
| Threshold | 4 × 8 @ 100%; 3 × 12 @ 100%; 2 × 20 @ 95–100% | ERG |
| VO₂max | 5 × 4 min @ 115%, 4 min easy | ERG |
| Anaerobic | 10 × 30/30 @ 150%; 6 × 1 min @ 140% | ERG |
| Sprint / neuromuscular | 6 × 10 s max, 3–5 min easy | freeSim |
| Torque / low cadence | 5 × 5 min @ 85% at 55–65 rpm | ERG + cadence band |
| Cadence drills | 5 × 1 min at 110–120 rpm, low power | ERG + cadence band |
| Hill repeats | 6 × 5 min uphill @ 100–105% | ERG (SIM optional) |
| Over-unders | 4 × (2 min @ 105% / 2 min @ 90%) | ERG |
| Attacks | 60 min @ 80% with 30 s @ 150% every 5 min | ERG |
| Race pace | 3 × 20 min @ race power (default 80% FTP) | ERG |
| Brick | 90 min bike (Z2 + race-pace block) → run timer | ERG |
| Long ride | 3 h Z2 with fueling reminders | ERG |
| FTP tests | 20-min test; ramp test | ERG / freeSim |
