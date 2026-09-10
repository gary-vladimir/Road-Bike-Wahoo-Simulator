# Hardware validation log

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

Status: **not ready for a physical test; mock controller implemented only**. No SIM command has been sent to the actual KICKR by this development work. Road previews send no control commands.

Before exposing this pilot, confirm the actual trainer's rider/bike mass configuration, capability checks, exclusive control session, comfortable baseline handoff, and HT-2 Stop observations. The UI must require a fresh explicit rider action. Validate initial flat SIM by physical feel, then small gradual slopes and physical shifting, coasting, Stop, and manual restart before connecting complete routes. A 0% SIM grade is road simulation with rolling/aerodynamic load, not a guaranteed unload. Do not run this proposed test through the ERG controls.

## HT-4 — First controlled ride/workout

Status: **pending HT-2 for ERG and HT-3 for SIM**.

Complete a short workout with warm-up and cooldown. Record acknowledgements, interval alignment, manual pause/stop response, failed command behavior, explicit resumption, and rider feedback. A browser crash/disconnection cannot be reported as a successful stop without observed hardware evidence.
