# Strava export (FIT)

BikeSIM writes a standard FIT activity file locally; you upload it to Strava yourself. There is no Strava account connection, API client or automatic upload. Current as of September 29, 2026.

## Workflow

1. Finish a ride (or open one from **History**).
2. Click **Download FIT for Strava**, then **Open Strava file upload** and choose the file.
3. Review the activity on Strava and save it. **Title and description for Strava** has matching text with copy buttons, because Strava does not read a FIT file's name or description into the activity.

Exporting again produces the same file with the original timestamps; Strava may reject it as a duplicate. Demo rides are labeled DEMO in the file name, metadata and summary. Rides shorter than a second cannot export FIT; JSON and CSV remain available.

## What the file contains

The file is a FIT **Activity** encoded with Garmin's official [`@garmin/fitsdk`](https://github.com/garmin/fit-javascript-sdk), loaded only when you export. It identifies itself as BikeSIM, not as a Wahoo or Garmin device.

| Ride             | FIT sport / sub-sport          | Positions and altitude | Grade per record |
| ---------------- | ------------------------------ | ---------------------- | ---------------- |
| Real Oaxaca road | cycling / **virtual activity** | Yes, along the road    | Yes              |
| Practice road    | cycling / indoor cycling       | No                     | Yes              |
| Workout          | cycling / indoor cycling       | No                     | No               |

For real roads, latitude, longitude and altitude come from the road's own geometry at the distance you had ridden, never from a GPS recording. Strava draws the map and counts the climb; virtual activities stay off real-world segment leaderboards.

| BikeSIM data           | In the file                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Start and end          | UTC timestamps (whole seconds)                                                                                               |
| Pauses                 | Timer stop/start events; no fake zero-power samples while paused                                                             |
| Power                  | Measured watts per record, including real 0 W coasting                                                                       |
| Cadence                | When the trainer reported it; missing cadence stays missing                                                                  |
| Speed and distance     | Virtual speed and distance from the physics                                                                                  |
| Lap and session totals | Timer and elapsed time, distance, average/max speed, average/max/normalized power, work, average cadence (coasting excluded) |
| With an FTP            | Intensity factor, TSS and threshold power                                                                                    |
| Real roads             | Total ascent ridden                                                                                                          |
| Name and description   | Session profile name and workout name/description (Strava may ignore them)                                                   |

No heart rate, calories or target watts presented as measured power are invented.

## Recording rules

Recording starts when the countdown ends. Paused time and resume countdowns count toward elapsed time but not timer time. A ride that stalls (hidden tab, stale power) stops its timer at the last valid tick. Recovered, interrupted rides export up to their last saved checkpoint. Older rides that did not record pause durations are rebuilt from their start time and active time, and the summary says so.

The exporter validates units, ranges, chronological order and timer consistency before encoding, and never modifies the saved ride.

## History and checks

The rider confirmed manual Strava import of a real ride on September 17. Real-road virtual activities with positions, and the session power totals, were added on September 29 and still need a fresh upload to confirm how Strava shows them (map, climb, classification).

Unit tests decode every generated file with Garmin's decoder and check integrity, message structure, timing, pauses, zero-watt coasting, missing cadence, real-road positions against the route, virtual versus indoor classification and totals. Browser tests download files from new and saved rides and verify that nothing is sent to Strava.

References: [Strava upload formats and FIT fields](https://developers.strava.com/docs/uploads/), [Strava manual upload](https://support.strava.com/en-us/articles/15402066-how-to-get-your-activities-to-strava).
