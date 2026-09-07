import { type Workout, totalSeconds, zoneColor } from '../workouts/model';
export default function Profile({
  workout,
  elapsed,
  large = false,
}: {
  workout: Workout;
  elapsed?: number;
  large?: boolean;
}) {
  const total = totalSeconds(workout);
  return (
    <div
      className={`profile ${large ? 'large' : ''}`}
      role="img"
      aria-label={`${workout.name}: ${workout.blocks.length} intervals, ${Math.round(total / 60)} minutes`}
    >
      {workout.blocks.map((b, i) => (
        <div
          key={i}
          style={{
            flex: b.seconds,
            height: `${(Math.max(b.from, b.to) / 1.2) * 100}%`,
            background: zoneColor(b.to),
            clipPath:
              b.from !== b.to
                ? `polygon(0 ${Math.max(0, (1 - b.from / Math.max(b.from, b.to)) * 100)}%,100% ${Math.max(0, (1 - b.to / Math.max(b.from, b.to)) * 100)}%,100% 100%,0 100%)`
                : undefined,
          }}
          title={`${b.name} · ${Math.round(b.seconds / 60)} min · ${Math.round(b.to * 100)}% FTP`}
        />
      ))}
      {elapsed !== undefined && (
        <span
          className="profile-cursor"
          style={{ left: `${Math.min(100, (elapsed / total) * 100)}%` }}
        />
      )}
    </div>
  );
}
