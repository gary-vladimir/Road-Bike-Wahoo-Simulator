# Flywheel momentum and the next physical check

> **Historical evidence review.** Findings about a ride or test file at the time; the app has changed since. Current behavior: [trainer control](../TRAINER_CONTROL.md).

**Subsequent September 10 update:** the Wahoo SIM comparison below is complete by rider report: realistic added slope resistance and natural shifting, with 700×32C confirmed. Rider weight is 70 kg. The bounded BikeSIM SIM pilot and improved coasting physics are now implemented; [HT-3](../HARDWARE_TESTS.md) is the next manual check. The original analysis below is retained as the reasoning/evidence record, not a request to repeat the Wahoo comparison.

September 10, 2026. This review changes the next diagnostic step: stop repeating the low-power ERG test to establish road feel. No trainer-control commands were sent during this review.

## What the new evidence shows

The [latest captured test](../../tests/fixtures/kickr-erg-2026-09-10.json) contains only a 50 W target. During the initial running period, the trainer repeatedly reported 49–53 W while calculated cadence rose from approximately 56 to 79 rpm. Later samples include dips in reported power. The panel's settled average is 42.0 W at 73.8 rpm over 21 distinct samples, so this is not a uniformly accurate 50 W interval or evidence for 75/100 W tracking.

At approximately 31.9 seconds after Request Control, cadence changes from 78 rpm to zero while power reports 50 W. BikeSIM sends Stop around 32.0 seconds; the next sampled cadence is 71 rpm. That single zero triggers the current ERG guard. It could reflect actual disengagement/coasting, calculated-cadence dropout, or reporting lag; the log cannot distinguish them. Wahoo documents that the trainer [calculates cadence](https://support.wahoofitness.com/hc/en-us/articles/115001671364-Does-the-KICKR-Smart-Trainer-Measure-Cadence-or-Heart-Rate). A reported zero is not independent proof that the rider stopped moving their feet.

This supports responding ERG control at 50 W, with an unsuitable diagnostic experience and an overly blunt cadence condition for evaluating free riding. It does not justify disabling the ERG guard or increasing load without further validation. No mechanical fault, motor-driven acceleration, or confirmed gear selection can be inferred from this capture.

## Two kinds of momentum

The real flywheel stores rotational energy. The drivetrain can freewheel when the rider is no longer driving it fast enough for the selected gear, as with coasting outdoors. Flywheel RPM and crank RPM are different because of the drivetrain and trainer transmission. Rapidly spinning to chase engagement can further raise flywheel speed. In low-power ERG, braking adjusts to keep power low, so the pedal force can feel very light. Wahoo describes that sensation and the response delay in its [ERG guide](https://support.wahoofitness.com/hc/en-us/articles/4402565516946-A-Guide-to-using-ERG-mode). This is a plausible explanation for the rider's report, not a confirmed reconstruction of every pedal stroke.

BikeSIM currently models **virtual rider/bike inertia**: speed persists during coasting, with changes from power, mass, gradient, rolling resistance, and drag. This is a simplified translational model with an approximate low-speed force calculation. It does not model the CORE 2's exact rotational inertia, belt ratio, freehub engagement, crank torque, or selected gear. Its real ERG diagnostic delegates target-power regulation to the trainer firmware. The FTMS data used here does not provide raw flywheel angular velocity or gear position; reported speed can also be simulated in ERG. It must not be treated as a calibrated flywheel sensor.

The SIM implementation should send consistent road conditions and let trainer firmware handle its physical brake/flywheel system. Physical inertia is already present; blindly adding a guessed flywheel-energy term to measured power or adding arbitrary braking would risk double-counting and distort the requested road. Validate acceleration, coasting, and re-engagement against the actual bike. Matching outdoor ride feel will still be limited by trainer hardware and gearing.

## Clarification: absolute watts still mean resistance changes

An ERG request of 50 W asks the trainer to regulate total power toward 50 W; it does not add 50 W to the previous load. If the prior load required more power, the brake may ease. Moving from 50 to 100 W at the same steady cadence should require greater average pedal torque once settled. Feeling no additional load is not itself evidence of correct operation. Wahoo distinguishes [Target Power, Resistance, and Simulation modes](https://support.wahoofitness.com/hc/en-us/articles/28408412793490-Trainer-control-modes-for-KICKR-CORE-SNAP-or-BIKE-in-the-Wahoo-app).

## Next rider check: establish SIM feel in Wahoo

1. End the BikeSIM test, disconnect its trainer connection, and let the flywheel coast down before starting the comparison. Use Wahoo alone as the controller.
2. In Wahoo, verify your weight and the wheel/tire-size setting. Note the gear you use and whether ERG power smoothing/speed simulation are enabled; those settings affect interpretation of prior ERG readings. Do not change them just to obtain a different result.
3. Select **Simulation**, starting at **0% slope**. This is flat-road simulation, distinct from Resistance mode at 0%. Ride at a comfortable pace and shift your physical gears naturally. Do not force 50 W or a minimum cadence to satisfy BikeSIM.
4. If comfortable, try **0.5% and then 1% slope**. Briefly coast and resume pedaling. Observe whether a suitable gear gives predictable pedal engagement and whether the slight incline adds load. End the check if it feels wrong; do not chase the flywheel with faster pedaling.
5. Report whether flat/mild-uphill SIM feels natural, whether coasting/re-engagement works, and the approximate gear, watts, and cadence. If the same persistent spin-out occurs in Wahoo SIM, investigate trainer/drivetrain/configuration before implementing a software compensation.

Wahoo's documented SIM mode uses slope and profile settings. ROUVY likewise defines [100% reality level](https://support.rouvy.com/hc/en-us/articles/40097785585425-Unified-Riding-Mode-One-Way-to-Ride) around route-gradient simulation. This is the relevant reference for BikeSIM's normal riding mode.

## Next development step

Use the Wahoo SIM observations as the physical reference, then implement a separately armed, bounded BikeSIM SIM pilot with verified profile configuration, graded transitions, and explicit stop/load-state reporting. Keep fresh zero-power coasting valid; do not inherit the ERG 50 rpm cutoff. The mock SIM supervisor already permits this, but real SIM control is still disconnected. Deliberate pause/stop, lost telemetry, control loss, and stale cadence must remain distinct from ordinary coasting. A separate cadence sensor is an optional later diagnostic if trainer-calculated cadence remains unreliable, not a purchase required for this check.

Completing repeated low-power ERG intervals is no longer the prerequisite for deciding whether the intended SIM road feel is achievable. Actual command acceptance has evidence; bounded SIM handoff and its physical behavior still require validation.
