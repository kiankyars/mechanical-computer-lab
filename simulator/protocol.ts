export const PROTOCOL_VERSION = 'mechanical-adder-v1';
export const LIMITS = Object.freeze({
  fileBytes: 256_000,
  bodies: 128,
  colliders: 384,
  joints: 256,
  workspace: 12,
  speed: 100,
  angularSpeed: 100,
  initialPenetration: 0.00001,
  runningPenetration: 0.15,
  initialJointError: 0.00001,
  runningJointError: 0.2,
  springEnergy: 5,
});

export const SETTINGS = Object.freeze({
  dt: 1 / 240,
  solverIterations: 12,
  driveSeconds: 4,
  settleSeconds: 2,
  readSeconds: 0.5,
  crankSpeed: 2,
  crankTorque: 3,
  crankGain: 4,
  friction: 0.4,
  damping: 0.2,
  zeroMax: 0.25,
  oneMin: 0.75,
  outputSpeedMax: 0.08,
  inputTravel: 1,
  outputTravel: 1,
});

export const INPUTS = Object.freeze([
  { id: '$a0', x: -9, y: 4.5, word: 0, bit: 0 },
  { id: '$a1', x: -9, y: 1.5, word: 0, bit: 1 },
  { id: '$b0', x: -9, y: -1.5, word: 1, bit: 0 },
  { id: '$b1', x: -9, y: -4.5, word: 1, bit: 1 },
] as const);
export const OUTPUTS = Object.freeze([
  { id: '$s0', x: 8, y: 3 },
  { id: '$s1', x: 8, y: 0 },
  { id: '$s2', x: 8, y: -3 },
] as const);
export const CRANK = Object.freeze({ id: '$crank', x: 0, y: -6, radius: 0.5 });
export const FIXTURE_IDS = [
  '$ground',
  CRANK.id,
  ...INPUTS.map((x) => x.id),
  ...OUTPUTS.map((x) => x.id),
];

export type Conditions = {
  speedScale: number;
  torqueScale: number;
  frictionScale: number;
  inputOffset: number;
  dtScale: number;
};
export const NOMINAL: Readonly<Conditions> = Object.freeze({
  speedScale: 1,
  torqueScale: 1,
  frictionScale: 1,
  inputOffset: 0,
  dtScale: 1,
});
export const RANGES = Object.freeze({
  speedScale: [0.8, 1.2],
  torqueScale: [0.8, 1.2],
  frictionScale: [0.75, 1.25],
  inputOffset: [-0.02, 0.02],
});

export function validateConditions(value: Conditions): Conditions {
  if (Object.keys(value).sort().join() !== Object.keys(NOMINAL).sort().join())
    throw new Error('Unknown or missing condition fields');
  for (const [key, bounds] of Object.entries(RANGES)) {
    const n = value[key as keyof Conditions];
    if (!Number.isFinite(n) || n < bounds[0] || n > bounds[1])
      throw new Error(`Invalid condition: ${key}`);
  }
  if (![0.5, 1].includes(value.dtScale))
    throw new Error('dtScale must be 0.5 or 1');
  return { ...value };
}

export function validateInputs(a: number, b: number): void {
  if (![a, b].every((x) => Number.isInteger(x) && x >= 0 && x <= 3))
    throw new Error('Inputs must be integers from 0 through 3');
}
