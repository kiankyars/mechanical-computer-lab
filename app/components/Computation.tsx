import type { Readout } from '../../simulator/readout';
import {
  KIND_TEXT,
  bitsOf,
  gaugeState,
  type GaugeState,
  type TrialKind,
} from '../lib/format';
import type { Frame } from '../lib/useSimulation';
import { SignalTrace } from './SignalTrace';

type Props = {
  inputs: [number, number];
  onInputs: (inputs: [number, number]) => void;
  disabled: boolean;
  frame: Frame | null;
  traceFrames: Frame[];
  replaying: boolean;
  reverse: boolean;
  /** e.g. "connecting-rod locked", or '' when the machine is intact. */
  interventionText: string;
  /** Caveat for presets that are not adders. */
  note?: string;
  /** The displayed frame ends a forward operation: the reading is final. */
  finished: boolean;
  /** The evaluator's verdict for these inputs (fresh world), once scored. */
  verdict: { kind: TrialKind; expected: number } | null;
};

const WORDS = ['A', 'B'] as const;

function BitSwitch({
  word,
  bit,
  on,
  disabled,
  onToggle,
}: {
  word: string;
  bit: number;
  on: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="bit-switch"
      aria-pressed={on}
      aria-label={`${word}${bit} (weight ${2 ** bit})`}
      disabled={disabled}
      onClick={onToggle}
    >
      <span className="bit-name">
        {word}
        <sub>{bit}</sub>
      </span>
      <span className="bit-slot" aria-hidden="true">
        <span className="bit-lever" />
      </span>
      <span className="bit-state" aria-hidden="true">
        {on ? '1' : '0'}
      </span>
    </button>
  );
}

function InputWord({
  word,
  value,
  disabled,
  onChange,
}: {
  word: 'A' | 'B';
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const [high, low] = bitsOf(value);
  return (
    <fieldset className="input-word" aria-label={`Input ${word}`}>
      <div className="word-head">
        <span className="word-letter">{word}</span>
        <span className="word-value" aria-label={`${word} = ${value}`}>
          {value}
        </span>
      </div>
      <div className="word-switches">
        <BitSwitch
          word={word}
          bit={1}
          on={high === 1}
          disabled={disabled}
          onToggle={() => onChange(value ^ 2)}
        />
        <BitSwitch
          word={word}
          bit={0}
          on={low === 1}
          disabled={disabled}
          onToggle={() => onChange(value ^ 1)}
        />
      </div>
      <fieldset className="seg seg-quick" aria-label={`Set ${word}`}>
        {[0, 1, 2, 3].map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={value === n}
            aria-label={`${word} = ${n}`}
            disabled={disabled}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ))}
      </fieldset>
    </fieldset>
  );
}

function Lamp({
  index,
  bit,
  displacement,
}: {
  index: number;
  bit: 0 | 1 | null | undefined;
  displacement: number | undefined;
}) {
  const state =
    bit === 1 ? 'one' : bit === 0 ? 'zero' : bit === null ? 'ambiguous' : 'off';
  const glyph = bit === 1 ? '1' : bit === 0 ? '0' : bit === null ? '?' : '–';
  const text =
    bit === 1
      ? 'one'
      : bit === 0
        ? 'zero'
        : bit === null
          ? 'ambiguous'
          : 'no reading';
  return (
    <div className="lamp-cell">
      <span className="lamp" data-state={state}>
        <span className="lamp-glyph" aria-hidden="true">
          {glyph}
        </span>
        <span className="sr-only">{`S${index}: ${text}`}</span>
      </span>
      <span className="lamp-name">
        S<sub>{index}</sub>
      </span>
      <span className="lamp-x" title="Gauge displacement (units)">
        {displacement === undefined || !Number.isFinite(displacement)
          ? '—'
          : displacement.toFixed(3)}
      </span>
    </div>
  );
}

const GAUGE_TEXT: Record<GaugeState, { label: string; detail: string }> = {
  stable: { label: 'Stable', detail: 'all gauges in a zone and slow' },
  moving: { label: 'Moving', detail: 'in a zone but faster than 0.08' },
  ambiguous: { label: 'Ambiguous', detail: 'a gauge is between zones' },
};

