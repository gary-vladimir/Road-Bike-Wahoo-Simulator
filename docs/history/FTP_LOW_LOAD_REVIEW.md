# Review of the reported loss of pedal pressure

> **Historical evidence review.** Findings about a ride or test file at the time; the app has changed since. Current behavior: [trainer control](../TRAINER_CONTROL.md).

Input: `bikesim-ftp-3beaad99-6926-4434-9fc1-a2f941a42a32.json`, September 18, 2026. The rider clarified that the flywheel coasts freely when pedaling stops; the cranks do not force the rider’s feet around. This supports loss of pedal pressure/freewheeling rather than the originally ambiguous description of the flywheel driving the pedals. It does not independently rule out every mechanical issue.

## Recorded evidence

- The entire attempt is **219.0969 seconds (3:39.1) of warm-up**. The 5-minute warm-up never completed, so no ramp step or FTP measurement occurred.
- Every requested and acknowledged target is **50 W**.
- Time-weighted mean measured power is **47.74 W**; mean cadence is **70.05 rpm**. Recorded power ranges from 12 to 85 W and cadence from 53 to 77 rpm.
- Minute-by-minute mean power: **48.02, 46.93, 47.33 W**, then **49.16 W** over the final 39 seconds.
- The result is marked invalid with a generic power/cadence fault and **Stop confirmed**.
- This older report records only valid observations. The triggering observation, telemetry freshness times and command audit are absent. Therefore the exact trigger (low cadence versus missing/stale data) cannot be proved from this file. There is no saved zero-watt sample; that does not refute the rider’s account because the failing observation was omitted by this version.

The reported power is consistent with maintaining a low ERG load. It does not establish independently measured torque or exclude trainer-side reporting/smoothing effects. There is no evidence in this report of a hidden higher target, incorrect watt scaling, or virtual-road physics changing the load.

## App changes

The preceding update allows explicit 50/75/100 W startup and warm-up targets, avoids a drop back to 50 W when the ramp begins, and retains terminal telemetry and command diagnostics.

This update fixes the warm-up lifecycle: a coast/cadence interruption still stops trainer control, but after acknowledged Stop it pauses the warm-up rather than permanently invalidating the assessment. The rider may deliberately re-arm at the approved starting load; no automatic re-arm occurs. Time spent recovering does not advance the warm-up. The ramp remains uninterrupted, and faults during it still invalidate the result.

For the next physical check, choose 75 W only if comfortably easy, hold a comfortable steady cadence rather than accelerating to chase the flywheel, and briefly test warm-up coast/recovery before attempting a maximal ramp. A larger rear cog reduces flywheel speed at a given cadence, but does not add resistance watts to ERG. Wahoo’s trainer controller manages the physical flywheel; BikeSIM does not add a hidden inertia/brake correction. See [Wahoo’s low-resistance guidance](https://support.wahoofitness.com/hc/en-us/articles/4402745347858-Trainer-resistance-is-too-low).

Raw personal input is kept outside Git. No physical trainer commands were sent by development tools.
