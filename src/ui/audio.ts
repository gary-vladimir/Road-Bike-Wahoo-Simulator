/** Short synthesized cues; no audio files, nothing leaves the computer. */
let context: AudioContext | undefined;
function audio() {
  if (typeof AudioContext === 'undefined') return undefined;
  context ??= new AudioContext();
  if (context.state === 'suspended') void context.resume();
  return context;
}

function tone(frequency: number, start: number, duration: number, volume = 0.18) {
  const ctx = audio();
  if (!ctx) return;
  const osc = ctx.createOscillator(),
    gain = ctx.createGain();
  const t = ctx.currentTime + start;
  osc.type = 'sine';
  osc.frequency.value = frequency;
  // Quick attack and decay: clicks-free and easy to hear over a fan.
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

export const cues = {
  /** 3, 2, 1 … */
  tick: () => tone(660, 0, 0.16),
  /** … go. */
  go: () => tone(990, 0, 0.42, 0.22),
  /** An interval starts: rising for harder, falling for easier. */
  interval: (harder: boolean) => {
    const [a, b] = harder ? [523, 784] : [784, 523];
    tone(a, 0, 0.18);
    tone(b, 0.16, 0.3);
  },
  /** ERG eased off for low cadence. */
  easing: () => {
    tone(440, 0, 0.14, 0.14);
    tone(440, 0.2, 0.14, 0.14);
  },
  finish: () => {
    tone(523, 0, 0.2);
    tone(659, 0.18, 0.2);
    tone(784, 0.36, 0.5);
  },
};
