# Road physics and rider setup

Physics version 3, September 29, 2026 (`src/ride/physics.ts`). Saved rides record their physics version, masses, wheel, riding position and air density, so older rides keep their original numbers.

## Motion

Virtual speed comes from measured power and road forces. It is never copied from the trainer's flywheel speed or inferred from cadence and gearing. For speed `v`, rider plus bike mass `m`, road angle `θ = atan(grade / 100)` and head wind `w`:

```
drive    = 0.97 × max(power, 0) / max(v, 0.75 m/s)
gravity  = −m g sin θ                       (pulls you downhill)
rolling  = m g Crr cos θ
air      = ½ ρ CdA (v + w) |v + w|
braking  = up to 3.5 m/s² when a corner ahead needs a lower speed
a        = (drive + gravity − rolling − air − braking) / (m + 1.7 kg)
```

| Input               | Value                                                  | Source                                                  |
| ------------------- | ------------------------------------------------------ | ------------------------------------------------------- |
| Rider mass          | 70 kg                                                  | Rider-confirmed; Settings                               |
| Bike mass           | 9 kg                                                   | Estimate; Settings                                      |
| Riding position CdA | Upright 0.40, **hoods 0.32**, drops 0.29, aero 0.25 m² | Typical road values; Settings                           |
| Air density ρ       | 1.00 kg/m³ at 1,550 m (sea level 1.20)                 | Standard atmosphere at the road's start altitude, 20 °C |
| Rolling Crr         | 0.004                                                  | Good tires on smooth asphalt; assumption                |
| Wheel inertia       | +1.7 kg effective mass while accelerating              | ≈ I/r² for a pair of 700C wheels                        |
| Drivetrain          | 97% efficient                                          | Assumption                                              |
| Wind                | Still air                                              |                                                         |

The 0.75 m/s floor bounds launch force, because crank torque and the selected gear are unknown at walking pace. The engine samples the course at most every 50 ms and integrates in steps of at most 10 ms, independent of frame rate. Speed is forward-only (no rolling backward) with a numerical ceiling of 150 km/h. On descents, the rider brakes for corners whose curvature over the next 60 m needs more than about 0.35 g; gentle bends never limit speed.

Oaxaca's altitude matters: at 1,550 m the air is about 17% thinner than at sea level, so the same power goes about 6% faster on the flat.

## Reference speeds

Default setup (70 + 9 kg, hoods, 1,550 m, still air), steady state:

| Power | Flat      | 6% climb  | −3% descent |
| ----- | --------- | --------- | ----------- |
| 100 W | 27.7 km/h |           |             |
| 150 W | 32.5 km/h |           |             |
| 200 W | 36.2 km/h | 13.5 km/h | 52.2 km/h   |
| 250 W | 39.3 km/h | 16.5 km/h |             |

At 200 W on the flat: upright 33.8, hoods 36.2, drops 37.4, aero 39.1 km/h; hoods at sea level 34.2 km/h.

**Coasting** at 0 W settles toward the speed where gravity balances drag: about 8 km/h on −0.5%, 19 km/h on −1%, 40 km/h on −3% and 59 km/h on −6%. Shallower than about −0.4% you cannot coast forward against rolling resistance. Entering a descent faster than its balance speed slows you toward it, which is why a gentle descent can still feel like slowing down. The HUD shows whether you are gaining speed, holding steady or slowing, from the same force balance.

- Fresh 0 W and 0 rpm is valid live data: you coast. Stale power for 3 s pauses the ride instead.
- Pause freezes progress and speed; resuming starts from a stop after a countdown.

## Trainer load matches the physics

In SIM, BikeSIM sends the KICKR the same Crr (0.004) and a wind coefficient Cw = ½ρ·CdA (0.16 kg/m on the hoods at 1,550 m), with no wind. The grade is the course grade at your distance, scaled by trainer difficulty and kept within −10% to +12%. The KICKR combines these with the rider weight and wheel size from its own profile in the Wahoo app, because FTMS simulation carries neither. Keep that profile matching Settings. See [trainer control](TRAINER_CONTROL.md).

Your gears stay real: shifting changes cadence and pedal force on the KICKR, and the physics sees only the resulting power. BikeSIM does not guess a gear or multiply power by a ratio.

## Wheel size

Settings holds rim diameter, tire width and an optional measured circumference. 700×32C is 32-622; the default 2,155 mm is `π × (622 + 2 × 32)` rounded, a geometric estimate rather than a measured rollout. Circumference converts virtual speed to wheel rpm for the record; it does not change speed or power.

## Verification

Unit tests compare zero-watt terminal speeds with the analytical balance, check uphill stops without backward distance, altitude and position effects, wheel inertia, corner braking and integration across tick rates. Engine tests cover stale data, pauses and a six-hour simulated soak. These verify the model, not outdoor accuracy: CdA, Crr and bike mass are disclosed assumptions.
