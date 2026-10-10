// Message protocol between the workbench page and viewer/simulation.worker.ts.
// Types plus one trimming helper: nothing here runs physics or knows the
// arithmetic task.
import type { Conditions } from '../simulator/protocol';
import type { Machine } from '../simulator/schema';
import type { Intervention, Snapshot } from '../simulator/world';
import type { Suite, Trial } from '../evaluator/evaluate';

/** Worker-side operation phase for the interactive world. */
export type Phase = 'ready' | 'run' | 'reset' | 'finished';

export type WorkerRequest =
  | {
      type: 'load';
      text: string;
      a: number;
      b: number;
      intervention?: Intervention;
    }
  /** Parse a machine for evaluate/stress without building a live world. */
  | { type: 'prepare'; text: string; intervention?: Intervention }
  | { type: 'advance'; steps: number }
  | { type: 'reset' }
  | { type: 'evaluate' }
  /** Development-profile robustness run (mirrors `npm run evaluate --
   * --profile development --seeds 17,29`). */
  | { type: 'stress'; seeds?: number[] };

/** A trial without its trace or final snapshot, to keep messages small. */
export type LeanTrial = Pick<
  Trial,
  'a' | 'b' | 'expected' | 'observed' | 'passed' | 'reason'
>;

export type StressSuite = {
  label: string;
  seed: number;
  mode: Suite['mode'];
  conditions: Conditions;
  successes: number;
  total: number;
  resetFailures: number;
  trials: LeanTrial[];
};

export type StressSummary = {
  profile: 'development';
  seeds: number[];
  intervention: Intervention | null;
  suites: StressSuite[];
  accepted: boolean;
  wallSeconds: number;
};

export type WorkerResponse =
  | {
      type: 'ready';
      snapshot: Snapshot;
      machine: Machine;
      /** Seconds since the current operation began (always 0 here). */
      operationTime?: number;
    }
  | {
      type: 'frame';
      snapshot: Snapshot;
      phase: Phase;
      /** Seconds since the current drive/settle operation began. */
      operationTime?: number;
    }
  | { type: 'prepared'; machine: Machine }
  | { type: 'progress'; trial: Trial; index: number }
  | { type: 'evaluated'; suite: Suite }
  | {
      type: 'stress-suite-start';
      label: string;
      seed: number;
      mode: Suite['mode'];
      conditions: Conditions;
      suiteIndex: number;
      suiteCount: number;
    }
  | {
      type: 'stress-progress';
      label: string;
      mode: Suite['mode'];
      suiteIndex: number;
      suiteCount: number;
      index: number;
      trial: LeanTrial;
    }
  | { type: 'stress-suite'; suite: StressSuite; suiteIndex: number }
  | { type: 'stressed'; summary: StressSummary }
  | { type: 'error'; message: string };

export const leanTrial = ({
  a,
  b,
  expected,
  observed,
  passed,
  reason,
}: Trial): LeanTrial => ({ a, b, expected, observed, passed, reason });
