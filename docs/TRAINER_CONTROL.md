# Trainer control

Current behavior as of September 29, 2026. One `TrainerSession` (`src/trainer/session.ts`) now handles every controlled ride, workout, FTP test and manual check. It replaces the opt-in `VITE_TRAINER_CONTROL=pilot` build and its separate SIM/ERG supervisors; their records are in [history](history/).

## When BikeSIM may change the load

- **Settings → Trainer → Let BikeSIM control my KICKR** is off by default. Every session checks it when it opens, and a backup import keeps the current value instead of restoring an old one.
- Pairing never arms control. A session opens only when you press Start on a trainer-controlled ride, the FTP test or the manual check, and only while BikeSIM is the visible tab.
- One tab at a time: a Web Locks lock (`bikesim-trainer-control`) refuses a second controlling tab.
- The trainer must acknowledge control writes (FTMS control point with write and indicate). ERG also needs a 1 W power increment and a range that covers the session's ceiling.

## Lifecycle

```
waiting ─(fresh telemetry)→ arming ─(request, first load, start)→ active ⇄ holding
   │                                                                  │
   └──────────── release (flat road, keep telemetry) / stop / fault ──┘
```

| Moment           | FTMS control point writes (0x2AD9)                                                    |
| ---------------- | ------------------------------------------------------------------------------------- |
| Arming           | Request Control `0x00`, first load, Start `0x07`                                      |
| First load       | ERG: Set Target Power `0x05` at 50 W (FTP test: 50, 75 or 100 W). SIM: flat road      |
| Riding           | ERG: target watts. SIM: Indoor Bike Simulation `0x11` with grade, no wind, Crr and Cw |
| Pause (hold)     | ERG: the start load. SIM: 0%                                                          |
| Finish (release) | SIM 0% with the ride's Crr and Cw. Telemetry stays connected                          |
| Fault            | Stop `0x08 01`, then the ride pauses and says why                                     |

Normal riding never sends Stop. On the KICKR, Stop hands control back to the trainer's own default load, which riders felt as a heavier jump mid-ride. Stop is reserved for faults and for **Send FTMS Stop** in the manual check.

Every write is serialized and must be acknowledged within 2.5 s. A rejection or missing acknowledgement is a fault. If Stop itself cannot be confirmed, BikeSIM drops the Bluetooth connection and says the physical load is unknown.

**Rate limits.** Load reductions for a pause or low cadence apply at once. ERG increases rise by at most 25 W per second. SIM slope moves by at most 0.5 percentage points per second in either direction while riding.

**Envelopes.**

| Session        | Allowed                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------- |
| Road (SIM)     | −10% to +12% after trainer difficulty (the KICKR CORE 2 simulates up to 16%)                |
| Workout (ERG)  | 40–600 W; each ride's ceiling is its highest target at 110% intensity, checked before start |
| FTP test (ERG) | Gentle ramp up to 300 W, standard ramp up to 600 W                                          |
| Manual check   | SIM −1% to +1%, or ERG 50–100 W                                                             |

## What happens when…

| Event                                                          | What BikeSIM does                                                             |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Pause button, Space or Esc                                     | Ride pauses; trainer holds the light load. Resume continues the same session  |
| Tab hidden                                                     | Same as pause                                                                 |
| Power stale for 3 s                                            | Ride pauses and the trainer holds the light load                              |
| Browser timers frozen for over 2.5 s                           | Trainer holds the light load until you resume                                 |
| Another app takes control, or the trainer resets or is stopped | Session ends without further writes; the ride pauses                          |
| Bluetooth disconnects                                          | Fault; the ride pauses and the physical load is unknown                       |
| Page closed or refreshed                                       | Best-effort release onto a flat road; the ride is saved as interrupted        |
| Resume after control ended                                     | A fresh session: flat road first for SIM, pedaling above 50 rpm first for ERG |

## Roads (SIM)

