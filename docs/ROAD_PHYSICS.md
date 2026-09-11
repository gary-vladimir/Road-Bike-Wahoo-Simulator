# Road physics and rider setup

September 10, 2026. The rider confirmed 70 kg, stock Giant Contend AR tubeless 700×32C tires, and realistic slope response/shifting in Wahoo Simulation. BikeSIM defaults to these rider/tire values. Existing custom settings are preserved; this Mac's Chrome profile was explicitly saved with the confirmed values. Bike mass remains a disclosed 9 kg estimate.

## Motion

Speed is integrated from rider power and road forces, not copied from trainer-reported speed or inferred from cadence. For forward speed `v`, total rider/bike mass `m`, and angle `atan(grade / 100)`:

```
drive force = 0.97 × max(power, 0) / max(v, 0.75 m/s)
road force = m × 9.81 × (sin(angle) + 0.004 × cos(angle))
air force = 0.18 × (v + headwind) × abs(v + headwind)
acceleration = (drive force − road force − air force) / m
```

Still air is the default. Rolling coefficient, wind coefficient (kg/m), and efficiency are assumptions, not calibrated measurements. The 0.75 m/s floor bounds launch force because crank torque and selected gear are unknown; walking-speed behavior is approximate.

The engine samples terrain along the traveled path at intervals no longer than 50 ms and integrates forces in steps no longer than 10 ms. It resolves a stop within a step so an uphill coast cannot add distance after reaching zero. Speed is forward-only, with a numerical ceiling of 150 km/h. Backward rolling and rider braking are not modeled yet.

- Downhill: gravity can exceed rolling/air resistance. Zero watts can accelerate from rest and accumulate distance until drag balances gravity.
- Flat: zero watts retains momentum, then drag and rolling resistance reduce speed.
- Uphill: zero watts retains momentum briefly, but climbing consumes it faster. The bike stops progressively.
- Fresh zero power/cadence is valid live data. Stale power pauses the ride; it is not interpreted as coasting.
- Explicit Pause freezes progress and resets speed. Resume requires a countdown; this differs from leaving the pedals still.

The scene follows the physics engine's distance rather than accumulating separate render-frame distance. The HUD identifies coasting and shows virtual wheel rotation. Sessions retain mass, wheel setup, and `physicsVersion: 2` in exports/backups.

## Wheel size and physical gears

Settings supports rim diameter, tire width, and a measured circumference override. 700×32C corresponds to 32-622 ([Schwalbe size table](https://www.schwalbe.com/media/97/93/b4/1700219698/Reifengroessen-uebersicht_EN.pdf)). The default 2155 mm is rounded `π × (622 + 2 × 32)`, a geometric estimate. Actual pressure, casing shape, and load affect rollout; it is not a manufacturer measurement.

Circumference converts virtual speed to virtual wheel RPM. It does not multiply measured watts or determine speed from cadence. Current gear and raw KICKR flywheel inertia are unavailable through the telemetry used here. Physical shifting and trainer inertia already exist in the hardware; adding guessed flywheel energy to measured power would distort motion. This virtual translational model does not reproduce exact flywheel/freehub behavior.

## Physical resistance boundary

The separately armed SIM pilot sends slope, still-air wind, rolling coefficient 0.004, and wind coefficient 0.18, limited to ±1% and 0.25 percentage-point changes per second. Flat startup is road load, not unloading. SIM does not prescribe watts or require pedaling during coasting.

FTMS simulation parameters contain no rider-mass or wheel-size field ([Bluetooth SIG test specification](https://files.bluetooth.com/wp-content/uploads/dlm_uploads/2024/10/FTMS.TS_.p6.pdf)). BikeSIM Settings does not rewrite Wahoo's trainer profile. Before the pilot, the rider verifies that profile and ends Wahoo control. Exported setup values record confirmed app settings, not trainer profile readback. Cross-app profile persistence and BikeSIM's physical SIM response still need [HT-3](HARDWARE_TESTS.md); Wahoo's successful test alone does not establish them.

Ordinary road rides remain demo or read-only live power. Virtual downhill motion can continue while the physical flywheel slows; gravity in the game does not promise to motor-drive a trainer. Full route resistance follows physical verification of the manual pilot.

## Verification

Unit regressions compare zero-watt downhill terminal speed against analytical force balance, uphill stopping and subsequent zero distance, downhill/flat/uphill ordering, mass effects, and integration across update rates. Live rides with fresh zero power/cadence and zero trainer-reported speed still move downhill. Storage tests cover defaults, independent settings copies, wheel/session round trips, and invalid imports.

Synthetic GATT tests cover exact SIM startup/slope payloads, ramps in both directions, zero cadence, exclusive ERG/SIM ownership, readiness rejection, cancellation during startup, stale-data Stop acknowledgement, and retained telemetry after Stop. Browser checks exercise profile persistence, visible zero-watt downhill distance, and the SIM panel. These verify software behavior, not physical resistance or outdoor accuracy.
