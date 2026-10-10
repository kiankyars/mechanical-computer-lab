import { useState } from 'react';
import { Download, FlaskConical, Square } from 'lucide-react';
import type { Suite, Trial } from '../../evaluator/evaluate';
import type { Machine } from '../../simulator/schema';
import {
  KIND_TEXT,
  reasonText,
  trialKind,
  type TrialKind,
} from '../lib/format';

export type EvaluationState = {
  status: 'idle' | 'running' | 'done' | 'error' | 'cancelled';
  /** Indexed by a * 4 + b. */
  cells: (Trial | null)[];
  count: number;
  suite: Suite | null;
  message: string;
};

export const emptyEvaluation = (): EvaluationState => ({
  status: 'idle',
  cells: Array.from({ length: 16 }, () => null),
  count: 0,
  suite: null,
  message: '',
});

export type InterventionKind = 'none' | 'remove' | 'lock';

type Props = {
  state: EvaluationState;
  busy: boolean;
  canEvaluate: boolean;
  onEvaluate: () => void;
  onCancel: () => void;
  onSaveReport: () => void;
  inputs: [number, number];
  /** Load a case into the live world and run it on the stage. */
  onWatch: (inputs: [number, number]) => void;
  machine: Machine | null;
  /** e.g. "connecting-rod locked", or '' when the machine is intact. */
  interventionText: string;
  /** The intact machine's score (same text), for the causal comparison. */
  intact: { successes: number; total: number } | null;
  /** The intact baseline is being measured after an intervention run. */
  measuringIntact: boolean;
  interventionKind: InterventionKind;
  interventionBody: string;
  onInterventionKind: (kind: InterventionKind) => void;
  onInterventionBody: (body: string) => void;
};

const GLYPH: Record<TrialKind, string> = {
  pass: '✓',
  wrong: '✗',
  unstable: '≈',
  error: '⚠',
};

/** 16 segments on a 240° arc; lit segments are passes. */
export function ScoreDial({
  score,
  total = 16,
  running,
  caption,
}: {
  score: number | null;
  total?: number;
  running?: number;
  caption: string;
}) {
  const r = 46;
  const cx = 60;
  const cy = 60;
  const sweep = 240;
  const gap = 3.2;
  const seg = (sweep - gap * (total - 1)) / total;
  const polar = (deg: number, radius: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
  };
  const arcs = Array.from({ length: total }, (_, i) => {
    const a0 = -sweep / 2 + i * (seg + gap);
    const a1 = a0 + seg;
    const [x0, y0] = polar(a0, r);
    const [x1, y1] = polar(a1, r);
    return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 0 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
  });
  return (
    <div className="dial">
      <span className="sr-only">
        {score === null
          ? 'Not evaluated'
          : `${score} of ${total} cases correct and stable`}
      </span>
      <svg viewBox="0 0 120 104" aria-hidden="true">
        {arcs.map((d, i) => (
          <path
            key={i}
            d={d}
            className="dial-seg"
            data-lit={score !== null && i < score ? true : undefined}
            data-pending={
              running !== undefined && i >= (score ?? 0) && i < running
                ? true
                : undefined
            }
          />
        ))}
        <text x={cx} y={cy + 4} textAnchor="middle" className="dial-score">
          {score === null ? '—' : score}
        </text>
        <text x={cx} y={cy + 22} textAnchor="middle" className="dial-total">
          / {total}
        </text>
      </svg>
      <span className="dial-caption">{caption}</span>
    </div>
  );
}

function cellDetail(
  a: number,
  b: number,
  trial: Trial | null,
  running: boolean,
) {
  if (!trial)
    return `A ${a} + B ${b}: ${running ? 'running' : 'not evaluated yet'}.`;
  const kind = trialKind(trial);
  return `A ${a} + B ${b}: ${KIND_TEXT[kind]}. ${
    kind === 'pass' || kind === 'wrong'
      ? `Measured ${trial.observed}, expected ${trial.expected}. `
      : `Expected ${trial.expected}. `
  }${reasonText(trial.reason)}.`;
}

