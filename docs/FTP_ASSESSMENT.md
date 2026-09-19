# Guided FTP assessments

BikeSIM offers **Take an FTP test** in Workouts and Settings. No prior FTP is required. The feature uses the opt-in trainer-control build and the existing KICKR Bluetooth ERG adapter. Pairing alone never starts it.

## Protocol and result

Before arming, choose an explicit starting load of 50, 75 or 100 W. The default remains 50 W; changing it clears readiness and does not send commands. Both protocols warm up for five minutes at the chosen load, which is also the initial ERG command. Gentle rounds its first ramp stage up to the next 10 W step (50, 80 or 100 W) and adds 10 W each minute, up to 300 W. Standard starts the ramp at 100 W and adds 20 W each minute, up to 600 W. The load never drops back to 50 W at the warm-up/ramp boundary. Subsequent commands retain the 10 W/second ramp. Existing ordinary workout and diagnostic startup remains 50 W. There are no intensity changes or skipped warm-ups. Warm-up recovery is allowed after confirmed Stop; the measured ramp cannot be paused and resumed.

The configurable starting load addresses a usability limitation reported on the physical KICKR: fixed 50 W can feel almost unloaded. This is not proof of a firmware or command fault. [Wahoo describes how cadence, flywheel speed and a low target affect ERG resistance](https://support.wahoofitness.com/hc/en-us/articles/4402745347858-Trainer-resistance-is-too-low). The app does not add a hidden brake offset or use simulated road inertia to change ERG targets. Wahoo’s ERG controller handles the physical flywheel. Keep cadence steady rather than accelerating to chase displayed watts; let the flywheel slow before another attempt. A larger rear cog reduces flywheel speed for a given crank cadence without increasing an ERG watt target.

The live panel compares the last ten seconds of measured power and acknowledged targets. This is a tracking observation, not a calibration verdict. Reported ERG speed can be simulated by trainer settings and is not used as a direct flywheel-speed measurement.

The rider explicitly ends a maximal effort with **I’ve reached my limit**. After confirmed trainer Stop, the app estimates FTP as 75% of the best measured rolling 60-second power during the ramp. It integrates readings by their actual durations, includes partial stages, and excludes warm-up power. It never calculates FTP from requested watts, body weight, demo readings, or an ordinary ride average.

This follows the general ramp-test approach described by [ROUVY](https://rouvy.com/blog/cycling-training-zones-guide), with [10 W/min and 20 W/min protocol options](https://support.rouvy.com/hc/en-us/articles/360020119778-FTP). The chosen warm-up, ceilings, minimum data requirements, and acceptance checks are BikeSIM implementation decisions, not a claim of identical ROUVY software or clinical validation. [Wahoo explains limitations of the 75% rule](https://support.wahoofitness.com/hc/en-us/articles/4404067414418-The-Half-Monty-fitness-assessment-Everything-you-need-to-know); the UI calls the result an estimate. Individual anaerobic capacity and testing conditions affect accuracy.

## Acceptance and interruptions

- At least three ramp minutes must be recorded, including a continuous valid 60-second window.
- The best minute must track its mean acknowledged target within 15% or 10 W, whichever is greater. This catches grossly unresponsive ERG behavior but is not independent power-meter calibration.
- The result must fall within the existing 50–600 W settings range.
- Zero power alone is valid telemetry. Cadence below 50 rpm or unreliable telemetry still stops control. Before the ramp begins, an interruption with confirmed Stop pauses the warm-up and freezes its active clock. Let the flywheel slow and check the physical load, then explicitly choose **Resume warm-up**. This creates a fresh control session at the approved starting load and waits for steady pedaling; restored cadence alone never re-arms control. Recovery time is excluded, and completed warm-up time is retained. Warm-up interruptions are logged in the report. Unknown Stop outcome prevents recovery.
- During the measured ramp, stale power/cadence, cadence below 50 rpm, timing interruptions, visibility loss, disconnects, or other controller faults invalidate the attempt. A mid-ramp rest cannot be used to inflate the FTP estimate. Cancel and reaching the ceiling without declaring maximal effort also leave FTP unchanged.
- Cadence loss is not assumed to mean exhaustion: the earlier KICKR file contained intermittent zero cadence under positive power. The rider should use the effort button while still pedaling before the guard trips. A fault cannot be relabeled as a successful test.
- Stop is serialized and awaited. Unknown physical load is disclosed. No automatic cooldown commands are issued after Stop, which can restore the trainer’s previous load; establish a comfortable load before cooling down.

## Local storage

A valid estimate and its assessment report are committed atomically to IndexedDB, automatically updating rider FTP. Other rider settings are preserved. Workouts use the new FTP after returning from the test. Lower FTP values can still expose workouts whose requested targets fall below the existing 40 W control floor; the app explains that limit instead of inflating FTP.

The assessment starts with a persisted in-progress record and checkpoints every five seconds. Reloads recover it as interrupted, never resume control, and never update FTP from partial evidence. Up to 50 attempts are retained in assessment history, accessible from either entry point, and included in normal backups. Reports contain protocol, starting load, timestamps, measured power/cadence, targets, acknowledged watts, outcome and calculation evidence. Final reports also retain the last telemetry observation (including an observation causing a fault), its source timestamps, the final controller message and a bounded command-audit tail. Older reports remain importable with their original 50 W start. Reports can be downloaded as JSON, including if local saving fails. They are assessment records rather than simulated road rides; no virtual kilometers or FIT activity are generated for this feature.

Backup import validates assessment structure and recalculates any claimed estimate before committing. Importing history does not trigger control or automatically recalculate the imported rider profile. A stored FTP can still be edited manually in Settings.

## Validation

Automated tests cover weighted/partial-stage calculations, warm-up exclusion, unsupported results, waiting and delayed preparation, cancellation, cadence/power/timing faults, the ceiling, unknown Stop outcome, atomic settings updates and backup validation. Browser tests use synthetic Bluetooth and an accelerated clock, including the live display, result saving, profile reload, and unchanged FTP on invalid attempts. These do not establish physical power accuracy or validate a maximal test on the real KICKR.
