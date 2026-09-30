# Monte Albán ride review — September 30, 2026

The rider's first ride on a real road with **Trainer sets the slope** (automatic SIM), after the September 29 overhaul. The rider reports that everything worked and that the Strava upload succeeded. This review decodes the downloaded FIT (`bikesim-2026-09-30-Monte-Alba-n-6a0c1358-….fit`, 43,447 bytes) with Garmin's SDK and checks it against the route and the physics. The session JSON, CSV and ride log were not exported; they live only in the rider's browser profile.

## The ride

| Measure         | Value                                                  |
| --------------- | ------------------------------------------------------ |
| Start           | 12:12:15 in Oaxaca (18:12:15 UTC)                      |
| Distance        | 7.46 of 10.58 km: a partial ride, ended on the 7% ramp |
| Timer / elapsed | 25:24 / 26:05, with one 41 s pause at 19:49 (6.79 km)  |
| Power           | 105 W average, 124 W normalized, 234 W max, 160 kJ     |
| Cadence         | 53 rpm average (0 rpm readings excluded)               |
| Speed           | 17.6 km/h average, 34.1 km/h max                       |
| Climb           | +145 m, from 1,551 m at the Zócalo to 1,656 m          |

## What checks out

- **Structure.** Valid FIT with correct CRC and no decode errors: file ID, sport, workout, 4 timer events, 1,525 records, lap, session and activity. Classified cycling / virtual activity; lap and session totals are identical.
- **Timing.** Timer events add up to the session's 1,524 s of timer time and 1,565 s elapsed. Records come every second, none fall inside the pause, and time never runs backward.
- **Totals.** Recomputed from the records: 105.1 W average, 124.2 W normalized, 160.3 kJ, 234 W max and 52.7 rpm, all matching the session. The final record's distance equals the session distance (7,464.68 m), and each second's distance step matches its speed within 0.9 m.
- **The road.** Every record's grade matches the route profile at its distance (within 0.005 points), its altitude matches the course (within 0.1 m) and its position lies within 0.8 m of the course. The path through the recorded positions measures 7,464.2 m against 7,464.7 m recorded, so Strava's GPS distance agrees with BikeSIM's. Climb from record altitudes is 144 m against 145 m in the session.
- **Physics.** Re-simulating the ride from its recorded power with the app's physics and the rider's setup (70 kg rider, 9 kg bike, hoods, 1,551 m) reproduces the distance within 2.4 m, and within 5.5 m at every point along the way. Other setups diverge (drops +17 m, upright −193 m). The recorded motion is exactly the configured model.
- **Corners.** The only corner braking was 7 s at a 13–19 m radius bend near 5.6 km (limit 25 km/h). The city section never forced braking.

## Observations

- **Cadence on the climb.** 39–46 rpm at 130–145 W on 7–8%. In SIM the KICKR sets the flywheel speed from its own model and profile, so cadence depends on that and the selected gear, which the app cannot see. If climbs feel like grinding, shift easier or lower **Trainer difficulty**; the screen keeps the real grade.
- **Cadence glitches.** 10 records show 0 rpm under more than 30 W, the KICKR's known intermittent reading. SIM ignores cadence, so control was unaffected; the session average excludes zeros.
- **Standstill time.** After resuming, the timer ran 8 s at 0 W before pedaling; at the end, 20 s at a standstill before Finish. Both count as timer time; Strava's moving time leaves them out.
- **Restart on the ramp.** From a standstill on 7.4%, the virtual bike took about 12 s to reach 8 km/h while the trainer's slope returned from flat at 0.5 points per second, as designed.

## Fixed after this review

- The file name read `Monte-Alba-n`: the accent split off by Unicode normalization became a separator. Now `Monte-Alban`.
- The FIT description (254 bytes) was cut mid-word ("…Recorded trainer power; vir"). It now ends at a word with an ellipsis.
- Durations rounded up: the ride read 25:25 in BikeSIM but 25:24 on Strava. Elapsed times now round down like a stopwatch; countdowns still round up.

## Still to check

The session JSON holds the ride log: the SIM control events with each acknowledged slope, the pause hold and the release at the finish. Exporting it from **History → Monte Albán → JSON** (and CSV) would confirm on real hardware that the pause held a flat road and the finish released without FTMS Stop.
