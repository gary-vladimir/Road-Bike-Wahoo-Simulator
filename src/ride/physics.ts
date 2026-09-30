/**
 * Virtual bicycle physics. Speed comes from measured power and road forces; it is never copied
 * from the trainer's flywheel or inferred from cadence and gearing.
 *
 * drive   = efficiency × power / max(v, minimumDriveSpeed)
 * gravity = −m g sin(θ)            (positive downhill)
 * rolling = m g Crr cos(θ)
 * air     = ½ ρ CdA (v + wind)|v + wind|
 * a       = (drive + gravity − rolling − air − braking) / (m + wheel inertia)
 */
export const gravity = 9.81;
export const drivetrainEfficiency = 0.97;
/** Rotating wheels add roughly I/r² ≈ 1.7 kg of effective mass to a 700C road bike. */
export const wheelInertiaMass = 1.7;
/** Crank torque and the selected gear are unknown at walking pace; bound launch force. */
export const minimumDriveSpeed = 0.75;
/** Oaxaca's central valley sits at about 1,550 m; its thinner air lowers drag by ~18%. */
export const oaxacaAltitude = 1550;
export const maxSpeedKmh = 150;

export type RidingPosition = 'upright' | 'hoods' | 'drops' | 'aero';
export const ridingPositions: Record<RidingPosition, { label: string; cda: number; hint: string }> =
  {
    upright: { label: 'Upright', cda: 0.4, hint: 'Hands on the tops, relaxed' },
    hoods: { label: 'Hoods', cda: 0.32, hint: 'Typical road position' },
    drops: { label: 'Drops', cda: 0.29, hint: 'Lower and faster' },
    aero: { label: 'Aero', cda: 0.25, hint: 'Clip-on bars, triathlon position' },
  };

export type PhysicsSetup = {
  riderMass: number;
  bikeMass: number;
  /** Drag area in m². */
  cda: number;
  /** Rolling resistance coefficient. */
  crr: number;
  /** kg/m³ */
  airDensity: number;
  /** Head (+) or tail (−) wind in m/s. */
  windSpeed: number;
};

/** International Standard Atmosphere pressure at altitude, at a comfortable riding temperature. */
export function airDensity(altitude: number, temperatureC = 20) {
  const pressure = 101325 * Math.pow(1 - 2.25577e-5 * altitude, 5.25588);
  return pressure / (287.05 * (temperatureC + 273.15));
}

export function createSetup({
  riderMass,
  bikeMass = 9,
  position = 'hoods',
  crr = 0.004,
  altitude = oaxacaAltitude,
  windSpeed = 0,
}: {
  riderMass: number;
  bikeMass?: number;
  position?: RidingPosition;
  crr?: number;
  altitude?: number;
  windSpeed?: number;
}): PhysicsSetup {
  const setup = {
    riderMass,
    bikeMass,
    cda: ridingPositions[position]?.cda ?? ridingPositions.hoods.cda,
    crr,
    airDensity: airDensity(altitude),
    windSpeed,
  };
  validateSetup(setup);
  return setup;
}

export function validateSetup(s: PhysicsSetup) {
  if (
    ![s.riderMass, s.bikeMass, s.cda, s.crr, s.airDensity, s.windSpeed].every(Number.isFinite) ||
    s.riderMass < 35 ||
    s.riderMass > 200 ||
    s.bikeMass < 4 ||
    s.bikeMass > 30 ||
    s.cda < 0.15 ||
    s.cda > 0.7 ||
    s.crr < 0.001 ||
    s.crr > 0.02 ||
    s.airDensity < 0.6 ||
    s.airDensity > 1.4 ||
    Math.abs(s.windSpeed) > 15
  )
    throw new Error('Road physics input is outside supported limits');
}

/** The FTMS "wind resistance coefficient" (kg/m) matching this setup's aerodynamic drag. */
export const windCoefficient = (s: PhysicsSetup) => 0.5 * s.airDensity * s.cda;

const totalMass = (s: PhysicsSetup) => s.riderMass + s.bikeMass;

