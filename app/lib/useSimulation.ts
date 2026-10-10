// The interactive world: one worker holding a Rapier simulation that the page
// advances in small batches. Every frame is recorded; replaying a recorded
// frame only moves the view and never writes back into physics.
import { useCallback, useEffect, useRef, useState } from 'react';
import { SETTINGS } from '../../simulator/protocol';
import type { Machine } from '../../simulator/schema';
import type { Intervention, Snapshot } from '../../simulator/world';
import type {
  Phase,
  WorkerRequest,
  WorkerResponse,
} from '../../viewer/messages';
import type { LabStatus } from './format';
// Vite generates this constructor; it is not an export in the worker source.
// oxlint-disable-next-line import/default
import PhysicsWorker from '../../viewer/simulation.worker?worker';

export type Frame = {
  snapshot: Snapshot;
  phase: Phase;
  /** Seconds since this frame's operation began. */
  t: number;
  /** Index into the operations list. */
  op: number;
};
export type Operation = { kind: 'forward' | 'reverse'; start: number };

export const SPEEDS = [
  { value: 0.125, label: '⅛×' },
  { value: 0.25, label: '¼×' },
  { value: 0.5, label: '½×' },
  { value: 1, label: '1×' },
  { value: 2, label: '2×' },
] as const;

/** The worker accepts at most this many physics steps per advance. */
const MAX_STEPS = 16;
const STEPS_PER_SECOND = 1 / SETTINGS.dt;

type Options = {
  text: string | null;
  inputs: [number, number];
  /** Must be referentially stable between renders (memoise it). */
  intervention?: Intervention;
  reloadKey: number;
  /** A load failed before the world was ever ready. */
  onLoadError: (message: string) => void;
  /** A running world failed (physics error) or the worker crashed. */
  onRuntimeError: (message: string) => void;
  onReady?: (machine: Machine) => void;
};

export function useSimulation(options: Options) {
  const { text, inputs, intervention, reloadKey } = options;
  const [status, setStatus] = useState<LabStatus>('booting');
  const [machine, setMachine] = useState<Machine | null>(null);
  const [live, setLive] = useState<Frame | null>(null);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [version, setVersion] = useState(0);
  const worker = useRef<Worker | null>(null);
  const pending = useRef(false);
  /** A Step pressed while a batch was in flight: sent when it returns. */
  const pendingStep = useRef(false);
  /** The machine text whose world was last requested. */
  const requested = useRef<string | null>(null);
  const frames = useRef<Frame[]>([]);
  const ops = useRef<Operation[]>([]);
  const callbacks = useRef(options);
  callbacks.current = options;

  const [a, b] = inputs;

  useEffect(() => {
    if (text === null) return;
    setStatus('loading');
    setRunning(false);
    setLive(null);
    // A different machine: forget the previous world so nothing keeps
    // drawing or describing it while this one is built (or fails to be).
    if (text !== requested.current) setMachine(null);
    requested.current = text;
    pendingStep.current = false;
    frames.current = [];
    ops.current = [];
    setVersion((v) => v + 1);
    pending.current = false;
    const current = new PhysicsWorker();
    worker.current = current;
    let loaded = false;
    const fail = (message: string) => {
      pending.current = false;
      setRunning(false);
      setStatus('failed');
      if (loaded) callbacks.current.onRuntimeError(message);
      else callbacks.current.onLoadError(message);
    };
    const record = (frame: Frame) => {
      frames.current.push(frame);
      setLive(frame);
      setVersion((v) => v + 1);
    };
    current.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const data = event.data;
      if (data.type === 'ready') {
        loaded = true;
        pending.current = false;
        ops.current = [{ kind: 'forward', start: data.snapshot.time }];
        frames.current = [];
        setMachine(data.machine);
        setStatus('ready');
        callbacks.current.onReady?.(data.machine);
        record({ snapshot: data.snapshot, phase: 'ready', t: 0, op: 0 });
      } else if (data.type === 'frame') {
        pending.current = false;
        const t = data.operationTime ?? 0;
        const list = ops.current;
        if (data.phase === 'reset' && t === 0) {
          // A reverse-crank operation starts here. Replace an operation that
          // never advanced instead of leaving an empty band behind.
          const last = frames.current.at(-1);
          const idle = !last || last.t === 0;
          if (idle && list.length)
            list[list.length - 1] = {
              kind: 'reverse',
              start: data.snapshot.time,
            };
          else list.push({ kind: 'reverse', start: data.snapshot.time });
        }
        record({
          snapshot: data.snapshot,
          phase: data.phase,
          t,
          op: Math.max(0, list.length - 1),
        });
        if (data.phase === 'finished') {
          setRunning(false);
          pendingStep.current = false;
        } else if (pendingStep.current) {
          // Step was pressed while this batch was in flight.
          pendingStep.current = false;
          pending.current = true;
          current.postMessage({
            type: 'advance',
            steps: 1,
          } satisfies WorkerRequest);
        }
      } else if (data.type === 'error') fail(data.message);
    };
    current.onerror = (event) => {
      event.preventDefault();
      fail(event.message || 'The physics worker failed to start');
    };
    current.postMessage({
      type: 'load',
      text,
      a,
      b,
      intervention,
    } satisfies WorkerRequest);
    return () => {
      current.terminate();
      if (worker.current === current) worker.current = null;
    };
    // `intervention` must be referentially stable (memoised by the caller).
  }, [text, a, b, intervention, reloadKey]);

  // Real-time pacing: accumulate a step budget per animation frame and send
  // at most one batch at a time.
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = performance.now();
    let budget = 0;
    const tick = (now: number) => {
      const elapsed = Math.min(0.1, (now - last) / 1000);
      last = now;
      budget = Math.min(MAX_STEPS, budget + elapsed * speed * STEPS_PER_SECOND);
      if (!pending.current && worker.current && budget >= 1) {
        const steps = Math.min(MAX_STEPS, Math.floor(budget));
        budget -= steps;
        pending.current = true;
        worker.current.postMessage({
          type: 'advance',
          steps,
        } satisfies WorkerRequest);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, speed]);

  const phase = live?.phase ?? 'ready';
  const canRun = status === 'ready' && phase !== 'finished';

  const toggle = useCallback(() => {
    if (!canRun) return;
    setRunning((value) => !value);
  }, [canRun]);

  const play = useCallback(() => {
    if (canRun) setRunning(true);
  }, [canRun]);

  const step = useCallback(() => {
    if (!canRun || !worker.current) return;
    // Pause first, whatever is in flight: a Step always stops the crank.
    setRunning(false);
    if (pending.current) {
      pendingStep.current = true;
      return;
    }
    pending.current = true;
    worker.current.postMessage({
      type: 'advance',
      steps: 1,
    } satisfies WorkerRequest);
  }, [canRun]);

  const reverseReset = useCallback(() => {
    if (status !== 'ready' || !worker.current) return;
    worker.current.postMessage({ type: 'reset' } satisfies WorkerRequest);
    setRunning(true);
  }, [status]);

  return {
    status,
    machine,
    live,
    phase,
    running,
    speed,
    setSpeed,
    frames,
    ops,
    version,
    canRun,
    toggle,
    play,
    pause: useCallback(() => setRunning(false), []),
    step,
    reverseReset,
  };
}

export type Simulation = ReturnType<typeof useSimulation>;
