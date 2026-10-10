import { parseMachine, type Machine } from '../simulator/schema';
import { Simulation, type Intervention } from '../simulator/world';
import { NOMINAL, SETTINGS } from '../simulator/protocol';
import { evaluateSuite } from '../evaluator/evaluate';
import { caseOrder, conditionsForSeed } from '../evaluator/conditions';
import {
  leanTrial,
  type Phase,
  type StressSuite,
  type WorkerResponse,
} from './messages';

let simulation: Simulation | undefined;
let machine: Machine;
let operationSteps = 0;
let phase: Phase = 'ready';
let intervention: Intervention | undefined;
let queue = Promise.resolve();

const post = (message: WorkerResponse) => self.postMessage(message);
const operationTime = () => (simulation ? operationSteps * simulation.dt : 0);

/** Mirrors scripts/evaluate.ts --profile development: nominal, one perturbed
 * configuration per seed and a half-timestep audit, each in fresh and
 * persistent worlds with the seed's case order. Traces are not sent. */
async function stress(seeds: number[]) {
  if (
    seeds.length < 2 ||
    seeds.length > 32 ||
    !seeds.every((s) => Number.isInteger(s) && s >= 0 && s <= 0xffffffff) ||
    new Set(seeds).size !== seeds.length
  )
    throw new Error('Provide 2–32 distinct unsigned integer seeds');
  const configurations = [
    { label: 'nominal', conditions: { ...NOMINAL }, seed: seeds[0] },
    ...seeds.map((seed) => ({
      label: `perturbed-${seed}`,
      conditions: conditionsForSeed(seed),
      seed,
    })),
    {
      label: 'half-timestep',
      conditions: { ...NOMINAL, dtScale: 0.5 },
      seed: seeds[0],
    },
  ];
  const modes = ['fresh', 'persistent'] as const;
  const suiteCount = configurations.length * modes.length;
  const started = performance.now();
  const suites: StressSuite[] = [];
  for (const config of configurations) {
    for (const mode of modes) {
      const suiteIndex = suites.length;
      const { label, seed, conditions } = config;
      post({
        type: 'stress-suite-start',
        label,
        seed,
        mode,
        conditions,
        suiteIndex,
        suiteCount,
      });
      const suite = await evaluateSuite(machine, {
        conditions,
        mode,
        cases: caseOrder(seed),
        intervention,
        onTrial: (trial, index) =>
          post({
            type: 'stress-progress',
            label,
            mode,
            suiteIndex,
            suiteCount,
            index,
            trial: leanTrial(trial),
          }),
      });
      const summary: StressSuite = {
        label,
        seed,
        mode,
        conditions,
        successes: suite.successes,
        total: suite.total,
        resetFailures: suite.resetFailures,
        trials: suite.trials.map(leanTrial),
      };
      suites.push(summary);
      post({ type: 'stress-suite', suite: summary, suiteIndex });
    }
  }
  post({
    type: 'stressed',
    summary: {
      profile: 'development',
      seeds,
      intervention: intervention ?? null,
      suites,
      accepted: suites.every(
        (s) => s.successes === s.total && s.resetFailures === 0,
      ),
      wallSeconds: (performance.now() - started) / 1000,
    },
  });
}

self.onmessage = (event: MessageEvent) => {
  queue = queue
    .then(async () => {
      const message = event.data;
      if (message.type === 'load') {
        machine = parseMachine(message.text);
        intervention = message.intervention;
        simulation?.dispose();
        simulation = undefined;
        simulation = await Simulation.create(
          machine,
          message.a,
          message.b,
          undefined,
          intervention,
        );
        operationSteps = 0;
        phase = 'ready';
        post({
          type: 'ready',
          snapshot: simulation.snapshot(),
          machine,
          operationTime: 0,
        });
      } else if (message.type === 'prepare') {
        // Batch workers only need the parsed machine, not an interactive world
        // (whose setup could fail for one particular input pair).
        machine = parseMachine(message.text);
        intervention = message.intervention;
        simulation?.dispose();
        simulation = undefined;
        post({ type: 'prepared', machine });
      } else if (message.type === 'advance' && simulation) {
        if (
          !Number.isInteger(message.steps) ||
          message.steps < 1 ||
          message.steps > 16
        )
          throw new Error('Invalid step count');
        if (phase === 'ready') phase = 'run';
        if (phase !== 'finished') {
          const total = Math.round(
            (SETTINGS.driveSeconds + SETTINGS.settleSeconds) / simulation.dt,
          );
          const drive = Math.round(SETTINGS.driveSeconds / simulation.dt);
          for (let i = 0; i < message.steps && operationSteps < total; i++) {
            simulation.step(
              operationSteps < drive ? (phase === 'reset' ? -1 : 1) : 0,
            );
            operationSteps++;
          }
          if (operationSteps >= total) phase = 'finished';
        }
        post({
          type: 'frame',
          snapshot: simulation.snapshot(),
          phase,
          operationTime: operationTime(),
        });
      } else if (message.type === 'reset' && simulation) {
        phase = 'reset';
        operationSteps = 0;
        post({
          type: 'frame',
          snapshot: simulation.snapshot(),
          phase,
          operationTime: 0,
        });
      } else if (message.type === 'evaluate') {
        if (!machine) throw new Error('Load a machine first');
        const suite = await evaluateSuite(machine, {
          intervention,
          onTrial: (trial, index) => post({ type: 'progress', trial, index }),
        });
        post({ type: 'evaluated', suite });
      } else if (message.type === 'stress') {
        if (!machine) throw new Error('Load a machine first');
        await stress(message.seeds ?? [17, 29]);
      } else if (message.type === 'advance' || message.type === 'reset') {
        throw new Error('Load a machine first');
      }
    })
    .catch((error) =>
      post({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
};