The trainer receives the grade of the same course the physics engine uses, at your current distance, multiplied by **trainer difficulty** (Settings, 0–100% in 5% steps, default 100%). The screen, virtual speed and saved ride always use the real grade. Coasting at 0 W and 0 rpm is normal and never ends control. The ride clock waits until the trainer holds its flat start.

FTMS simulation carries grade, wind, rolling resistance (Crr 0.004) and a wind coefficient Cw = ½ρ·CdA, the same values the virtual physics uses (0.16 kg/m on the hoods at 1,550 m). It carries no rider weight or wheel size: the KICKR uses its own profile from the Wahoo app, so keep that profile matching BikeSIM's Settings. On a steep virtual descent the screen can speed up while the flywheel slows; the trainer brakes but cannot drive the pedals.

## Workouts (ERG)

Pedal above 50 rpm with live power and the trainer starts at 50 W; the countdown begins once that load is acknowledged. Interval targets follow your FTP, ramps and the 80–110% intensity setting (↑/↓). The ride screen shows the target, your measured power and the trainer's acknowledged load separately.

The KICKR sometimes reports 0 rpm for a moment while you pedal. Those readings are ignored. Only three continuous seconds below 50 rpm (or without fresh cadence) ease the trainer to 50 W, with a soft double beep. Spin above 55 rpm for two seconds and the target returns, ramping up at 25 W per second. The ride keeps going throughout; nothing sends Stop.

Workouts with a cadence target below 50 rpm cannot use ERG; the app explains why before starting. Workouts ride on their own generated road that climbs during hard intervals. That climb is visual only; ERG never sends slope.

## FTP test

The ramp test uses an ERG session at the chosen starting load (50, 75 or 100 W). The warm-up clock runs only while you pedal: after three seconds of low cadence the trainer eases to the starting load and the warm-up waits for you. During the ramp, sustained low cadence means you could not hold the step, so the test finishes with a result from measured power, exactly like pressing **I've reached my limit**. Brief 0 rpm glitches no longer break the best-minute window. Hiding the tab holds the starting load during the warm-up and ends the test with the data so far during the ramp. A result is saved only after the trainer confirms the flat road (or Stop). See [FTP assessment](FTP_ASSESSMENT.md).

## Manual check

The trainer page (top-right chip) has a check for feeling small changes: SIM from −1% to +1%, or ERG from 50 to 100 W. End it with **End on a flat road** or **Send FTMS Stop** to compare the two endings on the bike. Its evidence (observations, machine status bytes and the command audit) saves locally and downloads as JSON.

## Hardware checklist (pending)

This lifecycle is verified with a synthetic KICKR in unit and browser tests. None of it has been felt on the real trainer yet. With the rider on the bike and ready to stop at any moment:

1. **Setup.** Wahoo app profile matches Settings (70 kg, 700×32C). Close the Wahoo app, Zwift and anything else that controls the trainer. Turn on the Settings switch. Pair and pedal: live power appears.
2. **SIM start and pause.** Ride Teotitlán del Valle with **Trainer sets the slope**. Expect: flat before the countdown, slope building gradually on the rise, Pause returning to flat within a second, Resume building the slope back up.
3. **SIM finish.** Finish the ride. Expect the pedals to stay easy (flat road), with no jump to a heavier load.
4. **Difficulty.** Set trainer difficulty to 50% and ride the start of San Felipe del Agua. The climb should feel about half as steep while the screen shows the real grade.
5. **ERG.** With FTP set, ride **First five minutes** with **Trainer holds the watts**. Expect 50 W after you pass 50 rpm, then the targets. Stop pedaling for more than three seconds: double beep and 50 W. Spin up: the target returns. Pause: 50 W. Finish: flat road.
6. **Endings.** In the manual check, compare **End on a flat road** with **Send FTMS Stop**.

Report anything abrupt, stuck or heavier than expected. If something goes wrong, download the ride's session JSON from its summary; it lists every control state change.
