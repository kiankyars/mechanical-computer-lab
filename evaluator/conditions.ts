import { NOMINAL, RANGES, type Conditions } from '../simulator/protocol';

export function randomGenerator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function conditionsForSeed(seed: number): Conditions {
  const random = randomGenerator(seed);
  const conditions = { ...NOMINAL };
  for (const [key, [low, high]] of Object.entries(RANGES))
    conditions[key as keyof Conditions] = low + random() * (high - low);
  return conditions;
}

export function caseOrder(seed: number): [number, number][] {
  const cases = Array.from(
    { length: 16 },
    (_, n) => [Math.floor(n / 4), n % 4] as [number, number],
  );
  const random = randomGenerator(seed);
  for (let i = cases.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [cases[i], cases[j]] = [cases[j], cases[i]];
  }
  return cases;
}
