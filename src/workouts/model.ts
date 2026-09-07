export type Category =
  'Recovery' | 'Endurance' | 'Tempo' | 'Sweet spot' | 'Threshold' | 'Cadence' | 'Hills';
export type Block = {
  name: string;
  seconds: number;
  from: number;
  to: number;
  cadence: number;
  grade: number;
  cue: string;
};
export type Workout = {
  id: string;
  name: string;
  category: Category;
  description: string;
  blocks: Block[];
  custom?: boolean;
};
export const totalSeconds = (w: Workout) => w.blocks.reduce((n, b) => n + b.seconds, 0);
export const clock = (seconds: number) => {
  const n = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(n / 60)
    .toString()
    .padStart(2, '0')}:${(n % 60).toString().padStart(2, '0')}`;
};
export function validateWorkout(w: Workout): void {
  if (
    !w ||
    typeof w.id !== 'string' ||
    !w.id ||
    typeof w.name !== 'string' ||
    typeof w.description !== 'string' ||
    !['Recovery', 'Endurance', 'Tempo', 'Sweet spot', 'Threshold', 'Cadence', 'Hills'].includes(
      w.category,
    ) ||
    !Array.isArray(w.blocks)
  )
    throw new Error('Invalid workout structure.');
  if (!w.name.trim() || w.name.length > 80 || !w.blocks.length || w.blocks.length > 200)
    throw new Error('Add a name and between 1 and 200 intervals.');
  for (const b of w.blocks) {
    if (
      !b ||
      typeof b.name !== 'string' ||
      !b.name.trim() ||
      b.name.length > 100 ||
      typeof b.cue !== 'string'
    )
      throw new Error('Each interval needs a valid name and cue.');
    if (![b.seconds, b.from, b.to, b.cadence, b.grade].every(Number.isFinite))
      throw new Error('All interval values must be valid numbers.');
    if (
      b.seconds < 5 ||
      b.seconds > 18000 ||
      b.from < 0.2 ||
      b.from > 1.2 ||
      b.to < 0.2 ||
      b.to > 1.2 ||
      b.cadence < 40 ||
      b.cadence > 130 ||
      b.grade < -3 ||
      b.grade > 8
    )
      throw new Error('Use 5–18000 seconds, 20–120% FTP, 40–130 rpm, and −3–8% visual grade.');
  }
  if (totalSeconds(w) > 21600) throw new Error('Keep workouts within six hours.');
}
export function position(w: Workout, elapsed: number) {
  let start = 0;
  for (let i = 0; i < w.blocks.length; i++) {
    const b = w.blocks[i];
    if (elapsed < start + b.seconds || i === w.blocks.length - 1) {
      const progress = Math.min(1, Math.max(0, (elapsed - start) / b.seconds));
      return {
        block: b,
        index: i,
        progress,
        start,
        remaining: Math.max(0, start + b.seconds - elapsed),
        target: b.from + (b.to - b.from) * progress,
      };
    }
    start += b.seconds;
  }
  throw new Error('Workout has no intervals.');
}
export function zoneColor(ratio: number) {
  return ratio < 0.55
    ? '#91adb1'
    : ratio < 0.76
      ? '#78b7f1'
      : ratio < 0.88
        ? '#74d7b5'
        : ratio < 0.95
          ? '#d9ef78'
          : ratio <= 1.05
            ? '#f3b86f'
            : '#ef8382';
}
const block = (
  name: string,
  minutes: number,
  target: number,
  grade = 0,
  cadence = 85,
  cue = 'Find a comfortable rhythm. Relax your shoulders.',
): Block => ({ name, seconds: minutes * 60, from: target, to: target, cadence, grade, cue });
const warm: Block = {
  ...block('Warm up', 5, 0.4),
  to: 0.65,
  cue: 'Start easy. Let your legs find their rhythm.',
};
const cool: Block = {
  ...block('Cool down', 5, 0.55),
  to: 0.35,
  cue: 'Ease off. Bring your breathing back down.',
};
function repeats(count: number, work: Block, recovery: Block) {
  return Array.from({ length: count }, (_, i) => [
    { ...work, name: `${work.name} ${i + 1}/${count}` },
    ...(i < count - 1 ? [{ ...recovery }] : []),
  ]).flat();
}
export const presets: Workout[] = [
  {
    id: 'endurance',
    name: 'The steady hour',
    category: 'Endurance',
    description:
      'Unhurried miles for your aerobic base. Settle into a conversational effort and enjoy the valley.',
    blocks: [warm, block('Steady endurance', 50, 0.65, 1), cool],
  },
  {
    id: 'sweet-spot',
    name: 'Find your sweet spot',
    category: 'Sweet spot',
    description:
      'Three focused efforts with room to recover. Build sustained power without chasing every hill.',
    blocks: [
      warm,
      ...repeats(
        3,
        block('Sweet spot', 8, 0.9, 3, 90, 'Steady pressure. Keep your upper body quiet.'),
        block('Recover', 3, 0.5),
      ),
      cool,
    ],
  },
  {
    id: 'hills',
    name: 'Into the foothills',
    category: 'Hills',
    description:
      'Four measured climbs above the valley. The road rises with each effort; ERG targets keep the workout consistent.',
    blocks: [
      warm,
      ...repeats(
        4,
        block('Climb', 4, 0.95, 5, 80, 'Hold a smooth, sustainable climbing rhythm.'),
        block('Valley recovery', 3, 0.5),
      ),
      cool,
    ],
  },
  {
    id: 'recovery',
    name: 'An easy spin',
    category: 'Recovery',
    description:
      'Make space for recovery. Light pressure on the pedals, easy breathing, and no numbers to chase.',
    blocks: [{ ...warm, to: 0.5 }, block('Easy spin', 20, 0.48), cool],
  },
  {
    id: 'tempo',
    name: 'A little further',
    category: 'Tempo',
    description: 'Two sustained tempo blocks to practice calm, consistent pacing for longer rides.',
    blocks: [warm, ...repeats(2, block('Tempo', 12, 0.82, 2, 90), block('Recover', 4, 0.5)), cool],
  },
  {
    id: 'threshold',
    name: 'Raise the ceiling',
    category: 'Threshold',
    description:
      'Four controlled efforts at your entered FTP. Choose this when you are ready for a demanding session.',
    blocks: [warm, ...repeats(4, block('Threshold', 5, 1, 4, 90), block('Recover', 3, 0.5)), cool],
  },
  {
    id: 'cadence',
    name: 'Light on the pedals',
    category: 'Cadence',
    description:
      'Short, light spin-ups with easy recoveries. Follow the cadence cues while keeping power comfortable.',
    blocks: [
      warm,
      ...repeats(
        5,
        block('Spin up', 1, 0.6, 0, 110, 'Quick, light pedals. Stay smooth in the saddle.'),
        block('Settle', 2, 0.5),
      ),
      cool,
    ],
  },
  {
    id: 'quick',
    name: 'First five minutes',
    category: 'Recovery',
    description: 'A short introduction to the simulator, with a gentle build and an easy finish.',
    blocks: [
      { ...warm, seconds: 60 },
      block('Find your rhythm', 3, 0.6, 1),
      { ...cool, seconds: 60 },
    ],
  },
];