function Output({
  output,
  final,
}: {
  output: Readout | undefined;
  final: boolean;
}) {
  const gauges = output ? [...output.gauges].reverse() : [];
  const state = output ? gaugeState(output) : null;
  return (
    <>
      <div
        className="lamps"
        aria-label="Output gauges S2 S1 S0"
        data-final={final || undefined}
      >
        {[2, 1, 0].map((index, i) => (
          <Lamp
            key={index}
            index={index}
            bit={output ? gauges[i]?.bit : undefined}
            displacement={gauges[i]?.displacement}
          />
        ))}
      </div>
      <div className="gauge-state" data-state={state ?? 'none'}>
        <span className="gauge-glyph" aria-hidden="true">
          {state === 'stable'
            ? '■'
            : state === 'moving'
              ? '≈'
              : state
                ? '?'
                : '·'}
        </span>
        <span className="gauge-label">
          {state ? GAUGE_TEXT[state].label : 'No reading'}
        </span>
        <span className="gauge-detail">
          {state ? GAUGE_TEXT[state].detail : 'waiting for the world'}
        </span>
      </div>
    </>
  );
}

export function Computation(props: Props) {
  const output = props.frame?.snapshot.output;
  const sum = output
    ? output.value === null
      ? '?'
      : String(output.value)
    : '–';
  const [a, b] = props.inputs;
  const final = props.finished && !props.replaying && !!output;
  const set = (index: number, value: number) =>
    props.onInputs((index === 0 ? [value, b] : [a, value]) as [number, number]);

  return (
    <aside className="computation panel" aria-label="Computation">
      <section className="block">
        <header className="block-head">
          <h2 className="micro">Inputs</h2>
          <span className="micro dim">set before the run</span>
        </header>
        <div className="inputs">
          {WORDS.map((word, i) => (
            <InputWord
              key={word}
              word={word}
              value={props.inputs[i]}
              disabled={props.disabled}
              onChange={(value) => set(i, value)}
            />
          ))}
        </div>
        <p className="fine">
          Each bit shifts a fixed socket one unit. Changing inputs rebuilds a
          fresh world; persistent cycles run in the stress test.
        </p>
      </section>

      <section className="block">
        <header className="block-head">
          <h2 className="micro">Measured sum</h2>
          {props.replaying && <span className="tag tag-replay">replay</span>}
          {props.reverse && !props.replaying && (
            <span className="tag">reverse reset · expects 000</span>
          )}
          {props.interventionText && (
            <span className="tag tag-intervene">{props.interventionText}</span>
          )}
        </header>
        {props.note && <p className="note-chip">{props.note}</p>}
        <div
          className="equation"
          aria-label={`A ${a} plus B ${b}; gauges read ${sum}`}
          data-final={final || undefined}
        >
          <span className="eq-term eq-in">
            <span className="eq-num">{a}</span>
            <span className="eq-cap">A</span>
          </span>
          <span className="eq-op">+</span>
          <span className="eq-term eq-in">
            <span className="eq-num">{b}</span>
            <span className="eq-cap">B</span>
          </span>
          <span className="eq-op">=</span>
          <span
            key={final ? 'final' : 'live'}
            className="eq-term eq-out"
            data-ambiguous={sum === '?' || undefined}
          >
            <span className="eq-num">{sum}</span>
            <span className="eq-cap">S · measured</span>
          </span>
        </div>
        <Output output={output} final={final} />
        {final && props.verdict ? (
          <output className="verdict" data-kind={props.verdict.kind}>
            <span className="verdict-glyph" aria-hidden="true">
              {props.verdict.kind === 'pass' ? '✓' : '✗'}
            </span>
            <span>
              <strong>Evaluator: {KIND_TEXT[props.verdict.kind]}</strong>
              {props.verdict.kind !== 'pass' &&
                ` · expected ${props.verdict.expected}`}
            </span>
          </output>
        ) : (
          <p className="fine">
            {final
              ? 'Read window complete. This is the gauges’ reading, not a verdict — Evaluate all 16 to score it.'
              : 'Instantaneous gauge reading, not a verdict — evaluation checks the full read window.'}
          </p>
        )}
      </section>

      <section className="block block-trace">
        <header className="block-head">
          <h2 className="micro">Signal trace</h2>
          <span className="micro dim">gauge displacement vs time</span>
        </header>
        <SignalTrace
          frames={props.traceFrames}
          cursor={props.replaying ? props.frame?.t : undefined}
        />
      </section>
    </aside>
  );
}
