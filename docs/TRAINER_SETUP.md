# Physical setup, startup load, and riding modes

**September 10 update:** see the [flywheel review](FLYWHEEL_REVIEW.md) for the current next step. The repeated low-power ERG test is not the reference for realistic road feel; establish a comfortable Wahoo SIM comparison first. Earlier baseline instructions below remain context for ERG testing.

September 8, 2026. Supersedes the assumption that reaching 50 rpm is necessarily an easy initial hardware check. No hardware commands were sent for this review.

## Confirmed observations and unknowns

The rider reports a Giant Contend AR 1 with two front chainrings, an 11-speed cassette supplied with the KICKR CORE 2, and approximately 150 W at 50 rpm while using the large front chainring. This is measured effort, not evidence of a particular brake percentage or a known trainer mode. The selected rear cog, exact bicycle model year, existing target/mode, and any other active controller are unknown.

Giant's [2022 specification](https://www.giant-bicycles.com/us/contend-ar-1-2022) lists 50/34 front chainrings and an 11–34 rear cassette. That is a reference configuration, not a confirmed inventory of this rider's bike. Wahoo's [CORE drivetrain documentation](https://support.wahoofitness.com/hc/en-us/articles/13681629286674-Drivetrain-Compatibility-CORE) lists 11–28 for supplied 8–11-speed cassettes. The trainer's installed cassette replaces the rear-wheel cassette during indoor riding. If these are the rider's actual ratios, the smallest indoor ratio is 34/28 rather than 34/34: the easiest indoor gear is about 21% higher. Do not encode the outdoor cassette as the trainer cassette without confirmation.

## Current implementation limitations

- Read-only pairing deliberately leaves the trainer's existing load untouched. It does not establish an easy baseline.
- The pilot waits for fresh power and at least 50 rpm before its first control request. That cadence can require substantial effort under an existing load; it is not a low-load guarantee.
- The 100 W ceiling bounds commanded pilot targets, not pre-existing resistance or measured rider power. The 10 W/second ramp applies after the initial 50 W target, not to the transition from an unknown prior state.
- Power and cadence alone do not reveal the active brake percentage, selected gear, or previous target. Requesting control alone is not an unload operation.
- Initial ERG mode acquisition and physical stop behavior remain unverified. A success indication is not proof of the expected physical response.

## Baseline check before another BikeSIM load test

Use the Wahoo app alone to establish a comfortable baseline first. For this diagnostic step, use the small front chainring and a middle rear cog; shift lightly. Wahoo recommends that combination for ERG operation in its [ERG guide](https://support.wahoofitness.com/hc/en-us/articles/4402565516946-A-Guide-to-using-ERG-mode). The purpose is repeatability, not restricting eventual free riding to one gear.

With BikeSIM's control test stopped, explicitly select **Resistance** mode in Wahoo and lower its setting to 0% for this baseline check. Wahoo documents this as the minimum of its manually selected brake-percentage range, distinct from ERG and Simulation modes. It is not a calibration, a factory reset, a zero-watt promise, or a simulation of flat road. Confirm easy pedaling by feel; if it remains unexpectedly heavy, do not force the cadence threshold. Record the observed watts/cadence and mode. See [Wahoo control modes](https://support.wahoofitness.com/hc/en-us/articles/28408412793490-Trainer-control-modes-for-KICKR-CORE-SNAP-or-BIKE-in-the-Wahoo-app).

End/disconnect Wahoo's trainer-control session before BikeSIM takes control. Recheck comfortable pedaling through read-only telemetry after the handoff; do not assume the baseline survived it. Only then perform the supervised ERG command test. A 50 W ERG request is an absolute power target, not an extra 50 W added to a previous percentage. Verify that transition physically before treating it as reliable.

## Product direction: real gears in simulation mode

The normal realistic-road experience should use **SIM/terrain control**. The app supplies road conditions and the physical drivetrain remains available for shifting. Wahoo documents route grade control through [Simulation mode](https://support.wahoofitness.com/hc/en-us/articles/25228373373458-Simulate-a-route-indoors-in-the-Wahoo-app). Target-power ERG remains a separate, explicitly selected workout option. It is unsuitable as the sole road mode because its controller compensates for gearing/cadence changes to maintain watts.

Implementation requirements for the next control phase:

1. Establish an explicit, acknowledged starting mode and bounded initial load; expose unknown prior state instead of assuming zero. Validate startup, handoff, stop, and failure behavior on the actual trainer.
2. Use gradual terrain transitions and validated limits. Flat-road SIM still includes rolling/aerodynamic resistance; never use it as a guaranteed unload command.
3. Use verified rider/bike mass and consistent road physics. Clearly disclose grade scaling and trainer limits; do not silently flatten hills to hold a power target.
4. Let physical shifts change cadence and pedal force naturally. Do not multiply measured power by a guessed gear ratio or invent a gear-position sensor. A manual drivetrain profile may describe the equipment, but it does not identify the currently selected cog.
5. Keep workout guidance separate from the control mode: in SIM, the rider shifts/paces to follow a suggested target; in ERG, the trainer pursues the watt target. The current procedural scene is not yet geographically accurate road simulation.

The September 8 implementation adds free road previews and a mock-tested SIM command/controller module. Real Bluetooth remains disconnected from that module: baseline and trainer-profile confirmations are not inferred from the app's weight defaults. The existing ERG pilot remains a diagnostic step, not the final realistic riding experience.
