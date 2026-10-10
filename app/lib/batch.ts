// Runs a long job (evaluate all 16, or the stress profile) in its own worker so
// the interactive world keeps running. Cancelling terminates that worker.
import type { Intervention } from '../../simulator/world';
import type { WorkerRequest, WorkerResponse } from '../../viewer/messages';
// Vite generates this constructor; it is not an export in the worker source.
// oxlint-disable-next-line import/default
import PhysicsWorker from '../../viewer/simulation.worker?worker';

export class Cancelled extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'Cancelled';
  }
}

export type BatchJob<T> = { promise: Promise<T>; cancel: () => void };

type Final = 'evaluated' | 'stressed';

export function runBatch<K extends Final>(options: {
  text: string;
  intervention?: Intervention;
  request: Extract<WorkerRequest, { type: 'evaluate' | 'stress' }>;
  final: K;
  onMessage?: (message: WorkerResponse) => void;
}): BatchJob<Extract<WorkerResponse, { type: K }>> {
  const worker = new PhysicsWorker();
  let settle: {
    resolve: (value: Extract<WorkerResponse, { type: K }>) => void;
    reject: (error: Error) => void;
  };
  let done = false;
  const promise = new Promise<Extract<WorkerResponse, { type: K }>>(
    (resolve, reject) => (settle = { resolve, reject }),
  );
  const finish = (
    error?: Error,
    value?: Extract<WorkerResponse, { type: K }>,
  ) => {
    if (done) return;
    done = true;
    worker.terminate();
    if (error) settle.reject(error);
    else settle.resolve(value!);
  };
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    if (message.type === 'prepared') worker.postMessage(options.request);
    else if (message.type === 'error') finish(new Error(message.message));
    else if (message.type === options.final)
      finish(undefined, message as Extract<WorkerResponse, { type: K }>);
    else options.onMessage?.(message);
  };
  worker.onerror = (event) => {
    event.preventDefault();
    finish(new Error(event.message || 'The physics worker failed'));
  };
  worker.postMessage({
    type: 'prepare',
    text: options.text,
    intervention: options.intervention,
  } satisfies WorkerRequest);
  return { promise, cancel: () => finish(new Cancelled()) };
}
