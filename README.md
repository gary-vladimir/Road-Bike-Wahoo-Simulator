# BikeSIM

A local, single-rider cycling simulator for the existing road bike and KICKR CORE 2. The first implementation includes a procedural Oaxaca-inspired road, eight workout presets, a workout editor, demo rides, read-only Bluetooth telemetry, and local ride history.

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

1. Select a workout. **First five minutes** is the shortest supplied preset.
2. Choose **Demo · simulated rider** and start. Demo uses an explicitly labeled 200 W FTP example unless you enter your own FTP in Settings.
3. Follow the countdown, power target, cadence cue, and interval profile. Adjust intensity, pause/resume, or stop with the buttons. `Space` or `Escape` pauses; resuming requires an explicit click.
4. Finish the ride to see the summary. JSON and CSV downloads are available. History, custom workouts, profile settings, and periodic ride checkpoints persist in IndexedDB.
5. Use **Customize workout** to save an editable copy. Add/delete intervals and change their duration, starting/ending FTP percentage, and cadence target.

## Connect the KICKR

In Chrome on this Mac, open **Trainer → Pair KICKR via Bluetooth**, select the trainer, and pedal gently. macOS/Chrome may request Bluetooth permission. The diagnostic screen reports fresh watts, available cadence/speed, features, supported power range, and connection events.

The default configuration **disables trainer control**. Pairing subscribes to telemetry and reads FTMS characteristics; it never sets workout load. There are no calibration, reset, or firmware update commands.

After pairing and entering your known FTP, choose **KICKR · live power, read-only** to ride the scene using actual power. Targets are guidance; trainer resistance remains unchanged by BikeSIM. Virtual speed is estimated from power, entered mass, and visual grade; trainer-reported speed is shown only in diagnostics. Fresh power is required; losing it pauses the ride.

Automatic ERG/SIM resistance control and Wi-Fi transport are not implemented yet. See [hardware validation](docs/HARDWARE_TESTS.md) and [implementation status](docs/IMPLEMENTATION_STATUS.md).

## Supervised ERG pilot

A separate diagnostic pilot is available for the hardware validation described in HT-2. Stop the existing BikeSIM development server before starting this opt-in server:

```sh
docker compose -f .devcontainer/compose.yaml exec -e VITE_TRAINER_CONTROL=pilot bikesim npm run dev
```

Reload Chrome and open **Trainer**. Pairing remains read-only. Select the rider readiness checkbox and **Start 50 W test**; the test waits without resistance commands until fresh power/cadence and at least 50 rpm arrive. Stop cancels that waiting state immediately. Once running, targets are limited to 50–100 W with changes of at most 10 W per second. Stop, visibility loss, stale telemetry, or low cadence ends the test with a best-effort standard stop command. Telemetry stays connected after an acknowledged stop; an uncertain control failure closes the link. An acknowledged stop does not prove physical unloading. A disconnected or crashed browser cannot guarantee reduced resistance. Select readiness again to start a new test on the same connection.

A full page refresh ends the browser's GATT session. BikeSIM attempts to restore **telemetry only** using the previously selected device and Chrome's `getDevices()` permission API. No control session or readiness is restored. If that API or saved permission is unavailable, use **Pair KICKR via Bluetooth**. The current Mac Chrome configuration did not restore its saved permission in the September 7 check, so seamless reconnection is not verified on this machine. **Reconnect KICKR** reuses the selected device within the current page without reopening the chooser. An intentional Disconnect disables refresh restoration for that tab. See [Chrome's saved-device sample](https://googlechrome.github.io/samples/web-bluetooth/get-devices.html) and [implementation status](https://github.com/WebBluetoothCG/web-bluetooth/blob/main/implementation-status.md).

Hot replacement is disabled in pilot mode so edits cannot replace an active controller. Reload only after stopping the test. The Compose default remains `off`; automatic workout resistance is still unavailable. Export the separate control test log from the test panel.

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

The scene is a procedural workout environment, not a surveyed Oaxaca route. Grade is visual in this release. Real GPX routes, detailed Blender assets, FIT/Strava export, and automatic training prescriptions are not part of this first implementation.
