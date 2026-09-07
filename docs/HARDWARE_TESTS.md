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

No control-point writes, trainer calibration, reset, or firmware operations are implemented. Do not infer resistance safety from this read-only test.

Observations to record: macOS/Chrome versions, device firmware if available through existing Wahoo tooling, feature bits, power range and step, available metrics, packet rate, units, disconnect behavior, and any competing-controller message. Device serial numbers are unnecessary for the committed log.

## HT-2 — Future supervised low-load control

Status: **not implemented; do not run**.

Prerequisites: HT-1 recorded, actual supported ranges known, standard command payloads verified, a single command owner, acknowledgement timeouts, stale/cadence guards, conservative numeric limits, command ramping, stop priority, and fault-injection tests. The rider must be present and ready before any load changes.

Prepare exact targets and a manufacturer-supported recovery procedure from the actual device evidence. Test ERG and SIM separately. Do not assume FTMS Reset or flat SIM unloads the trainer. Do not deliberately kill a controlling process under load until the fallback behavior has been established and the supervised test protocol accounts for retained resistance.

## HT-3 — First controlled workout

Status: **blocked on HT-2**.

Complete a short workout with warm-up and cooldown. Record acknowledgements, interval alignment, manual pause/stop response, failed command behavior, explicit resumption, and rider feedback. A browser crash/disconnection cannot be reported as a successful stop without observed hardware evidence.
