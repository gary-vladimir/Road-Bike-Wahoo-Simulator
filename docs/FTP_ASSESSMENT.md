# FTP ramp test

**Workouts → Take an FTP test** (also in Settings) estimates FTP without needing a previous value. It needs a paired KICKR and trainer control switched on in Settings, because the trainer holds each step in ERG. Current as of September 29, 2026; see [trainer control](TRAINER_CONTROL.md) for the session underneath.

## Protocol

Choose a starting load of 50, 75 or 100 W (50 W can feel almost unloaded on the KICKR) and a protocol:

| Protocol | Warm-up                    | Ramp                                                                  | Ceiling |
| -------- | -------------------------- | --------------------------------------------------------------------- | ------- |
| Gentle   | 5 min at the starting load | From 50 W (or the starting load rounded up to 10 W), +10 W per minute | 300 W   |
| Standard | 5 min at the starting load | From 100 W, +20 W per minute                                          | 600 W   |

The load never drops at the warm-up/ramp boundary. Pedal above 50 rpm to start; the warm-up clock begins once the trainer holds the starting load.

- **Warm-up.** The clock runs only while you pedal. Three seconds below 50 rpm eases the trainer to the starting load and pauses the warm-up; spin up to continue. Hiding the tab also holds the starting load.
- **Ramp.** Ride each step until you cannot hold it. Press **I've reached my limit**, or simply stop: three seconds below 50 rpm ends the test the same way. The trainer then goes to a flat road. Brief 0 rpm readings while you pedal are ignored. Hiding the tab mid-ramp ends the test with the data so far.
- Reaching the protocol ceiling without finishing sets no FTP; use the standard ramp next time.

## Result

FTP = 75% of your best measured 60-second power during the ramp. Readings are weighted by their actual durations, include partial steps and exclude the warm-up. Requested watts, body weight and demo data are never used. A result is accepted when:

- at least three ramp minutes and a continuous valid minute were recorded,
- the best minute's measured power is within 15% (or 10 W) of the trainer's acknowledged targets, which catches an unresponsive ERG,
- the trainer confirmed the flat road (or Stop) at the end, and
- the estimate is between 50 and 600 W.

A valid result and its report save together and update FTP in Settings. Cancelled, faulted or incomplete attempts leave FTP unchanged. The 75% rule is a common ramp-test estimate ([ROUVY](https://support.rouvy.com/hc/en-us/articles/360020119778-FTP), [Wahoo on its limits](https://support.wahoofitness.com/hc/en-us/articles/4404067414418-The-Half-Monty-fitness-assessment-Everything-you-need-to-know)); riders with a strong sprint may see it overestimate.

## Records

Each attempt checkpoints every five seconds. A reload marks an unfinished attempt as interrupted, never resumes control and never changes FTP. The last 50 attempts are kept, included in backups and downloadable as JSON with protocol, readings, targets, acknowledged watts, warm-up pauses, the final telemetry, the controller's last message and a command audit. Backup import re-checks any claimed estimate.

## History

Earlier versions stopped control on any cadence below 50 rpm, which ended warm-ups and invalidated ramps on single 0 rpm glitches, and FTMS Stop returned the KICKR to a heavier load. The September 18 reviews of those attempts are in [history](history/FTP_LOW_LOAD_REVIEW.md). A maximal test on the physical KICKR with the current behavior has not been done yet.
