import { OUTPUTS, SETTINGS } from './protocol';

export type Gauge = {
  id: string;
  displacement: number;
  speed: number;
  bit: 0 | 1 | null;
};
export type Readout = {
  gauges: Gauge[];
  value: number | null;
  binary: string;
  settled: boolean;
};

export function readGauges(samples: { x: number; speed: number }[]): Readout {
  if (samples.length !== 3)
    throw new Error('Three fixed output gauges are required');
  const gauges: Gauge[] = samples.map((sample, i) => {
    const displacement = sample.x - OUTPUTS[i].x;
    let bit: Gauge['bit'] = null;
    if (
      Number.isFinite(displacement) &&
      displacement >= -0.05 &&
      displacement <= SETTINGS.zeroMax
    )
      bit = 0;
    if (
      Number.isFinite(displacement) &&
      displacement >= SETTINGS.oneMin &&
      displacement <= 1.05
    )
      bit = 1;
    return { id: OUTPUTS[i].id, displacement, speed: sample.speed, bit };
  });
  const value = gauges.some((g) => g.bit === null)
    ? null
    : gauges.reduce((sum, g, i) => sum + g.bit! * 2 ** i, 0);
  return {
    gauges,
    value,
    binary: [...gauges]
      .reverse()
      .map((g) => g.bit ?? '?')
      .join(''),
    settled: gauges.every(
      (g) =>
        g.bit !== null &&
        Number.isFinite(g.speed) &&
        g.speed <= SETTINGS.outputSpeedMax,
    ),
  };
}
