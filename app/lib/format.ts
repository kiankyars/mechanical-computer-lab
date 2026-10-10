import { SETTINGS } from '../../simulator/protocol';
import type { Readout } from '../../simulator/readout';
import type { Phase } from '../../viewer/messages';

export const DRIVE_S = SETTINGS.driveSeconds;
export const TOTAL_S = SETTINGS.driveSeconds + SETTINGS.settleSeconds;
export const READ_S = TOTAL_S - SETTINGS.readSeconds;

export type LabStatus = 'booting' | 'loading' | 'ready' | 'failed';

export type PhaseKey =
  | 'loading'
  | 'ready'
  | 'drive'
  | 'settle'
  | 'read'
  | 'finished'
  | 'reverse'
  | 'failed';

export type PhaseInfo = { key: PhaseKey; label: string; detail: string };

/** The phase chip, derived from the worker phase and the operation clock. */
export function phaseInfo(
  status: LabStatus,
  phase: Phase,
  operationTime: number,
  reverse: boolean,
): PhaseInfo {
  if (status === 'failed')
    return {
      key: 'failed',
      label: 'Failed',
      detail: phase === 'ready' ? 'setup error' : 'physics error',
    };
  if (status !== 'ready')
    return { key: 'loading', label: 'Loading', detail: 'building the world' };
  if (phase === 'ready')
    return { key: 'ready', label: 'Ready', detail: 'crank at rest' };
  if (phase === 'finished')
    return reverse
      ? { key: 'finished', label: 'Reset done', detail: 'reverse cycle ended' }
      : { key: 'finished', label: 'Finished', detail: 'operation complete' };
  if (phase === 'reset')
    return {
      key: 'reverse',
      label: 'Reverse reset',
      detail:
        operationTime < DRIVE_S
          ? `drive −${SETTINGS.crankSpeed} rad/s`
          : 'settling',
    };
  if (operationTime < DRIVE_S)
    return { key: 'drive', label: 'Drive', detail: '0–4 s' };
  if (operationTime < READ_S)
    return { key: 'settle', label: 'Settle', detail: '4–6 s' };
  return { key: 'read', label: 'Read window', detail: '5.5–6 s' };
}

export type GaugeState = 'stable' | 'moving' | 'ambiguous';

export function gaugeState(output: Readout): GaugeState {
  if (output.value === null) return 'ambiguous';
  return output.settled ? 'stable' : 'moving';
}

export type TrialKind = 'pass' | 'wrong' | 'unstable' | 'error';

export function trialKind(trial: {
  passed: boolean;
  reason: string;
}): TrialKind {
  if (trial.passed) return 'pass';
  if (trial.reason === 'wrong-answer') return 'wrong';
  if (
    trial.reason === 'unsettled-or-ambiguous-output' ||
    trial.reason === 'incomplete-read-window'
  )
    return 'unstable';
  return 'error';
}

export const KIND_TEXT: Record<TrialKind, string> = {
  pass: 'Correct and stable',
  wrong: 'Wrong answer',
  unstable: 'Unsettled or ambiguous',
  error: 'Physics or setup error',
};

/** Human-readable failure reason from the evaluator's reason string. */
export function reasonText(reason: string): string {
  if (reason === 'correct') return 'Correct and stable through the read window';
  if (reason === 'wrong-answer')
    return 'Stable, but the decoded value is wrong';
  if (reason === 'unsettled-or-ambiguous-output')
    return 'A gauge was moving or between zones during the read window';
  if (reason === 'incomplete-read-window')
    return 'The read window did not complete';
  return reason
    .replace(/^physics-error: /, 'Physics error: ')
    .replace(/^setup-error: /, 'Setup error: ')
    .replace(/^persistent-error: /, 'Persistent world error: ')
    .replace(/Error: /g, '');
}

export const fixed = (value: number | undefined, digits: number) =>
  value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits);

/** Signed number with a true minus sign and a fixed width. */
export function signed(value: number, digits: number): string {
  if (!Number.isFinite(value)) return '—';
  const text = Math.abs(value).toFixed(digits);
  return `${value < 0 && Number(text) !== 0 ? '−' : '+'}${text}`;
}

/** Wraps an angle to [0°, 360°). */
export function degrees(radians: number): number {
  const d = (radians * 180) / Math.PI;
  return ((d % 360) + 360) % 360;
}

export function bytes(n: number): string {
  if (n < 1000) return `${n} B`;
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)} KB`;
}

export const bitsOf = (value: number): [number, number] => [
  (value >> 1) & 1,
  value & 1,
];
