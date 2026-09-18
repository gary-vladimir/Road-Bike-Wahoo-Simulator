# Guided FTP assessments

BikeSIM offers **Take an FTP test** in Workouts and Settings. No prior FTP is required. The feature uses the opt-in trainer-control build and the existing KICKR Bluetooth ERG adapter. Pairing alone never starts it.

## Protocol and result

Both protocols warm up for five minutes at 50 W. Gentle starts its ramp at 50 W and adds 10 W every minute, up to 300 W. Standard starts at 100 W and adds 20 W each minute, up to 600 W. The same 10 W/second command ramp applies, so acknowledged targets briefly lag at stage transitions. There are no intensity changes, skipped warm-ups, or pause/resume within an assessment.

The rider explicitly ends a maximal effort with **I’ve reached my limit**. After confirmed trainer Stop, the app estimates FTP as 75% of the best measured rolling 60-second power during the ramp. It integrates readings by their actual durations, includes partial stages, and excludes warm-up power. It never calculates FTP from requested watts, body weight, demo readings, or an ordinary ride average.

This follows the general ramp-test approach described by [ROUVY](https://rouvy.com/blog/cycling-training-zones-guide), with [10 W/min and 20 W/min protocol options](https://support.rouvy.com/hc/en-us/articles/360020119778-FTP). The chosen warm-up, ceilings, minimum data requirements, and acceptance checks are BikeSIM implementation decisions, not a claim of identical ROUVY software or clinical validation. [Wahoo explains limitations of the 75% rule](https://support.wahoofitness.com/hc/en-us/articles/4404067414418-The-Half-Monty-fitness-assessment-Everything-you-need-to-know); the UI calls the result an estimate. Individual anaerobic capacity and testing conditions affect accuracy.

## Acceptance and interruptions

- At least three ramp minutes must be recorded, including a continuous valid 60-second window.
- The best minute must track its mean acknowledged target within 15% or 10 W, whichever is greater. This catches grossly unresponsive ERG behavior but is not independent power-meter calibration.
- The result must fall within the existing 50–600 W settings range.
- Cancel, stale power/cadence, cadence below 50 rpm, timing interruptions, visibility loss, disconnects, or other controller faults invalidate the attempt. Reaching the ceiling without declaring maximal effort also leaves FTP unchanged.
- Cadence loss is not assumed to mean exhaustion: the earlier KICKR file contained intermittent zero cadence under positive power. The rider should use the effort button while still pedaling before the guard trips. A fault cannot be relabeled as a successful test.
- Stop is serialized and awaited. Unknown physical load is disclosed. No automatic cooldown commands are issued after Stop, which can restore the trainer’s previous load; establish a comfortable load before cooling down.

## Local storage

A valid estimate and its assessment report are committed atomically to IndexedDB, automatically updating rider FTP. Other rider settings are preserved. Workouts use the new FTP after returning from the test. Lower FTP values can still expose workouts whose requested targets fall below the existing 40 W control floor; the app explains that limit instead of inflating FTP.

The assessment starts with a persisted in-progress record and checkpoints every five seconds. Reloads recover it as interrupted, never resume control, and never update FTP from partial evidence. Up to 50 attempts are retained in assessment history, accessible from either entry point, and included in normal backups. Reports contain protocol, timestamps, measured power/cadence, targets, acknowledged watts, outcome and calculation evidence. Reports can be downloaded as JSON, including if local saving fails. They are assessment records rather than simulated road rides; no virtual kilometers or FIT activity are generated for this feature.

Backup import validates assessment structure and recalculates any claimed estimate before committing. Importing history does not trigger control or automatically recalculate the imported rider profile. A stored FTP can still be edited manually in Settings.

## Validation

Automated tests cover weighted/partial-stage calculations, warm-up exclusion, unsupported results, waiting and delayed preparation, cancellation, cadence/power/timing faults, the ceiling, unknown Stop outcome, atomic settings updates and backup validation. Browser tests use synthetic Bluetooth and an accelerated clock, including the live display, result saving, profile reload, and unchanged FTP on invalid attempts. These do not establish physical power accuracy or validate a maximal test on the real KICKR.
