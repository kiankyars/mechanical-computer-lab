import { parseMachine, type Machine } from '../simulator/schema';
import { Simulation, type Intervention } from '../simulator/world';
import { SETTINGS } from '../simulator/protocol';
import { evaluateSuite } from '../evaluator/evaluate';

let simulation: Simulation | undefined;
let machine: Machine;
let operationSteps = 0;
let phase: 'ready' | 'run' | 'reset' | 'finished' = 'ready';
let intervention: Intervention | undefined;
let queue = Promise.resolve();

self.onmessage = (event: MessageEvent) => {
  queue = queue
    .then(async () => {
      const message = event.data;
      if (message.type === 'load') {
        machine = parseMachine(message.text);
        intervention = message.intervention;
        simulation?.dispose();
        simulation = await Simulation.create(
          machine,
          message.a,
          message.b,
          undefined,
          intervention,
        );
        operationSteps = 0;
        phase = 'ready';
        self.postMessage({
          type: 'ready',
          snapshot: simulation.snapshot(),
          machine,
        });
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
        self.postMessage({
          type: 'frame',
          snapshot: simulation.snapshot(),
          phase,
        });
      } else if (message.type === 'reset' && simulation) {
        phase = 'reset';
        operationSteps = 0;
        self.postMessage({
          type: 'frame',
          snapshot: simulation.snapshot(),
          phase,
        });
      } else if (message.type === 'evaluate') {
        if (!machine) throw new Error('Load a machine first');
        const suite = await evaluateSuite(machine, {
          intervention,
          onTrial: (trial, index) =>
            self.postMessage({ type: 'progress', trial, index }),
        });
        self.postMessage({ type: 'evaluated', suite });
      }
    })
    .catch((error) =>
      self.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
};
