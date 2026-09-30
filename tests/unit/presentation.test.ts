import { describe, expect, it } from 'vitest';
import { activityPresentation, fitText } from '../../src/export/presentation';
import { exportSession } from '../fixtures/export-session';
import { sessionFit } from '../../src/export/fit';
import { Decoder, Stream } from '@garmin/fitsdk';

describe('manual upload presentation', () => {
  it('describes recorded distance and mode without claiming a partial route was completed', () => {
    const s = exportSession();
    s.status = 'stopped';
    s.trainerControl = 'sim';
    const p = activityPresentation(s);
    expect(p.title).toBe('BikeSIM - Valley coast & climb');
    expect(p.description).toContain('Partial ride:');
    expect(p.description).toContain('0.03 km virtual distance in 0:10');
    expect(p.description).toContain('automatic trainer resistance');
    expect(p.description).not.toContain('Completed');
    s.source = 'demo';
    expect(activityPresentation(s).title).toMatch(/^DEMO/);
    expect(activityPresentation(s).description).toContain('not a real training activity');
  });
  it('keeps unicode text within FIT byte limits and decodes valid long metadata', () => {
    const text = '🚴 Oaxaca México '.repeat(80);
    const short = fitText(text);
    expect(new TextEncoder().encode(short).length).toBeLessThanOrEqual(254);
    expect(short).not.toContain('\uFFFD');
    expect(fitText('a\0b')).toBe('ab');
    // Shortened text ends at a word, never mid-word.
    expect(short.endsWith('…')).toBe(true);
    expect(short).toMatch(/(Oaxaca|México|🚴)…$/u);
    const ride = fitText('Recorded trainer power; virtual speed and distance. '.repeat(8));
    expect(new TextEncoder().encode(ride).length).toBeLessThanOrEqual(254);
    expect(ride).toMatch(/(Recorded|trainer|power|virtual|speed|and|distance)…$/);
    const s = exportSession();
    s.workout.name = '🚴'.repeat(40);
    s.workout.description = text;
    const decoder = new Decoder(Stream.fromByteArray([...sessionFit(s)]));
    expect(decoder.checkIntegrity()).toBe(true);
    const { messages, errors } = decoder.read();
    expect(errors).toEqual([]);
    expect(messages.workoutMesgs?.[0].wktName).toBe(activityPresentation(s).title);
    expect(messages.workoutMesgs?.[0].wktDescription).toBe(
      fitText(activityPresentation(s).description),
    );
  });
});
