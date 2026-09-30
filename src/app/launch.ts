import { RideEngine } from '../ride/engine';
import { routeWorkout, type Route } from '../ride/terrain';
import { workoutControlIssue } from '../ride/workout-control';
import type { DeviceSnapshot } from '../trainer/bluetooth';
import type { Settings } from '../storage/store';
import type { Workout } from '../workouts/model';

/** Where power comes from, and whether BikeSIM may set the trainer's load. */
export type RideSource = 'demo' | 'live' | 'control';
export type RideRequest =
  | { kind: 'road'; route: Route; source: RideSource }
  | { kind: 'workout'; workout: Workout; source: RideSource };

/** Demo workouts without a saved FTP use this clearly labeled example. */
export const exampleFtp = 200;

export const freshPower = (device: DeviceSnapshot, now = performance.now()) =>
  device.status === 'connected' &&
  device.telemetry.powerAt !== undefined &&
  now - device.telemetry.powerAt < 3000;

/** Why a request cannot start yet, in words for the rider; null when it can. */
export function launchIssue(req: RideRequest, settings: Settings, device: DeviceSnapshot) {
  if (req.source === 'demo') return null;
  if (device.status !== 'connected') return 'Pair your KICKR on the Trainer page first.';
  if (!freshPower(device)) return 'Pedal gently so BikeSIM sees live power from the KICKR.';
  if (req.kind === 'workout' && settings.ftp === null)
    return 'Set your FTP in Settings, or take the ramp test, to ride a live workout.';
  if (req.source === 'control') {
    if (!settings.trainerControl) return 'Turn on trainer control in Settings.';
    if (req.kind === 'workout') return workoutControlIssue(req.workout, settings.ftp);
  }
  return null;
}

export function createRide(req: RideRequest, settings: Settings, device: DeviceSnapshot) {
  const issue = launchIssue(req, settings, device);
  if (issue) throw new Error(issue);
  const source = req.source === 'demo' ? 'demo' : 'bluetooth';
  const control = req.source === 'control';
  const common = {
    bikeMass: settings.bikeMass ?? 9,
    wheel: settings.wheel,
    position: settings.position,
  };
  return req.kind === 'road'
    ? new RideEngine(routeWorkout(req.route), source, settings.ftp, settings.mass, {
        ...common,
        route: req.route,
        trainerControl: control ? 'sim' : undefined,
      })
    : new RideEngine(req.workout, source, settings.ftp ?? exampleFtp, settings.mass, {
        ...common,
        trainerControl: control ? 'erg' : undefined,
      });
}
