# Hardware validation log

## September 16 — automatic Valley completion confirmed

The rider completed the 3 km Valley warm-up using automatic SIM terrain, reported realistic resistance and live data, and supplied the downloaded FIT. Official Garmin decoding confirms file integrity, 476.6 seconds of riding and continued distance during zero-watt coasts. See the [ride review](VALLEY_RIDE_REVIEW.md) for measurements and inferred slopes. The observed shallow-downhill slowdown is consistent with rolling/air drag exceeding gravity.

This establishes the complete start-to-finish ride and export flow on the physical setup. It does not establish mid-ride pause/resume (the FIT contains no pause), physical load after Stop, connection-loss recovery or Strava import. Those portions of the protocol below remain pending. No additional physical trainer commands were sent during development.

## September 12 — next check: controlled Valley warm-up ride

Automatic SIM road control is implemented in the opt-in build. Software tests use synthetic GATT; development tools have not started a physical ride. Use this check when ready; no further ERG test is needed first.

1. With the trainer test/ride stopped, reload BikeSIM. Pair again if Chrome needs it. Confirm fresh telemetry, comfortable baseline, and matching Wahoo/BikeSIM weight and wheel settings; end Wahoo's trainer-control session.
2. Open **Ride → Valley warm-up** and select **KICKR · automatic SIM terrain**. Confirm readiness and select **Start SIM road ride**. Flat SIM starts before the countdown; it may change the pre-existing load.
3. Ride at your own cadence and shift naturally. The first 400 meters are flat, the road rises to +1% at 1 km, and later descends to −0.5% at 2.4 km. The HUD shows route grade and the last acknowledged trainer slope separately.
4. Briefly coast and then re-engage while comfortable. Fresh 0 W / 0 rpm should continue the simulation without the ERG cadence cutoff. On this very gentle descent, drag can still slow a fast-moving rider; do not expect unlimited downhill acceleration.
5. Pause, observe the Stop result and physical load, then resume deliberately when comfortable. Check the fresh countdown and return to terrain control. Stop may restore a heavier prior load; it does not promise unloading.
6. Complete the 3 km road or choose **Pause → Finish & save ride**. Check that control ends and the saved summary opens. Download FIT and manually import it to Strava. Export session JSON if a problem occurs; it includes slope transitions and control outcomes.

Report any unexpected disconnection, abrupt load, cadence-triggered stop, failed resume, or FIT import error. Do not deliberately provoke a disconnect under load for this first route check. The remaining steeper roads retain preview-only access until the controlled ride and recovery behavior have been checked.

## September 11 — BikeSIM SIM response confirmed; ERG still under investigation

The rider reports that BikeSIM's SIM terrain slope test worked well and that slope changes were clearly felt. This is physical feedback about BikeSIM, beyond the earlier successful Wahoo comparison. Record SIM slope response as confirmed; the message does not separately establish restart, connection-loss behavior, or a completed route. Full route-control integration is now the next development step. ERG validation is separate and does not block ordinary SIM road development.

The rider still reports little perceived difference between ERG 50/75/100 W. The [saved September 11 ERG evidence](../tests/fixtures/kickr-erg-2026-09-11.json) was downloaded through the existing Chrome panel without starting a test, changing modes, reloading, or sending trainer commands. It matches the rider's screenshot:

| Target | Observed interval | Post-settling average | Power samples | Cadence average |
| ------ | ----------------- | --------------------- | ------------- | --------------- |
| 50 W   | 12.5 s            | 61.5 W                | 2             | 73.5 rpm        |
| 75 W   | 12.5 s            | 74.7 W                | 3             | 83.3 rpm        |
| 100 W  | 23.0 s            | 88.2 W                | 13            | 74.6 rpm        |

The table removes the first ten seconds and repeated sensor timestamps, leaving very few readings at 50 and 75 W. “Settled” describes a time exclusion, not proven steady cadence or convergence. The 75 W interval contains repeated 74–76 W readings and dips to 55–56 W. The 100 W interval repeatedly reports 99–100 W, interspersed with 74–75 W and one 50 W reading. All requested power ramps and the final Stop were acknowledged. This is evidence of a response, not accurate continuous target tracking or independent brake-force measurement. Power smoothing, cadence changes, and drivetrain engagement remain possible influences; no cause is established by this log alone.