function Cell({
  a,
  b,
  trial,
  running,
  live,
  onPick,
  onFocus,
  onBlur,
}: {
  a: number;
  b: number;
  trial: Trial | null;
  running: boolean;
  live: boolean;
  onPick: () => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const kind = trial ? trialKind(trial) : null;
  const detail = cellDetail(a, b, trial, running);
  return (
    <button
      type="button"
      className="cell"
      data-kind={kind ?? (running ? 'running' : 'empty')}
      data-live={live || undefined}
      onClick={onPick}
      onMouseEnter={onFocus}
      onMouseLeave={onBlur}
      onFocus={onFocus}
      onBlur={onBlur}
      aria-label={`${detail} Watch this case on the stage.`}
      title={trial ? reasonText(trial.reason) : undefined}
    >
      {trial ? (
        <>
          <span className="cell-glyph" aria-hidden="true">
            {GLYPH[kind!]}
          </span>
          <span className="cell-value" aria-hidden="true">
            {kind === 'pass' || kind === 'wrong'
              ? trial.observed
              : kind === 'unstable'
                ? '?'
                : '!'}
          </span>
          <span className="cell-note" aria-hidden="true">
            {kind === 'pass'
              ? 'correct'
              : kind === 'wrong'
                ? `exp ${trial.expected}`
                : kind === 'unstable'
                  ? 'unsettled'
                  : 'error'}
          </span>
        </>
      ) : (
        <span className="cell-coord" aria-hidden="true">
          {a}+{b}
        </span>
      )}
    </button>
  );
}

/** Causal check result: the intact score against the modified machine's. */
function Comparison({
  what,
  score,
  intact,
  measuring,
}: {
  what: string;
  score: number | null;
  intact: { successes: number; total: number } | null;
  measuring: boolean;
}) {
  const drop = score !== null && intact ? intact.successes - score : null;
  const [part, ...rest] = what.split(' ');
  const done = rest.join(' ');
  return (
    <div
      className="compare"
      data-drop={drop === null ? undefined : drop > 0 ? 'yes' : 'no'}
    >
      <p className="compare-what">
        <span aria-hidden="true">⊘</span> Causal check ·{' '}
        <span className="mono">{part}</span> {done}
      </p>
      <p className="compare-scores mono">
        <span>
          <span className="compare-key">Intact</span>{' '}
          {intact
            ? `${intact.successes}/${intact.total}`
            : measuring
              ? '…'
              : '—'}
        </span>
        <span className="compare-arrow" aria-hidden="true">
          →
        </span>
        <span>
          <span className="compare-key">{done || 'modified'}</span>{' '}
          {score === null ? '—' : `${score}/16`}
        </span>
      </p>
      <p className="compare-note">
        {drop === null
          ? score === null
            ? 'Evaluate to compare with the intact machine.'
            : measuring
              ? 'Measuring the intact baseline…'
              : 'No intact baseline for this machine yet.'
          : drop > 0
            ? `Score drops by ${drop}: ${part} is doing work.`
            : drop < 0
              ? `Score rises by ${-drop} without ${part}.`
              : `No drop: this check shows no work done by ${part}.`}
      </p>
    </div>
  );
}

/** The verdict card beside the grid: the hovered cell, else the live inputs. */
function CaseReadout({
  a,
  b,
  trial,
  running,
  live,
}: {
  a: number;
  b: number;
  trial: Trial | null;
  running: boolean;
  live: boolean;
}) {
  const kind = trial ? trialKind(trial) : null;
  const measured = !trial
    ? '—'
    : kind === 'pass' || kind === 'wrong'
      ? String(trial.observed)
      : kind === 'unstable'
        ? '?'
        : '—';
  return (
    <div
      className="readout"
      data-kind={kind ?? (running ? 'running' : 'empty')}
      aria-hidden="true"
    >
      <div className="readout-head">
        <span className="micro">{live ? 'Live inputs' : 'Case'}</span>
        <span className="readout-verdict">
          {kind ? (
            <>
              <span className="readout-glyph">{GLYPH[kind]}</span>
              {KIND_TEXT[kind]}
            </>
          ) : running ? (
            'Running…'
          ) : (
            'Not evaluated'
          )}
        </span>
      </div>
      <div className="readout-sum">
        <span className="readout-in">{a}</span>
        <span className="readout-op">+</span>
        <span className="readout-in">{b}</span>
        <span className="readout-op">→</span>
        <span className="readout-out">{measured}</span>
      </div>
      <dl className="readout-kv">
        <div>
          <dt>Measured</dt>
          <dd>{measured}</dd>
        </div>
        <div>
          <dt>Expected</dt>
          <dd>{trial ? trial.expected : '—'}</dd>
        </div>
      </dl>
      <p className="readout-reason">
        {trial
          ? reasonText(trial.reason)
          : running
            ? 'The evaluator is operating this case in a fresh world now.'
            : 'The expected value stays hidden until the evaluator scores this case.'}
      </p>
    </div>
  );
}

export function Evaluation(props: Props) {
  const { state } = props;
  const [focus, setFocus] = useState<number | null>(null);
  const running = state.status === 'running';
  const shown: [number, number] =
    focus === null ? props.inputs : [Math.floor(focus / 4), focus % 4];
  const score = state.suite
    ? state.suite.successes
    : running || state.count
      ? state.cells.filter((t) => t?.passed).length
      : null;

  return (
    <div className="eval">
      <div className="eval-summary">
        <ScoreDial
          score={score}
          running={running ? state.count + 1 : undefined}
          caption={
            state.status === 'running'
              ? `testing ${Math.min(16, state.count + 1)} of 16…`
              : state.status === 'done'
                ? props.interventionText
                  ? 'correct · modified machine'
                  : 'correct and stable'
                : state.status === 'cancelled'
                  ? 'cancelled'
                  : state.status === 'error'
                    ? 'evaluation failed'
                    : 'not evaluated'
          }
        />
        {props.interventionText && (
          <Comparison
            what={props.interventionText}
            score={state.suite?.successes ?? null}
            intact={props.intact}
            measuring={props.measuringIntact}
          />
        )}
        <div className="eval-actions">
          {running ? (
            <button type="button" className="btn" onClick={props.onCancel}>
              <Square size={14} aria-hidden="true" />
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!props.canEvaluate || props.busy}
              onClick={props.onEvaluate}
              aria-keyshortcuts="E"
            >
              <FlaskConical size={16} aria-hidden="true" />
              Evaluate all 16
              <kbd className="kbd">E</kbd>
            </button>
          )}
          <button
            type="button"
            className="btn btn-quiet"
            disabled={!state.suite}
            onClick={props.onSaveReport}
          >
            <Download size={14} aria-hidden="true" />
            Save report
          </button>
        </div>
        <p className="fine">
          Browser evaluation runs nominal conditions in a fresh world for each
          case, with the same loaded machine for all 16. It never shows an
          expected value until the evaluator has scored that case.
        </p>
        {state.status === 'error' && (
          <p className="fine fine-alert" role="alert">
            {state.message}
          </p>
        )}
      </div>

      <div className="truth">
        <table className="truth-grid">
          <caption className="sr-only">
            Truth table: rows are A, columns are B. Each cell shows the
            evaluator’s verdict for that input pair.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="truth-corner">
                <span>A↓</span>
                <span>B→</span>
              </th>
              {[0, 1, 2, 3].map((b) => (
                <th key={b} scope="col" className="truth-head">
                  <span className="sr-only">B = </span>
                  {b}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[0, 1, 2, 3].map((a) => (
              <tr key={a}>
                <th scope="row" className="truth-head">
                  <span className="sr-only">A = </span>
                  {a}
                </th>
                {[0, 1, 2, 3].map((b) => (
                  <td key={b}>
                    <Cell
                      a={a}
                      b={b}
                      trial={state.cells[a * 4 + b]}
                      running={running && state.count === a * 4 + b}
                      live={props.inputs[0] === a && props.inputs[1] === b}
                      onPick={() => props.onWatch([a, b])}
                      onFocus={() => setFocus(a * 4 + b)}
                      onBlur={() => setFocus(null)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="truth-side">
          <CaseReadout
            a={shown[0]}
            b={shown[1]}
            trial={state.cells[shown[0] * 4 + shown[1]]}
            running={running && state.count === shown[0] * 4 + shown[1]}
            live={focus === null}
          />
          <ul className="legend" aria-label="Legend">
            <li data-kind="pass">
              <span aria-hidden="true">✓</span> correct and stable
            </li>
            <li data-kind="wrong">
              <span aria-hidden="true">✗</span> wrong answer
            </li>
            <li data-kind="unstable">
              <span aria-hidden="true">≈</span> unsettled / ambiguous
            </li>
            <li data-kind="error">
              <span aria-hidden="true">⚠</span> physics or setup error
            </li>
            <li data-kind="live">
              <span aria-hidden="true">▢</span> live inputs
            </li>
          </ul>
          <p className="fine">
            Hover or focus a cell for its verdict; click it to watch that case
            run on the stage.
          </p>
        </div>
      </div>

      <div className="causal">
        <h3 className="micro">Causal check</h3>
        <p className="fine">
          Remove or lock one component, then evaluate again. If the score drops,
          that part is doing work. Applies to the live world, the evaluation and
          the stress test.
        </p>
        <fieldset className="seg" aria-label="Intervention">
          {(
            [
              ['none', 'Intact'],
              ['remove', 'Remove'],
              ['lock', 'Lock'],
            ] as const
          ).map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              aria-pressed={props.interventionKind === kind}
              onClick={() => props.onInterventionKind(kind)}
            >
              {label}
            </button>
          ))}
        </fieldset>
        {props.interventionKind !== 'none' && (
          <label className="field">
            <span className="micro">Component</span>
            <select
              className="select"
              value={props.interventionBody}
              onChange={(event) => props.onInterventionBody(event.target.value)}
            >
              <option value="">Choose a component…</option>
              {(props.machine?.bodies ?? []).map((body) => (
                <option key={body.id} value={body.id}>
                  {body.id}
                  {body.label ? ` — ${body.label}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="fine">
          {props.interventionKind === 'none'
            ? 'Machine is intact.'
            : props.interventionBody
              ? `${props.interventionKind === 'remove' ? 'Removed' : 'Locked'}: ${props.interventionBody}. The stage shows it ${props.interventionKind === 'remove' ? 'as a red dashed ghost labelled REMOVED' : 'in hatched gunmetal, like a fixed part'}.`
              : props.machine?.bodies.length
                ? 'No intervention is applied until a component is chosen.'
                : 'This machine has no candidate components to intervene on.'}
        </p>
      </div>
    </div>
  );
}
