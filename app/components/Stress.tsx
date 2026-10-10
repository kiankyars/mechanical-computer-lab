import { Download, Play, Square } from 'lucide-react';
import { conditionsForSeed } from '../../evaluator/conditions';
import { NOMINAL, type Conditions } from '../../simulator/protocol';
import type {
  LeanTrial,
  StressSuite,
  StressSummary,
} from '../../viewer/messages';
import {
  KIND_TEXT,
  reasonText,
  trialKind,
  type TrialKind,
} from '../lib/format';

export const STRESS_SEEDS = [17, 29];
const MODES = ['fresh', 'persistent'] as const;

export const STRESS_ROWS: {
  label: string;
  title: string;
  conditions: Conditions;
}[] = [
  { label: 'nominal', title: 'Nominal', conditions: { ...NOMINAL } },
  ...STRESS_SEEDS.map((seed) => ({
    label: `perturbed-${seed}`,
    title: `Perturbed · seed ${seed}`,
    conditions: conditionsForSeed(seed),
  })),
  {
    label: 'half-timestep',
    title: 'Half timestep',
    conditions: { ...NOMINAL, dtScale: 0.5 },
  },
];
export const STRESS_SUITES = STRESS_ROWS.length * MODES.length;

export type StressCell = Omit<StressSuite, 'successes' | 'resetFailures'> & {
  successes: number | null;
  resetFailures: number | null;
};

export type StressState = {
  status: 'idle' | 'running' | 'done' | 'error' | 'cancelled';
  cells: (StressCell | null)[];
  current: { suiteIndex: number; index: number } | null;
  summary: StressSummary | null;
  done: number;
  message: string;
};

export const emptyStress = (): StressState => ({
  status: 'idle',
  cells: Array.from({ length: STRESS_SUITES }, () => null),
  current: null,
  summary: null,
  done: 0,
  message: '',
});

type Props = {
  state: StressState;
  busy: boolean;
  canRun: boolean;
  onRun: () => void;
  onCancel: () => void;
  onSave: () => void;
  interventionText: string;
};

const pct = (x: number) =>
  `${x >= 1 ? '+' : '−'}${Math.abs((x - 1) * 100).toFixed(1)}%`;

function conditionText(c: Conditions) {
  if (c.dtScale !== 1) return `timestep × ${c.dtScale} (1/480 s)`;
  if (
    c.speedScale === 1 &&
    c.torqueScale === 1 &&
    c.frictionScale === 1 &&
    c.inputOffset === 0
  )
    return 'protocol values';
  return `speed ${pct(c.speedScale)} · torque ${pct(c.torqueScale)} · friction ${pct(c.frictionScale)} · input ${c.inputOffset >= 0 ? '+' : '−'}${Math.abs(c.inputOffset).toFixed(3)}`;
}

function Dot({ trial, x, y }: { trial?: LeanTrial; x: number; y: number }) {
  if (!trial) return <circle cx={x} cy={y} r={1.6} className="sd sd-empty" />;
  const kind: TrialKind = trialKind(trial);
  if (kind === 'pass')
    return <circle cx={x} cy={y} r={2.6} className="sd sd-pass" />;
  if (kind === 'wrong')
    return (
      <path
        d={`M${x - 2.2},${y - 2.2}L${x + 2.2},${y + 2.2}M${x + 2.2},${y - 2.2}L${x - 2.2},${y + 2.2}`}
        className="sd sd-wrong"
      />
    );
  if (kind === 'unstable')
    return <circle cx={x} cy={y} r={2.2} className="sd sd-unstable" />;
  return (
    <path
      d={`M${x},${y - 2.8}L${x + 2.6},${y + 2}L${x - 2.6},${y + 2}Z`}
      className="sd sd-error"
    />
  );
}

function Dots({ trials }: { trials: LeanTrial[] }) {
  const byCase = new Map(trials.map((t) => [t.a * 4 + t.b, t]));
  const summary = trials
    .filter((t) => !t.passed)
    .slice(0, 6)
    .map((t) => `${t.a}+${t.b}: ${KIND_TEXT[trialKind(t)].toLowerCase()}`)
    .join('; ');
  return (
    <span className="stress-dots-wrap">
      <span className="sr-only">
        {trials.length
          ? `${trials.filter((t) => t.passed).length} of ${trials.length} passed${summary ? `. Failures: ${summary}` : ''}`
          : 'Not run'}
      </span>
      <svg viewBox="0 0 34 34" className="stress-dots" aria-hidden="true">
        <title>
          {trials
            .slice()
            .sort((p, q) => p.a * 4 + p.b - (q.a * 4 + q.b))
            .map((t) => `${t.a}+${t.b}: ${reasonText(t.reason)}`)
            .join('\n') || 'Not run'}
        </title>
        {Array.from({ length: 16 }, (_, n) => (
          <Dot
            key={n}
            trial={byCase.get(n)}
            x={5 + (n % 4) * 8}
            y={5 + Math.floor(n / 4) * 8}
          />
        ))}
      </svg>
    </span>
  );
}

