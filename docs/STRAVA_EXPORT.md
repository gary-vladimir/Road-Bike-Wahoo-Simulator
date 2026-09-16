# Manual Strava activity export

Implemented September 11, 2026. This fulfills the file-export requirement independently of trainer-control validation. There is no OAuth, Strava API client, automatic upload, or server component.

## Rider workflow

Finish and save a BikeSIM ride. On the summary, click **Download FIT for Strava**, then **Open Strava file upload**. Select the downloaded `.fit` file, review its activity details/privacy in Strava, and save it there. Saved rides have the same export through **Ride history → select a ride**. Exporting again retains the original timestamps and content; Strava may reject an activity it already has. Rename the activity on Strava's review screen if desired.

Use a live-power ride for real training data. Demo exports remain available for software checks but have DEMO in their filename and file metadata, and the summary explicitly identifies simulated exercise. Empty/under-one-second rides disable FIT with an explanation. JSON and CSV remain available independently.

## File contents

The exporter uses Garmin's official `@garmin/fitsdk` version 21.214.0. It is loaded only when exporting, keeping the encoder out of the initial ride bundle. Files use the FIT **Activity** type (4), with file ID, sport, timestamped records, timer events, one lap, one session, and one activity message. File identity uses the development manufacturer and BikeSIM product name; it does not impersonate Wahoo or a Garmin device.

| BikeSIM data               | FIT representation                                                      |
| -------------------------- | ----------------------------------------------------------------------- |
| Recording start/end        | UTC `start_time` and `timestamp`; FIT whole-second precision            |
| Active session seconds     | `total_timer_time` in session/lap/activity                              |
| Wall time including pauses | `total_elapsed_time` in session/lap                                     |
| Pause/resume               | Timer Start / Stop All events; no fake zero-power samples during pauses |
| Recorded power             | Record watts, including genuine zero-watt coasting                      |
| Available cadence          | Record rpm; missing cadence stays absent                                |
| Virtual distance           | Cumulative record and summary meters, converted from km                 |
| Virtual speed              | Record m/s, converted from km/h; average/max speed summary              |
| Virtual route grade        | Signed record grade in percent at FIT 0.01% precision; route rides only |
| Road/workout mode          | Cycling + virtual activity / indoor cycling sub-sport                   |

There are no fabricated GPS coordinates, outdoor altitude, heart rate, calories, or workout-target watts presented as measured power. Strava derives its own averages and may classify or display the activity differently. The procedural environment does not supply a real geographic route.

Signed grade was added September 16. It describes the recorded virtual road, not acknowledged trainer slope; decorative workout hills are excluded. Strava may not display this field. The rider's first completed Valley FIT passed Garmin decoding and integrity checks, with genuine zero-watt coasting distance; manual Strava import remains unconfirmed.

## Recording and compatibility

New rides anchor UTC to the monotonic browser clock, start recording after the initial countdown, retain real pause/resume timestamps, and save the final partial sample before Pause/Finish clears speed. Initial countdown/preparation does not count toward active time. Resume countdowns and pauses remain outside timer time. A stalled/hidden/stale-data ride stops its timer at the last valid integrated tick; no activity is fabricated during the gap.

Older sessions lack wall-clock samples and pause durations. Their export reconstructs timestamps from the saved session date plus active elapsed seconds, with this limitation shown on the summary. They remain downloadable without modifying saved data. Recovered interrupted sessions close any open timer at the last saved recording time; their final distance can be exported without inventing missing power/cadence.

The exporter validates units, finite values, supported ranges, chronological readings, and consistent timer data before encoding. Multiple observations in one FIT second retain the last observation; original subsecond samples remain in JSON/CSV. A boundary distance record reconciles the final odometer with session/lap totals. Encoding and downloads never modify the original session.

## Verification and external boundary

Unit tests decode generated files with Garmin's decoder and verify header/CRC integrity, required messages, UTC start, pause duration, units, zero-watt coasting, missing cadence, deterministic repeat exports, old/demo records, interrupted checkpoints, invalid input, and new engine timing/final samples. Browser tests download and decode actual files from saved and newly finished rides, repeat through history/reload, check desktop/mobile layout, and verify no request is sent to Strava during export.

These validate the exported FIT structure and content. No file has been uploaded to the rider's Strava account by the development tools. A manual import of a real ride is the remaining external confirmation.

Final checks: 79 unit tests and 19 browser workflows pass. Default and pilot production builds compile, formatting/whitespace checks pass, and desktop/mobile export layouts were visually reviewed. The existing large Three.js bundle warning remains; the FIT encoder is a separate lazy-loaded bundle.

## References

- [Strava manual upload instructions](https://support.strava.com/en-us/articles/15402066-how-to-get-your-activities-to-strava): FIT, TCX, and GPX files with workout data can be uploaded from a computer.
- [Strava supported FIT fields](https://developers.strava.com/docs/uploads/): timestamped activity records, sensor fields, session totals, and indoor/virtual sport metadata; GPS is optional.
- [Official Garmin JavaScript FIT SDK](https://github.com/garmin/fit-javascript-sdk): encoder, decoder, and integrity checks. The dependency retains its FIT Protocol License in `node_modules/@garmin/fitsdk/LICENSE.txt` inside the devcontainer.