At about 56.9 seconds after the first control write, a sample reports 99 W with zero cadence; Stop is acknowledged at 57.17 seconds. The next distinct sample reports 100 W / 77 rpm, followed by zero-power readings. The ERG cadence guard again ends the test; calculated cadence cannot establish whether the rider actually stopped pedaling. The zero also lowers the 100 W cadence average.

Wahoo explains that increasing cadence reduces ERG braking and that gear selection can limit achievable low power; it recommends a small front chainring and middle rear cog for a repeatable ERG comparison ([ERG guide](https://support.wahoofitness.com/hc/en-us/articles/4402565516946-A-Guide-to-using-ERG-mode)). The rider's current gear is not recorded. Do not assume a stuck resistance setting, bad cassette, or faulty trainer, and do not raise targets just to provoke stronger feel. If ERG is investigated further, compare longer steady-cadence holds in the same gear against Wahoo ERG with only one controller active. No additional ERG repetition is a prerequisite for SIM integration.

**Latest next step (September 10):** the rider confirmed that Wahoo Simulation adds realistic slope resistance and permits natural shifting, with 700×32C configured. Rider weight is 70 kg. The separate BikeSIM **SIM · terrain test** is now implemented for HT-3 below. This supersedes repeating the low-power ERG protocol. Wahoo's success is rider-reported physical evidence; BikeSIM SIM road feel still needs its own check.

## HT-1 — Read-only Bluetooth telemetry

Status: **connection and pedaling confirmed; reconnect/fault scenarios still pending**.

Environment: local Chrome on the MacBook, BikeSIM served by the Docker devcontainer at `http://localhost:5186`. Native UI automation is now available. BikeSIM connected to the KICKR CORE through Chrome's Bluetooth chooser on September 7, 2026. Seven FTMS characteristics were discovered; ERG and SIM target capabilities were advertised; the supported target-power range reported 0–2000 W in 1 W steps. Idle readings were 0 W / 0 rpm / 0 km/h, and changing coasting readings were observed. The rider pedaled and explicitly confirmed that the live readings work. No control-point writes were made. Deliberate disconnect/reconnect and physical load behavior have not yet been validated.

1. Open **Trainer** and click **Pair KICKR via Bluetooth**.
2. Select the actual KICKR CORE 2 in Chrome's chooser. Allow the expected Bluetooth permission if requested.
3. Confirm diagnostics say connected. Pedal gently and check watts/cadence are plausible.
4. Inspect advertised features and supported power range. Export diagnostics if a detailed review is needed.
5. Stop pedaling and confirm fresh zero values are distinguished from absent/stale fields.
6. Disconnect from BikeSIM. Confirm diagnostics blank stale readings. Reconnect explicitly; no workout should start automatically.

No control-point writes were made during HT-1. Calibration, reset, and firmware operations are not implemented. Do not infer resistance safety from this read-only test.

Observations to record: macOS/Chrome versions, device firmware if available through existing Wahoo tooling, feature bits, power range and step, available metrics, packet rate, units, disconnect behavior, and any competing-controller message. Device serial numbers are unnecessary for the committed log.

## HT-2 — Supervised low-load ERG control

Status: **actual target/start/stop acknowledgements captured; physical watt tracking remains unresolved**. Default builds keep it disabled. Before repeating this test, follow [physical setup and baseline guidance](TRAINER_SETUP.md). The rider reports about 150 W at 50 rpm in the large chainring; the cadence threshold is not evidence of an easy starting load. On September 9 the rider felt a strong load reduction during the test and heavier load returning afterward. Stop must not be presented as unloading.

Implemented prerequisites: HT-1 recorded, actual supported ranges known, request/power/start/stop payloads checked, an exclusive browser lock, serialized writes with matching indications, 2.5-second acknowledgement timeout without retries, fresh power/cadence guards, minimum 50 rpm cadence, 100 W pilot ceiling, 10 W/second ramp limit, stop priority, and synthetic fault tests. This tab lock cannot exclude Wahoo or other native controllers. The rider must be present and ready before any load changes.

1. Start the opt-in pilot server using the README command, reload Chrome, and open Trainer. Close any other app's active trainer-control session if it prevents control acquisition.
2. Pair and confirm fresh readings. The rider selects the readiness checkbox and clicks **Start 50 W test**. At zero cadence it should say waiting and remain connected; Stop should cancel without sending any resistance command. Start again, pedal above 50 rpm, and confirm the displayed acknowledgement and a comfortable physical load.
3. If comfortable, select **75 W**, maintain cadence, and check that resistance changes gradually. Testing 100 W is optional.
4. Select **Stop trainer test** while pedaling. Record whether the standard stop was acknowledged and how the physical resistance felt afterward. Stop concludes the test and retains telemetry after a successful acknowledgement; no automatic resumption occurs. A failure to confirm Stop can disconnect with an explicit unknown-load message.
5. Export the control log. Record the rider's observations separately; command acknowledgements alone do not establish load response.

No SIM commands are included in this pilot. Do not assume FTMS Reset or flat SIM unloads the trainer. Do not deliberately kill a controlling process under load until the fallback behavior has been established and the supervised test protocol accounts for retained resistance. If the physical response is uncomfortable or uncertain, end the test; do not escalate the target to diagnose it.

Protocol references: [Bluetooth SIG FTMS](https://www.bluetooth.com/specifications/specs/fitness-machine-service-1-0-1/) and [Huawei FTMS control-point implementation documentation](https://developer.huawei.com/consumer/fr/doc/HMSCore-Guides/fmcp-0000001050147089). Request Control `00`; Target Power `05` + signed little-endian watts; Start `07`; Stop `08 01`; response `80` + requested opcode + result (`01` success). These protocol checks do not substitute for the physical stop test.

### September 7 bug report and correction

The rider reported immediate disconnect on Start, ineffective Stop afterward, and lost connection on refresh. Native Chrome inspection showed `faulted · no power target acknowledged` with `Cadence below pilot minimum: 50 rpm`. Initial cadence validation had incorrectly led to full connection cleanup and left the UI attached to a disposed session. This was a software lifecycle bug, not evidence of a trainer refusal.

Start now waits for pedaling; cancellation and acknowledged stops retain telemetry; Stop is available during preparation/waiting and shows its result; fresh attempts no longer require a page reload. The upper Disconnect button stops an active test first. Synthetic unit and browser regressions cover these cases.

Read-only pairing was repeated successfully with the actual KICKR after the fix. Refresh was then tested without any resistance commands: Chrome did not restore the saved permission, and the new explicit Pair fallback appeared. Automatic refresh restoration passes with synthetic saved permissions but remains unavailable in this Mac's observed browser configuration. Physical load and Stop response still need a fresh rider check.

### September 9 actual command capture and response investigation

The rider could select 50, 75, and 100 W, but all felt very light. Starting the test reduced the pre-existing load; ending it restored a heavier feel. The existing Chrome tab was inspected without starting another test. Its final state was `faulted`, with the last target at 100 W and the reason `Cadence below pilot minimum: 50 rpm Stop acknowledged; physical load is not verified.`

The [captured control log](../tests/fixtures/kickr-erg-2026-09-09.json) contains successful FTMS responses to Request Control, 50 W, Start, the ramp through 60/70/75/85/95/100 W, and Stop `08 01`. Approximately 6.49 seconds elapsed from the 100 W acknowledgement to the Stop write. The record does not show whether the rider deliberately slowed or cadence dropped while trying to continue. It contains no simultaneous watts/cadence samples, so it cannot establish tracking, identify which mode existed beforehand, or distinguish a device response problem from gearing/cadence/settling effects. No new control commands were sent while inspecting it.

Wahoo describes ERG response delays, very light resistance at high cadence, and gear-dependent power limits in its [ERG guide](https://support.wahoofitness.com/hc/en-us/articles/4402565516946-A-Guide-to-using-ERG-mode). These are hypotheses to check against measurements, not a diagnosis. A competing Wahoo/other controller is another possibility; BikeSIM's browser lock cannot exclude it. Do not raise the pilot ceiling or change command ordering just to provoke a stronger sensation without evidence.

The updated **Check ERG target response** panel distinguishes selected, acknowledged, and trainer-measured watts, displays cadence and time at target, and records readings before/during/after the test. The table excludes the first ten seconds of each stable target observation and counts repeated sensor timestamps only once. Intermediate ramps and readings after Stop do not enter target averages. These are descriptive measurements, not automatic pass/fail or independent calibration. Raw machine-status notifications are also exported for interpretation alongside the command log.

Next manual check, only while comfortable:

1. Follow the comfortable-baseline setup first. Use the small front chainring and a middle rear cog; keep this gear fixed for the ERG comparison. End other trainer-control sessions.
2. With the test stopped, reload BikeSIM and pair again if needed. Open Trainer. Confirm comfortable read-only pedaling for about ten seconds before starting, to capture the baseline.
3. Select readiness and Start. Maintain a comfortable, steady cadence above 50 rpm; there is no need to spin fast to chase watts. Hold 50 W for twenty seconds after its acknowledgement. If comfortable, repeat at 75 W and 100 W, waiting until the selected target is acknowledged before timing each hold. Stop if uncomfortable rather than forcing the cadence threshold.
4. End the test. The prior heavier feel may return. Keep the panel open for fifteen seconds to capture the transition, but do not keep pedaling if uncomfortable. Record how it felt and whether the stop was manual or automatic.
5. Export the control test log. Selected targets and physical sensations alone are insufficient; review the settled measured-power/cadence table and raw samples. The last evidence checkpoint is also available through **Export last saved test** after reload, without restoring control.

If settled power does not track these targets, compare the same low targets in Wahoo's **Target Power/ERG** mode with BikeSIM control ended and the same gear/cadence. That comparison is a subsequent diagnostic, not a simultaneous second controller. Wahoo recommends checking operation in its own app in its [low-resistance troubleshooting](https://support.wahoofitness.com/hc/en-us/articles/4402745347858-Trainer-resistance-is-too-low). A matching symptom in Wahoo points beyond BikeSIM's command path; different behavior narrows the investigation to control integration. Neither result alone proves a hardware defect.

## HT-3 — Supervised SIM handoff and terrain

Status: **BikeSIM SIM slope response confirmed by the rider on September 11; full-route integration and remaining lifecycle checks pending**. The rider operated the manual pilot. No SIM command was sent by the development tools. Road previews still send no control commands. The checklist below remains the protocol reference; do not ask the rider to repeat already-confirmed slope feel merely because this section contains the original instructions.

The Bluetooth adapter checks SIM capability, acquires the same exclusive browser lock as ERG, and requires explicit readiness. Startup requests control, sends flat SIM parameters, then Start. Limits are ±1% with 0.25 percentage-point steps at most once per second. Fresh zero power/cadence is allowed; stale power, lost visibility/control, and timing faults end control. This browser lock cannot exclude another native app. Profile values are rider-confirmed, not read back or written through FTMS.

1. In Wahoo, verify the rider profile is 70 kg and the tire size is 700×32C. End/disconnect Wahoo control before BikeSIM takes over. Keep a comfortable starting load; do not assume it survives the handoff unchanged.
2. With no test running, reload BikeSIM to load the updated pilot. Pair again if needed. In **Trainer**, choose **SIM · terrain test** and confirm the displayed profile/readiness checkbox.
3. Click **Start flat SIM test**. Confirm flat slope acknowledgement, a comfortable load, and natural shifting. No watt target or minimum cadence applies.
4. If comfortable, select **0.5% slope**, then **1% slope**. Wait for the acknowledged slope to reach the selection. Shift naturally, coast briefly, and resume. Optionally compare **−0.5% slope**; no motor-driven downhill acceleration is promised.
5. Click **Stop trainer test**. Confirm Stop acknowledgement and record the physical feel; heavier prior load may return. Leave the panel open for 15 seconds, then export the log. Report whether slope changes, coasting/re-engagement, and Stop worked as expected.

This test changes physical resistance but does not advance a virtual route. Test virtual coasting separately with **Ride → Descent to the valley → Start road demo → Coast**. Full route control remains gated on BikeSIM handoff, slope, Stop, and restart observations. A 0% SIM grade includes rolling/aerodynamic load; it is not guaranteed unloading.

## HT-4 — First controlled ride/workout

Status: **pending HT-2 for ERG and HT-3 for SIM**.

Complete a short workout with warm-up and cooldown. Record acknowledgements, interval alignment, manual pause/stop response, failed command behavior, explicit resumption, and rider feedback. A browser crash/disconnection cannot be reported as a successful stop without observed hardware evidence.
