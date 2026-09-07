import { NOMINAL, SETTINGS, type Conditions } from '../simulator/protocol';
import {
  Simulation,
  type Intervention,
  type Snapshot,
} from '../simulator/world';
import type { Machine } from '../simulator/schema';
import type { Readout } from '../simulator/readout';

export type Trial = {
  a: number;
  b: number;
  expected: number;
  observed: number | null;
  passed: boolean;
  reason: string;
  trace: Snapshot[];
  final: Snapshot | null;
};
export type Suite = {
  trials: Trial[];
  successes: number;
  total: number;
  successRate: number;
  conditions: Conditions;
  mode: 'fresh' | 'persistent';
  resetFailures: number;
};

export function scoreWindow(
  samples: Readout[],
  expected: number,
  requiredSamples: number,
): Pick<Trial, 'observed' | 'passed' | 'reason'> {
  if (samples.length !== requiredSamples || !samples.length)
    return { observed: null, passed: false, reason: 'incomplete-read-window' };
  const observed = samples[0].value;
  if (
    observed === null ||
    samples.some((s) => s.value !== observed || !s.settled)
  )
    return {
      observed: null,
      passed: false,
      reason: 'unsettled-or-ambiguous-output',
    };
  return {
    observed,
    passed: observed === expected,
    reason: observed === expected ? 'correct' : 'wrong-answer',
  };
}

export function operate(
  simulation: Simulation,
  a: number,
  b: number,
  traceEvery = 0,
): Trial {
  const expected = a + b; // The arithmetic oracle lives only in the evaluator, never in the simulator or viewer.
  const trace: Snapshot[] = [];
  const readings: Readout[] = [];
  const driveSteps = Math.round(SETTINGS.driveSeconds / simulation.dt);
  const totalSteps = Math.round(
    (SETTINGS.driveSeconds + SETTINGS.settleSeconds) / simulation.dt,
  );
  const readSteps = Math.round(SETTINGS.readSeconds / simulation.dt);
  try {
    if (traceEvery > 0) trace.push(simulation.snapshot());
    for (let i = 0; i < totalSteps; i++) {
      simulation.step(i < driveSteps ? 1 : 0);
      if (i >= totalSteps - readSteps) readings.push(simulation.readOutput());
      if (traceEvery > 0 && (i % traceEvery === 0 || i === totalSteps - 1))
        trace.push(simulation.snapshot());
    }
    return {
      a,
      b,
      expected,
      ...scoreWindow(readings, expected, readSteps),
      trace,
      final: simulation.snapshot(),
    };
  } catch (error) {
    return {
      a,
      b,
      expected,
      observed: null,
      passed: false,
      reason: `physics-error: ${String(error)}`,
      trace,
      final: null,
    };
  }
}

export async function runTrial(
  machine: Machine,
  a: number,
  b: number,
  conditions: Conditions = { ...NOMINAL },
  intervention?: Intervention,
  traceEvery = 0,
): Promise<Trial> {
  let simulation: Simulation | undefined;
  try {
    simulation = await Simulation.create(
      machine,
      a,
      b,
      conditions,
      intervention,
    );
    return operate(simulation, a, b, traceEvery);
  } catch (error) {
    return {
      a,
      b,
      expected: a + b,
      observed: null,
      passed: false,
      reason: `setup-error: ${String(error)}`,
      trace: [],
      final: null,
    };
  } finally {
    simulation?.dispose();
  }
}

export function reverseReset(simulation: Simulation): boolean {
  const driveSteps = Math.round(SETTINGS.driveSeconds / simulation.dt);
  const totalSteps = Math.round(
    (SETTINGS.driveSeconds + SETTINGS.settleSeconds) / simulation.dt,
  );
  const readSteps = Math.round(SETTINGS.readSeconds / simulation.dt);
  const readings: Readout[] = [];
  for (let i = 0; i < totalSteps; i++) {
    simulation.step(i < driveSteps ? -1 : 0);
    if (i >= totalSteps - readSteps) readings.push(simulation.readOutput());
  }
  return scoreWindow(readings, 0, readSteps).passed;
}

export async function evaluateSuite(
  machine: Machine,
  options: {
    conditions?: Conditions;
    intervention?: Intervention;
    mode?: 'fresh' | 'persistent';
    cases?: [number, number][];
    traceEvery?: number;
    onTrial?: (trial: Trial, index: number) => void;
  } = {},
): Promise<Suite> {
  const conditions = options.conditions ?? { ...NOMINAL };
  const cases =
    options.cases ??
    Array.from(
      { length: 16 },
      (_, n) => [Math.floor(n / 4), n % 4] as [number, number],
    );
  const mode = options.mode ?? 'fresh';
  const trials: Trial[] = [];
  let simulation: Simulation | undefined;
  let persistentError: string | undefined;
  let resetFailures = 0;
  try {
    for (let index = 0; index < cases.length; index++) {
      const [a, b] = cases[index];
      let trial: Trial;
      if (mode === 'fresh')
        trial = await runTrial(
          machine,
          a,
          b,
          conditions,
          options.intervention,
          options.traceEvery,
        );
      else {
        try {
          if (persistentError) throw new Error(persistentError);
          if (!simulation)
            simulation = await Simulation.create(
              machine,
              a,
              b,
              conditions,
              options.intervention,
            );
          else {
            if (!reverseReset(simulation)) resetFailures++;
            simulation.configureInputs(a, b);
          }
          trial = operate(simulation, a, b, options.traceEvery);
          if (trial.reason.startsWith('physics-error'))
            persistentError = trial.reason;
        } catch (error) {
          persistentError = String(error);
          trial = {
            a,
            b,
            expected: a + b,
            observed: null,
            passed: false,
            reason: `persistent-error: ${persistentError}`,
            trace: [],
            final: null,
          };
        }
      }
      trials.push(trial);
      options.onTrial?.(trial, index);
    }
  } finally {
    simulation?.dispose();
  }
  const successes = trials.filter((t) => t.passed).length;
  return {
    trials,
    successes,
    total: cases.length,
    successRate: cases.length ? successes / cases.length : 0,
    conditions,
    mode,
    resetFailures,
  };
}
