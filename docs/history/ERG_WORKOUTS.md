# Automatic ERG workouts

> **Historical (September 17, 2026).** Describes the retired opt-in pilot build. Current ERG behavior: [trainer control](../TRAINER_CONTROL.md).

Implemented September 17, 2026 in the opt-in trainer-control build. This connects the existing workout library and editor to physical target-power control. SIM roads remain the normal free-riding mode.

## Start and ride

1. Enter your known FTP in Settings; do not use the demo's example FTP for physical control.
2. Pair the KICKR in Trainer and confirm live power/cadence. End other apps' trainer-control sessions.
3. In Workouts, choose a preset or custom workout and **KICKR · automatic ERG workout**. Review its watt range and confirm readiness.
4. Pedal above 50 rpm. BikeSIM waits without sending load commands until telemetry passes the guard, then requests control, sets 50 W and starts the trainer. The ten-second countdown begins only after arming succeeds.
5. After the countdown, interval targets follow FTP, linear ramps and the current 80–110% intensity setting. The main target is the workout request; the trainer panel shows the last acknowledged target, which can lag because writes ramp by at most 10 W per second. Neither value is measured power; measured power remains separate.

Wahoo recommends the small front chainring and a middle rear cog for ERG, with steady cadence ([official ERG guide](https://support.wahoofitness.com/hc/en-us/articles/4402565516946-A-Guide-to-using-ERG-mode)). Physical shifting is primarily useful in SIM; in ERG, the trainer adjusts resistance to the requested watts. Decorative workout hills do not add SIM slope commands.

## Limits and lifecycle

- Automatic workouts use a distinct power grant, bounded by the selected workout's maximum at 110% intensity (or the 50 W startup value if higher), with an overall 40–600 W envelope. Every block endpoint at 80% and 110% is checked before starting. Unsupported plans explain why; targets are not silently clamped. The device's advertised range must cover the workout and support 1 W steps.
- The original diagnostic ERG panel retains its independent 50–100 W restriction. SIM slope scopes remain unchanged.
- Fresh power and cadence are required. Cadence below 50 rpm, stale telemetry, hidden tabs, keyboard Stop, revoked control and timing/acknowledgement faults stop control and pause the workout. Stop acknowledgement does not imply physical unloading.
- A workout prescribing cadence below 50 rpm cannot use automatic ERG while this guard is in place; the UI explains the conflict before arming. Live-power guidance remains available.
- Pause and completion use the shared SIM/ERG shutdown coordinator. Finish waits for shutdown before showing the saved summary. Unacknowledged shutdown exposes an unknown-load state and disconnects without retrying resistance commands.
- Resume is deliberate, requires the old controller to finish, starts a new 50 W ERG session after cadence is ready, and runs a three-second countdown. Time does not advance while waiting to arm. The workout resumes from its saved elapsed position, with ramp-limited target changes.
- Saved sessions retain `trainerControl: 'erg'`, actual power, requested workout targets, and acknowledged-target events. Restore/import opens saved history without re-arming the trainer. FIT exports actual measured power, indoor cycling metadata and an ERG description; it never substitutes target watts for measurements.

## Physical validation still needed

Software tests use synthetic GATT. Earlier diagnostic tests did not establish sustained ERG tracking accuracy. The September 17 SIM file also contains positive power with intermittent zero cadence, which may trigger the ERG guard. No cadence threshold is relaxed and no resistance commands are sent by development tools.

The next manual check is a comfortable selected workout at the rider's known FTP: confirm measured power settles near the acknowledged target, try Pause/Resume, and finish/export. If it pauses despite steady pedaling, save session JSON and the observed cadence; those results are more informative than repeating 50/75/100 W by feel alone. Do not change FTP solely to satisfy app limits.