export function Stress(props: Props) {
  const { state } = props;
  const running = state.status === 'running';
  const total = STRESS_SUITES * 16;
  const current =
    state.current && state.cells[state.current.suiteIndex]
      ? state.cells[state.current.suiteIndex]
      : null;

  return (
    <div className="stress">
      <div className="stress-head">
        <div
          className="stress-verdict"
          data-accepted={
            state.summary ? String(state.summary.accepted) : undefined
          }
        >
          <span className="micro">Accepted</span>
          <strong>
            {state.summary ? (state.summary.accepted ? '✓ Yes' : '✗ No') : '—'}
          </strong>
          <span className="fine">
            {state.summary
              ? `${state.summary.suites.filter((s) => s.successes === s.total && s.resetFailures === 0).length} of ${state.summary.suites.length} suites perfect · ${state.summary.wallSeconds.toFixed(1)} s`
              : 'requires every suite 16/16 and zero reset failures'}
          </span>
        </div>
        <div className="stress-controls">
          {running ? (
            <button type="button" className="btn" onClick={props.onCancel}>
              <Square size={14} aria-hidden="true" />
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!props.canRun || props.busy}
              onClick={props.onRun}
            >
              <Play size={16} aria-hidden="true" />
              Run stress test
            </button>
          )}
          <button
            type="button"
            className="btn btn-quiet"
            disabled={!state.summary}
            onClick={props.onSave}
          >
            <Download size={14} aria-hidden="true" />
            Save report
          </button>
        </div>
        {/* Visual progress only: App announces the start and the result, so
            screen readers are not flooded with one update per trial. */}
        <div className="stress-progress">
          <div className="meter" aria-hidden="true">
            <span style={{ width: `${(state.done / total) * 100}%` }} />
          </div>
          <span className="fine mono">
            {running && current && state.current
              ? `${current.label} · ${current.mode} · case ${Math.min(16, state.current.index + 2)}/16 · ${state.done}/${total}`
              : state.status === 'cancelled'
                ? `cancelled after ${state.done}/${total} trials`
                : state.status === 'error'
                  ? state.message
                  : state.status === 'done'
                    ? `${total} trials in ${STRESS_SUITES} suites`
                    : `${STRESS_SUITES} suites × 16 cases = ${total} trials`}
          </span>
        </div>
      </div>

      <div className="table-scroll">
        <table className="stress-table">
          <caption className="sr-only">
            Robustness matrix: score out of 16 for each configuration in fresh
            and persistent worlds.
          </caption>
          <thead>
            <tr>
              <th scope="col">Configuration</th>
              <th scope="col">Fresh worlds</th>
              <th scope="col">Persistent world</th>
            </tr>
          </thead>
          <tbody>
            {STRESS_ROWS.map((row, r) => (
              <tr key={row.label}>
                <th scope="row" className="st-config">
                  <strong>{row.title}</strong>
                  <span className="fine mono">
                    {conditionText(row.conditions)}
                  </span>
                </th>
                {MODES.map((mode, m) => {
                  const cell = state.cells[r * 2 + m];
                  const active =
                    running && state.current?.suiteIndex === r * 2 + m;
                  const complete = cell?.successes != null;
                  const trials = cell?.trials ?? [];
                  const passed = complete
                    ? cell.successes!
                    : trials.filter((t) => t.passed).length;
                  const perfect =
                    complete &&
                    cell.successes === 16 &&
                    (mode === 'fresh' || cell.resetFailures === 0);
                  const status = !cell
                    ? 'pending'
                    : complete
                      ? perfect
                        ? 'pass'
                        : 'fail'
                      : active
                        ? 'running'
                        : 'partial';
                  return (
                    <td
                      key={mode}
                      data-mode={mode === 'fresh' ? 'Fresh' : 'Persistent'}
                      className="st-cell"
                      data-active={active || undefined}
                      data-state={status}
                    >
                      <div className="st-cell-inner">
                        <Dots trials={trials} />
                        <span className="st-score">
                          {status === 'pending' ? (
                            <>
                              <strong className="mono">—</strong>
                              <span className="mono dim">/16</span>
                            </>
                          ) : status === 'running' && !trials.length ? (
                            <strong className="mono">…</strong>
                          ) : complete ? (
                            <>
                              <strong className="mono">{passed}</strong>
                              <span className="mono dim">/16</span>
                            </>
                          ) : (
                            // Unfinished: passed out of the cases run so far,
                            // never formatted like a final score.
                            <>
                              <strong className="mono">{passed}</strong>
                              <span className="mono dim">
                                /{trials.length} run
                              </span>
                            </>
                          )}
                          {status === 'running' && (
                            <span className="st-tag" data-kind="running">
                              running
                            </span>
                          )}
                          {status === 'partial' && (
                            <span className="st-tag">
                              {state.status === 'cancelled'
                                ? 'cancelled'
                                : 'partial'}
                            </span>
                          )}
                        </span>
                        <span className="st-reset fine mono">
                          {!complete && cell
                            ? `${trials.length} of 16 cases`
                            : mode === 'fresh'
                              ? 'new world per case'
                              : cell?.resetFailures == null
                                ? 'reset between cases'
                                : cell.resetFailures === 0
                                  ? '✓ 0 reset failures'
                                  : `✗ ${cell.resetFailures} reset failure${cell.resetFailures === 1 ? '' : 's'}`}
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="fine">
        In-browser development profile, mirroring{' '}
        <code>npm run evaluate -- --profile development --seeds 17,29</code>:
        seeded perturbations of drive speed, torque, friction and input
        position, plus a half-timestep numerical audit. Persistent mode keeps
        one world for all 16 cases with a reverse-crank reset between them.
        {props.interventionText &&
          ` Intervention: ${props.interventionText}.`}{' '}
        Seeds 17 and 29 are public; final scoring uses the trusted CLI evaluator
        with private seeds.
      </p>
    </div>
  );
}