/** Forces in newtons at speed `v` (m/s); gravity is positive downhill. */
function forcesAt(v: number, power: number, grade: number, s: PhysicsSetup) {
  const angle = Math.atan(grade / 100),
    mass = totalMass(s),
    relativeAir = v + s.windSpeed;
  const gravityForce = -mass * gravity * Math.sin(angle);
  const rolling = mass * gravity * s.crr * Math.cos(angle);
  const air = windCoefficient(s) * relativeAir * Math.abs(relativeAir);
  const drive = (Math.max(0, power) * drivetrainEfficiency) / Math.max(v, minimumDriveSpeed);
  return {
    gravity: gravityForce,
    rolling,
    air,
    drive,
    acceleration: (drive + gravityForce - rolling - air) / (mass + wheelInertiaMass),
  };
}

/** The same instantaneous force balance used by the integrator; speed is in km/h. */
export function roadForces(speed: number, power: number, grade: number, setup: PhysicsSetup) {
  return forcesAt(speed / 3.6, power, grade, setup);
}

/** Speed that zero-watt coasting settles toward on a constant grade (km/h, 0 if it stops). */
export function coastingSpeed(grade: number, setup: PhysicsSetup) {
  const angle = Math.atan(grade / 100),
    mass = totalMass(setup);
  const pull = mass * gravity * (-Math.sin(angle) - setup.crr * Math.cos(angle));
  return pull <= 0 ? 0 : Math.sqrt(pull / windCoefficient(setup)) * 3.6;
}

export type CoastTrend = 'Stopped' | 'Steady speed' | 'Gaining speed' | 'Slowing down';
export function coastStatus(speed: number, grade: number, setup: PhysicsSetup) {
  const { acceleration } = roadForces(speed, 0, grade, setup);
  if (speed <= 0.1 && acceleration <= 0)
    return { trend: 'Stopped' as CoastTrend, explanation: 'Pedal to overcome the road load.' };
  if (Math.abs(acceleration) < 0.005)
    return {
      trend: 'Steady speed' as CoastTrend,
      explanation: 'Gravity and drag are nearly balanced.',
    };
  if (acceleration > 0)
    return {
      trend: 'Gaining speed' as CoastTrend,
      explanation: 'Gravity exceeds rolling and air drag.',
    };
  return {
    trend: 'Slowing down' as CoastTrend,
    explanation:
      grade < 0
        ? 'Still moving downhill; rolling and air drag exceed gravity.'
        : grade > 0
          ? 'Climbing and drag use up your momentum.'
          : 'Rolling and air drag use up your momentum.',
  };
}

/** Riders brake before a corner rather than taking it faster than the road allows. */
export const maxBrakingDeceleration = 3.5;

/**
 * Integrate motion over `seconds` at ≤10 ms steps, independent of render or tick rate.
 * Forward-only: an uphill coast stops without rolling backward or adding distance.
 * `limitKmh` applies rider braking (e.g. for a sharp corner ahead) but never adds speed.
 * Returns speed in km/h and distance in meters.
 */
export function advance(
  speed: number,
  power: number,
  grade: number,
  setup: PhysicsSetup,
  seconds: number,
  limitKmh = maxSpeedKmh,
) {
  if (
    ![speed, power, grade, seconds, limitKmh].every(Number.isFinite) ||
    speed < 0 ||
    speed > maxSpeedKmh ||
    Math.abs(grade) > 30 ||
    seconds < 0 ||
    seconds > 2.5
  )
    throw new Error('Road physics input is outside supported limits');
  validateSetup(setup);
  let v = speed / 3.6,
    distance = 0,
    braking = false;
  const limit = Math.max(0, limitKmh) / 3.6;
  const steps = Math.max(1, Math.ceil(seconds / 0.01)),
    dt = seconds / steps;
  for (let i = 0; i < steps; i++) {
    let { acceleration } = forcesAt(v, power, grade, setup);
    if (v > limit) {
      // Brake progressively toward the limit, as a rider would feather the brakes.
      acceleration = Math.min(acceleration, -Math.min(maxBrakingDeceleration, (v - limit) * 4));
      braking = true;
    }
    const stopTime = acceleration < 0 && v + acceleration * dt < 0 ? v / -acceleration : dt;
    const next = Math.min(maxSpeedKmh / 3.6, Math.max(0, v + acceleration * stopTime));
    distance += (v + next) * 0.5 * stopTime;
    v = next;
    if (stopTime < dt) break;
  }
  return { speed: v * 3.6, distance, braking };
}
