import { position, validateWorkout, type Workout } from '../workouts/model';

export const workoutPowerLimits = Object.freeze({ min: 40, max: 600, startup: 50 });
export function workoutPowerRange(workout: Workout, ftp: number, bias = 1) {
  const fractions = workout.blocks.flatMap((b) => [b.from, b.to]);
  return {
    min: Math.round(Math.min(...fractions) * ftp * bias),
    max: Math.round(Math.max(...fractions) * ftp * bias),
  };
}
/** Check every possible target including the full 80–110% intensity range before arming. */
export function workoutControlIssue(workout: Workout, ftp: number | null): string | null {
  validateWorkout(workout);
  if (ftp === null || !Number.isFinite(ftp) || ftp < 50 || ftp > 600)
    return 'Enter your known FTP in Settings before starting automatic ERG.';
  if (workout.blocks.some((b) => b.cadence < 50))
    return 'Automatic ERG requires interval cadence targets of at least 50 rpm. Edit the cadence targets or use live-power guidance.';
  if (
    workoutPowerRange(workout, ftp, 0.8).min < workoutPowerLimits.min ||
    workoutPowerRange(workout, ftp, 1.1).max > workoutPowerLimits.max
  )
    return 'This workout and its intensity adjustments must stay within 40–600 W. Edit the workout or use live-power guidance; do not change your FTP just to fit the limit.';
  return null;
}
export function workoutPowerCeiling(workout: Workout, ftp: number) {
  return Math.max(workoutPowerLimits.startup, workoutPowerRange(workout, ftp, 1.1).max);
}
export function workoutTarget(workout: Workout, ftp: number, elapsed: number, bias: number) {
  return Math.round(position(workout, elapsed).target * ftp * bias);
}
