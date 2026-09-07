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

Status: **mock-tested pilot implemented; physical test pending**. Default builds keep it disabled.

Implemented prerequisites: HT-1 recorded, actual supported ranges known, request/power/start/stop payloads checked, an exclusive browser lock, serialized writes with matching indications, 2.5-second acknowledgement timeout without retries, fresh power/cadence guards, minimum 50 rpm cadence, 100 W pilot ceiling, 10 W/second ramp limit, stop priority, and synthetic fault tests. This tab lock cannot exclude Wahoo or other native controllers. The rider must be present and ready before any load changes.

1. Start the opt-in pilot server using the README command, reload Chrome, and open Trainer. Close any other app's active trainer-control session if it prevents control acquisition.
2. Pair, pedal above 50 rpm, and confirm fresh readings. The rider selects the readiness checkbox and clicks **Start 50 W test**. Confirm the displayed acknowledgement and a comfortable physical load.
3. If comfortable, select **75 W**, maintain cadence, and check that resistance changes gradually. Testing 100 W is optional.
4. Select **Stop trainer test** while pedaling. Record whether the standard stop was acknowledged and how the physical resistance felt afterward. Stop concludes the session and disconnects; no automatic resumption occurs.
5. Export the control log. Record the rider's observations separately; command acknowledgements alone do not establish load response.

No SIM commands are included in this pilot. Do not assume FTMS Reset or flat SIM unloads the trainer. Do not deliberately kill a controlling process under load until the fallback behavior has been established and the supervised test protocol accounts for retained resistance. If the physical response is uncomfortable or uncertain, end the test; do not escalate the target to diagnose it.

Protocol references: [Bluetooth SIG FTMS](https://www.bluetooth.com/specifications/specs/fitness-machine-service-1-0-1/) and [Huawei FTMS control-point implementation documentation](https://developer.huawei.com/consumer/fr/doc/HMSCore-Guides/fmcp-0000001050147089). Request Control `00`; Target Power `05` + signed little-endian watts; Start `07`; Stop `08 01`; response `80` + requested opcode + result (`01` success). These protocol checks do not substitute for the physical stop test.

## HT-3 — First controlled workout

Status: **blocked on HT-2**.

Complete a short workout with warm-up and cooldown. Record acknowledgements, interval alignment, manual pause/stop response, failed command behavior, explicit resumption, and rider feedback. A browser crash/disconnection cannot be reported as a successful stop without observed hardware evidence.
