export const categories = [
  'Recovery',
  'Endurance',
  'Tempo',
  'Sweet spot',
  'Threshold',
  'VO2max',
  'Anaerobic',
  'Hills',
  'Torque',
  'Cadence',
  'Race pace',
] as const;
export type Category = (typeof categories)[number];
export type Block = {
  name: string;
  seconds: number;
  /** Target at the start and end of the block, as a fraction of FTP. */
  from: number;
  to: number;
  cadence: number;
  /** Visual road grade (%) for the generated workout road. ERG ignores it. */
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
  /** Relevance for triathlon training, from cycling_presets.md (1–3). */
  triathlon?: 1 | 2 | 3;
};
export const maxIntensity = 1.6;
export const totalSeconds = (w: Workout) => w.blocks.reduce((n, b) => n + b.seconds, 0);
/** m:ss, or h:mm:ss from one hour. */
const hms = (n: number) => {
  const h = Math.floor(n / 3600),
    m = Math.floor((n % 3600) / 60),
    s = n % 60;
  const ss = s.toString().padStart(2, '0');
  return h ? `${h}:${m.toString().padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};
/** Elapsed time in whole seconds, like a stopwatch (and like Strava): 25:24.9 reads 25:24. */
export const clock = (seconds: number) => hms(Math.max(0, Math.floor(seconds + 1e-6)));
/** Time remaining, rounded up so a countdown reads 0:01 until it reaches zero. */
export const countdown = (seconds: number) => hms(Math.max(0, Math.ceil(seconds - 1e-6)));
export function validateWorkout(w: Workout): void {
  if (
    !w ||
    typeof w.id !== 'string' ||
    !w.id ||
    typeof w.name !== 'string' ||
    typeof w.description !== 'string' ||
    !(categories as readonly string[]).includes(w.category) ||
    !Array.isArray(w.blocks) ||
    (w.triathlon !== undefined && ![1, 2, 3].includes(w.triathlon))
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
      b.from > maxIntensity ||
      b.to < 0.2 ||
      b.to > maxIntensity ||
      b.cadence < 40 ||
      b.cadence > 130 ||
      b.grade < -3 ||
      b.grade > 8
    )
      throw new Error('Use 5–18000 seconds, 20–160% FTP, 40–130 rpm, and −3–8% visual grade.');
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
/** Coggan-style power zones by fraction of FTP. */
export const zones = [
  { id: 'Z1', name: 'Recovery', upTo: 0.55, color: '#7d8a96' },
  { id: 'Z2', name: 'Endurance', upTo: 0.76, color: '#4f9bd9' },
  { id: 'Z3', name: 'Tempo', upTo: 0.88, color: '#3fb58f' },
  { id: 'Z4', name: 'Sweet spot', upTo: 0.95, color: '#e9c46a' },
  { id: 'Z5', name: 'Threshold', upTo: 1.06, color: '#f4a340' },
  { id: 'Z6', name: 'VO2max', upTo: 1.21, color: '#e8657e' },
  { id: 'Z7', name: 'Anaerobic', upTo: Infinity, color: '#b86fd9' },
] as const;
export const zoneOf = (ratio: number) => zones.find((z) => ratio < z.upTo) ?? zones.at(-1)!;
export const zoneColor = (ratio: number) => zoneOf(ratio).color;

/** Planned intensity factor and training stress, from the targets at 1-second resolution. */
export function workoutLoad(w: Workout) {
  let fourth = 0;
  const seconds = totalSeconds(w);
  for (const b of w.blocks)
    for (let t = 0; t < b.seconds; t++) {
      const f = b.from + ((b.to - b.from) * (t + 0.5)) / b.seconds;
      fourth += f ** 4;
    }
  const intensity = seconds ? (fourth / seconds) ** 0.25 : 0;
  return {
    intensity: Math.round(intensity * 100) / 100,
    stress: Math.round((seconds / 3600) * intensity ** 2 * 100),
  };
}

const block = (
  name: string,
  minutes: number,
  target: number,
  grade = 0,
  cadence = 85,
  cue = 'Find a comfortable rhythm. Relax your shoulders.',
): Block => ({
  name,
  seconds: Math.round(minutes * 60),
  from: target,
  to: target,
  cadence,
  grade,
  cue,
});
const ramp = (name: string, minutes: number, from: number, to: number, cue: string): Block => ({
  ...block(name, minutes, from, 0, 88, cue),
  to,
});
const warm: Block = ramp('Warm up', 5, 0.4, 0.65, 'Start easy. Let your legs find their rhythm.');
const longWarm: Block = ramp('Warm up', 10, 0.4, 0.7, 'Build gently. Settle your breathing.');
const cool: Block = ramp('Cool down', 5, 0.55, 0.35, 'Ease off. Bring your breathing back down.');
const longCool: Block = ramp('Cool down', 10, 0.6, 0.35, 'Spin it out. Well done.');
function repeats(count: number, work: Block | Block[], recovery?: Block) {
  const set = Array.isArray(work) ? work : [work];
  return Array.from({ length: count }, (_, i) => [
    ...set.map((b) => ({ ...b, name: `${b.name} ${i + 1}/${count}` })),
    ...(recovery && i < count - 1 ? [{ ...recovery }] : []),
  ]).flat();
}
const fuel = 'Drink now. On long rides, eat every 30–40 minutes.';

export const presets: Workout[] = [
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
  {
    id: 'recovery',
    name: 'An easy spin',
    category: 'Recovery',
    triathlon: 2,
    description:
      'Make space for recovery. Light pressure on the pedals, easy breathing, and no numbers to chase.',
    blocks: [{ ...warm, to: 0.5 }, block('Easy spin', 20, 0.48, 0, 90), cool],
  },
  {
    id: 'recovery-45',
    name: 'Recovery spin',
    category: 'Recovery',
    triathlon: 2,
    description:
      'Forty-five almost embarrassingly easy minutes at 85–95 rpm. Circulation, not fitness.',
    blocks: [
      { ...warm, to: 0.5 },
      block('Easy spin', 35, 0.5, 0, 92, 'Light and smooth. You should be able to hum.'),
      cool,
    ],
  },
  {
    id: 'endurance',
    name: 'The steady hour',
    category: 'Endurance',
    triathlon: 3,
    description:
      'Unhurried miles for your aerobic base. Settle into a conversational effort and enjoy the valley.',
    blocks: [warm, block('Steady endurance', 50, 0.65, 1), cool],
  },
  {
    id: 'endurance-90',
    name: 'Long valley miles',
    category: 'Endurance',
    triathlon: 3,
    description:
      'Ninety minutes of Zone 2, the most important ride for a triathlete. Practice drinking on schedule.',
    blocks: [
      longWarm,
      ...repeats(3, block('Zone 2', 22, 0.68, 1, 88, fuel)),
      block('Zone 2', 3, 0.66, 1),
      longCool,
    ],
  },
  {
    id: 'long-ride',
    name: 'The long one',
    category: 'Endurance',
    triathlon: 3,
    description:
      'Two hours of steady aerobic riding for durability, with regular fueling reminders.',
    blocks: [longWarm, ...repeats(5, block('Long Zone 2', 20, 0.66, 1, 88, fuel)), longCool],
  },
  {
    id: 'tempo',
    name: 'A little further',
    category: 'Tempo',
    triathlon: 3,
    description: 'Two sustained tempo blocks to practice calm, consistent pacing for longer rides.',
    blocks: [warm, ...repeats(2, block('Tempo', 12, 0.82, 2, 90), block('Recover', 4, 0.5)), cool],
  },
  {
    id: 'tempo-3x20',
    name: 'Three tempo twenties',
    category: 'Tempo',
    triathlon: 3,
    description:
      'Three 20-minute tempo blocks at 80% FTP. Moderate, sustained power without deep fatigue.',
    blocks: [
      longWarm,
      ...repeats(
        3,
        block('Tempo', 20, 0.8, 2, 90, 'Steady and calm. This should feel sustainable.'),
        block('Easy', 5, 0.5),
      ),
      longCool,
    ],
  },
  {
    id: 'sweet-spot',
    name: 'Find your sweet spot',
    category: 'Sweet spot',
    triathlon: 3,
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
    id: 'sweet-spot-3x15',
    name: 'Sweet spot 3 × 15',
    category: 'Sweet spot',
    triathlon: 3,
    description:
      'Three 15-minute blocks at 90% FTP: a big aerobic stimulus that still leaves legs for your run.',
    blocks: [
      longWarm,
      ...repeats(
        3,
        block('Sweet spot', 15, 0.9, 3, 90, 'Hold it steady. Breathe low and even.'),
        block('Recover', 5, 0.5),
      ),
      longCool,
    ],
  },
  {
    id: 'sweet-spot-2x30',
    name: 'Sweet spot 2 × 30',
    category: 'Sweet spot',
    triathlon: 3,
    description: 'Two half-hour blocks at 88–90% FTP. A step up once 3 × 15 feels controlled.',
    blocks: [
      longWarm,
      ...repeats(
        2,
        block('Sweet spot', 30, 0.89, 3, 90, 'Settle in for the long haul. Stay smooth.'),
        block('Recover', 6, 0.5),
      ),
      longCool,
    ],
  },
  {
    id: 'threshold',
    name: 'Raise the ceiling',
    category: 'Threshold',
    triathlon: 3,
    description:
      'Four controlled efforts at your FTP. Choose this when you are ready for a demanding session.',
    blocks: [warm, ...repeats(4, block('Threshold', 5, 1, 4, 90), block('Recover', 3, 0.5)), cool],
  },
  {
    id: 'threshold-4x8',
    name: 'Four by eight',
    category: 'Threshold',
    triathlon: 3,
    description: 'Four 8-minute efforts at 100% FTP. Higher FTP makes every other pace easier.',
    blocks: [
      longWarm,
      ...repeats(
        4,
        block('Threshold', 8, 1, 4, 90, 'Hard but controlled. Don’t start too fast.'),
        block('Recover', 4, 0.5),
      ),
      longCool,
    ],
  },
  {
    id: 'threshold-2x20',
    name: 'Two by twenty',
    category: 'Threshold',
    triathlon: 3,
    description: 'The classic: two 20-minute efforts at 95–100% FTP. Pace the first one patiently.',
    blocks: [
      longWarm,
      ...repeats(
        2,
        block('Threshold', 20, 0.97, 4, 90, 'Patient first half, strong second half.'),
        block('Recover', 8, 0.5),
      ),
      longCool,
    ],
  },
  {
    id: 'vo2max',
    name: 'Oxygen ceiling',
    category: 'VO2max',
    triathlon: 2,
    description:
      'Five 4-minute efforts at 115% FTP with equal recovery. Raises your aerobic ceiling.',
    blocks: [
      longWarm,
      ...repeats(
        5,
        block('VO2max', 4, 1.15, 5, 95, 'Deep, fast breathing. Hold on to the last minute.'),
        block('Recover', 4, 0.5),
      ),
      longCool,
    ],
  },
  {
    id: 'thirty-thirty',
    name: 'Thirty-thirties',
    category: 'Anaerobic',
    triathlon: 1,
    description:
      'Ten 30-second surges at 150% FTP, each followed by 30 seconds easy. Short and sharp.',
    blocks: [
      longWarm,
      ...repeats(10, [
        block('Surge', 0.5, 1.5, 4, 100, 'Go! Quick, strong pedal strokes.'),
        block('Float', 0.5, 0.5, 0, 90, 'Breathe. Next one is coming.'),
      ]),
      block('Recover', 5, 0.5),
      longCool,
    ],
  },
  {
    id: 'over-unders',
    name: 'Over-unders',
    category: 'Threshold',
    triathlon: 2,
    description:
      'Two minutes just over threshold, two minutes just under, three times per set. Learn to recover while working.',
    blocks: [
      longWarm,
      ...repeats(
        3,
        [
          block('Over', 2, 1.05, 4, 92, 'Just over the line. Stay seated.'),
          block('Under', 2, 0.9, 3, 90, 'Recover while still working.'),
          block('Over', 2, 1.05, 4, 92, 'Back over. Smooth.'),
          block('Under', 2, 0.9, 3, 90, 'Hold your form.'),
        ],
        block('Recover', 5, 0.5),
      ),
      longCool,
    ],
  },
  {
    id: 'surges',
    name: 'Surges',
    category: 'Anaerobic',
    triathlon: 1,
    description:
      'Steady tempo interrupted by a 30-second attack every five minutes, like a lively group ride.',
    blocks: [
      longWarm,
      ...repeats(6, [
        block('Tempo', 4.5, 0.8, 2, 90, 'Settle back into tempo.'),
        block('Attack', 0.5, 1.5, 4, 100, 'Attack! Out of the saddle if you like.'),
      ]),
      longCool,
    ],
  },
  {
    id: 'hills',
    name: 'Into the foothills',
    category: 'Hills',
    triathlon: 2,
    description:
      'Four measured climbs above the valley. The road rises with each effort; ERG keeps the workout consistent.',
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
    id: 'hill-repeats',
    name: 'Six hill repeats',
    category: 'Hills',
    triathlon: 2,
    description: 'Six 5-minute climbs at 100–105% FTP. Strength and aerobic power together.',
    blocks: [
      longWarm,
      ...repeats(
        6,
        { ...block('Climb', 5, 1, 7, 78, 'Seated, strong and steady. Own the climb.'), to: 1.05 },
        block('Descend and recover', 3, 0.5, -2),
      ),
      longCool,
    ],
  },
  {
    id: 'torque',
    name: 'Big-gear strength',
    category: 'Torque',
    triathlon: 3,
    description:
      'Five 5-minute efforts at 85% FTP and 55–65 rpm. Cycling-specific strength without heavy grinding.',
    blocks: [
      longWarm,
      ...repeats(
        5,
        block('Low cadence', 5, 0.85, 5, 60, 'Big gear, smooth strong strokes at 55–65 rpm.'),
        block('Spin easy', 4, 0.5, 0, 95),
      ),
      longCool,
    ],
  },
  {
    id: 'cadence',
    name: 'Light on the pedals',
    category: 'Cadence',
    triathlon: 2,
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
    id: 'race-pace',
    name: 'Race pace rehearsal',
    category: 'Race pace',
    triathlon: 3,
    description:
      'Three 20-minute blocks at 80% FTP, a typical Olympic-distance bike pace. Boringly consistent wins.',
    blocks: [
      longWarm,
      ...repeats(
        3,
        block('Race pace', 20, 0.8, 1, 90, 'Race pace: steady, aero, sustainable. Drink.'),
        block('Easy', 5, 0.55),
      ),
      longCool,
    ],
  },
  {
    id: 'brick',
    name: 'Brick: bike before the run',
    category: 'Race pace',
    triathlon: 3,
    description:
      'Endurance riding that finishes with 15 minutes at race pace. Go straight into a 15–20 minute easy run.',
    blocks: [
      longWarm,
      block('Zone 2', 30, 0.68, 1, 88, fuel),
      block('Race pace', 15, 0.8, 1, 90, 'Race pace. Practice the finish of your bike leg.'),
      block('Transition', 3, 0.5, 0, 95, 'Spin out. Next: shoes on, and run easy.'),
    ],
  },
];

/** A simple weekly rhythm: easy days around the key sessions, a long ride on the weekend. */
const weekPlan = [
  'endurance-90', // Sunday
  'recovery-45',
  'sweet-spot-3x15',
  'endurance',
  'threshold-4x8',
  'cadence',
  'long-ride',
];
export function todaysWorkout(date = new Date()) {
  return presets.find((w) => w.id === weekPlan[date.getDay()]) ?? presets[0];
}
