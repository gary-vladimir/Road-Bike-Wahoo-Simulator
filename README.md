# BikeSIM

A local, single-rider cycling simulator for the existing road bike and KICKR CORE 2. SIM road riding is the default experience, with four procedural Oaxaca-inspired routes, free pacing, elevation profiles, and coasting physics. ERG power workouts have their own library with eight presets and an editor. Demo and read-only Bluetooth rides save locally. Automatic terrain resistance is not enabled yet; a separate manual SIM test is ready for hardware validation.

## Run locally — Docker only

Docker Desktop must be running. From this repository, use the infrastructure commands below; all Node/npm commands execute inside the devcontainer.

```sh
docker compose -f .devcontainer/compose.yaml up -d --build
docker compose -f .devcontainer/compose.yaml exec bikesim npm ci
docker compose -f .devcontainer/compose.yaml exec bikesim npm run dev
```

Open [BikeSIM on this Mac](http://localhost:5186) in Chrome. Port 5186 is bound to `127.0.0.1`; container port 5173 is not exposed to the LAN. Keep the same browser profile and URL to access the same saved rides.

Alternatively, open the repository in a Dev Containers-compatible editor and choose **Reopen in Container**. Dependencies install through `postCreateCommand`; run `npm run dev` in the container terminal. No host-side Node, Bluetooth bridge, or package installation is required. The browser itself executes the frontend JavaScript, WebGL, and Web Bluetooth calls.

## Try it

Start on **Ride**, choose a road, and select **Start road demo**. Adjust demo effort or press **Coast** during the ride. Hills occur at fixed distances; rider effort and road forces determine virtual speed. No FTP or cadence target is required. Completion is based on route distance, with a six-hour session limit. Settings defaults to the rider-confirmed **70 kg** and **700×32C tubeless tires**; bike mass remains an editable **9 kg estimate**. Tire dimensions and circumference are editable; 2155 mm is a geometric estimate, not a measured rollout.

Try **Descent to the valley → Coast**: fresh zero watts and zero cadence continue accumulating distance downhill. Gravity can accelerate a descent from rest, while drag limits speed. On the flat, momentum decays gradually; uphill it decays faster and stops without rolling backward. Pausing or losing live telemetry explicitly freezes the ride, unlike coasting. See [physics assumptions and verification](docs/ROAD_PHYSICS.md).

For a structured power workout:

1. Open **Workouts** and select a preset. **First five minutes** is the shortest supplied preset.
2. Choose **Demo · simulated rider** and start. Demo uses an explicitly labeled 200 W FTP example unless you enter your own FTP in Settings.
3. Follow the countdown, power target, cadence cue, and interval profile. Adjust intensity, pause/resume, or stop with the buttons. `Space` or `Escape` pauses; resuming requires an explicit click.
4. Finish the ride to see the summary. **Download FIT for Strava** exports the activity for manual upload; JSON and CSV are also available. History, custom workouts, profile settings, and periodic ride checkpoints persist in IndexedDB.
5. Use **Customize workout** to save an editable copy. Add/delete intervals and change their duration, starting/ending FTP percentage, and cadence target.

## Export a ride to Strava

1. Finish and save your ride, or open a saved ride from **Ride history**.
2. Click **Download FIT for Strava** on its summary.
3. Click **Open Strava file upload**, select the `.fit` file, review the activity, and save it in Strava.

The file includes recording timestamps, active duration, pause events, power (including zero-watt coasting), available cadence, and virtual speed/distance. It is an indoor/virtual cycling **activity**, not a workout prescription or GPS course. New rides preserve actual pause durations; older rides use their saved start and active-time timeline because pause durations were not recorded. Recovered rides export up to their last saved checkpoint. Empty rides cannot export FIT. Demo files and their summary are clearly marked as simulated data.

Generation happens locally and needs no Strava account connection or API credentials. BikeSIM does not upload anything automatically. Strava supports manual FIT import; final classification and derived statistics are determined by Strava. No GPS route, heart rate, or calorie estimate is invented. See [export details and verification](docs/STRAVA_EXPORT.md).

## Connect the KICKR

In Chrome on this Mac, open **Trainer → Pair KICKR via Bluetooth**, select the trainer, and pedal gently. macOS/Chrome may request Bluetooth permission. The diagnostic screen reports fresh watts, available cadence/speed, features, supported power range, and connection events.

The default configuration **disables trainer control**. Pairing subscribes to telemetry and reads FTMS characteristics; it never sets workout load. There are no calibration, reset, or firmware update commands.

After pairing, choose **KICKR · live power, read-only** on Ride to explore the road using actual power without an FTP requirement. You choose your cadence and physical gears; BikeSIM does not infer gear position or multiply measured power by a gear ratio. **Resistance remains whatever the trainer was already doing**, so read-only pairing is not an unload operation. See [baseline and physical setup](docs/TRAINER_SETUP.md).

Live power workouts still require your known FTP. Their targets are guidance. Virtual speed is estimated from power, rider/bike mass, and grade; trainer-reported speed is shown only in diagnostics. Fresh power is required; losing it pauses either kind of ride.

The SIM controller is connected to Bluetooth only through the separate, manually armed ±1% diagnostic pilot. Automatic ERG/SIM ride control and Wi-Fi transport remain unavailable. See [hardware validation](docs/HARDWARE_TESTS.md) and [implementation status](docs/IMPLEMENTATION_STATUS.md).

## Supervised SIM and ERG pilots

A separate diagnostic panel supports HT-2 and HT-3 hardware validation. Stop the existing BikeSIM development server before starting this opt-in server:

```sh
docker compose -f .devcontainer/compose.yaml exec -e VITE_TRAINER_CONTROL=pilot bikesim npm run dev
```

Reload Chrome and open **Trainer**. Pairing remains read-only. For the next physical check, select **SIM · terrain test**. End Wahoo's control session and confirm its rider/tire profile matches BikeSIM; the FTMS SIM payload does not transmit those profile values. Confirm a comfortable baseline and readiness, then **Start flat SIM test**. Select slopes from −1% through +1%; changes are limited to 0.25 percentage points per second. Fresh zero watts and zero cadence remain valid. Use physical gears naturally. No ERG power command is sent in SIM.

The separate **ERG · power test** retains the 50–100 W diagnostic. Select readiness and **Start 50 W test**; it waits without resistance commands until fresh power/cadence and at least 50 rpm arrive. Target changes are limited to 10 W per second. ERG's low-cadence cutoff does not apply to SIM.

Both tests have explicit Stop, visibility/freshness/timing checks, exclusive browser ownership, and serialized acknowledged writes. Telemetry stays connected after an acknowledged stop; an uncertain control failure closes the link. Stop does not prove physical unloading, and the previous heavier load may return. A disconnected or crashed browser cannot guarantee reduced resistance. Select readiness again to start a new test on the same connection.

A full page refresh ends the browser's GATT session. BikeSIM attempts to restore **telemetry only** using the previously selected device and Chrome's `getDevices()` permission API. No control session or readiness is restored. If that API or saved permission is unavailable, use **Pair KICKR via Bluetooth**. The current Mac Chrome configuration did not restore its saved permission in the September 7 check, so seamless reconnection is not verified on this machine. **Reconnect KICKR** reuses the selected device within the current page without reopening the chooser. An intentional Disconnect disables refresh restoration for that tab. See [Chrome's saved-device sample](https://googlechrome.github.io/samples/web-bluetooth/get-devices.html) and [implementation status](https://github.com/WebBluetoothCG/web-bluetooth/blob/main/implementation-status.md).

Hot replacement is disabled in pilot mode so edits cannot replace an active controller. Reload only after stopping the test. The Compose default remains `off`; automatic workout resistance is still unavailable. Export the separate control test log from the test panel.

The **Check ERG target response** panel shows selected, acknowledged, and measured watts separately, alongside cadence and time at target. Hold a target for twenty seconds after acknowledgement if comfortable; the table excludes the first ten seconds and repeated/stale packets from its averages. The current rider observation is that test termination brings back a heavier load: **Stop ends the test but is not an unload command**. See the September 9 HT-2 record before another test.

Evidence includes up to 1,200 half-second observations, raw machine-status bytes, and the command audit. It saves locally every five seconds, at test end, and for twenty seconds afterward. **Export last saved test** retrieves the latest checkpoint after reload without restoring control. An abrupt closure can lose the latest samples. This diagnostic record has a separate export and is not part of the ride backup. Trainer-reported power may be smoothed and does not independently verify physical load.

## Checks

```sh
docker compose -f .devcontainer/compose.yaml exec bikesim npm test
docker compose -f .devcontainer/compose.yaml exec bikesim npm run build
docker compose -f .devcontainer/compose.yaml exec bikesim npx playwright install --with-deps chromium
docker compose -f .devcontainer/compose.yaml exec bikesim npm run test:browser
```

Keep `npm run dev` running for the browser tests. Tests execute inside Docker and use synthetic telemetry and software-rendered Chromium; they do not validate the Mac GPU, physical resistance, or actual Bluetooth behavior. The unit suite includes a six-hour simulated timing/physics soak. FTMS fixtures are synthetic specification fixtures, not device captures.

To stop the development container without deleting dependencies or browser downloads:

```sh
docker compose -f .devcontainer/compose.yaml stop
```

## Data and limits

No accounts, analytics, remote fonts, CDN assets, or automatic uploads. The app runs without internet after setup; development dependencies require internet to install. Local storage is browser-profile storage, not app-level encryption. Download a backup in Settings before clearing browser data or changing browser/profile/origin. Imports merge IDs; matching records are replaced transactionally. A refreshed/closed ride is listed as interrupted and never restarts automatically.

The scene is a procedural environment, not a surveyed Oaxaca route. Route grade affects virtual speed and the scene; route-driven physical resistance awaits the separate SIM test. Route sessions retain their profile, SIM mode, mass, wheel setup, and physics version in history/backups; their recorded target watts are zero to represent no power prescription. Real GPX routes, detailed Blender assets, and automatic training prescriptions remain future work. Strava transfer uses the manual FIT file workflow above.
