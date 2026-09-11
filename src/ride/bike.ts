export type WheelSetup = {
  beadSeatMm: number;
  tireWidthMm: number;
  circumferenceMm: number;
};
// Rider-confirmed 700×32C / 32-622. Circumference is nominal, not a measured rollout.
export const stockWheel: WheelSetup = { beadSeatMm: 622, tireWidthMm: 32, circumferenceMm: 2155 };
export function nominalCircumference(beadSeatMm: number, tireWidthMm: number) {
  return Math.round(Math.PI * (beadSeatMm + 2 * tireWidthMm));
}
export function validateWheel(w: WheelSetup) {
  if (
    !w ||
    ![w.beadSeatMm, w.tireWidthMm, w.circumferenceMm].every(Number.isFinite) ||
    ![559, 584, 622].includes(w.beadSeatMm) ||
    w.tireWidthMm < 20 ||
    w.tireWidthMm > 75 ||
    w.circumferenceMm < 1700 ||
    w.circumferenceMm > 2500
  )
    throw new Error(
      'Check wheel diameter, tire width (20–75 mm), and circumference (1700–2500 mm).',
    );
}
export function wheelLabel(w: WheelSetup) {
  return `${w.beadSeatMm === 622 ? '700' : w.beadSeatMm === 584 ? '650' : '26″'}×${w.tireWidthMm}${w.beadSeatMm === 622 ? 'C' : w.beadSeatMm === 584 ? 'B' : ''}`;
}
export const virtualWheelRpm = (speedKmh: number, wheel: WheelSetup) =>
  (speedKmh * 1_000_000) / (60 * wheel.circumferenceMm);
