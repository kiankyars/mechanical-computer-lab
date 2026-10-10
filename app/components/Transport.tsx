import { useState, type ReactNode } from 'react';
import {
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  StepForward,
} from 'lucide-react';
import { SPEEDS, type Frame, type Operation } from '../lib/useSimulation';
import { Timeline } from './Timeline';

type Props = {
  status: 'booting' | 'loading' | 'ready' | 'failed';
  running: boolean;
  canRun: boolean;
  phase: string;
  speed: number;
  onSpeed: (speed: number) => void;
  onToggle: () => void;
  /** The operation is complete: the primary button runs it again. */
  finished: boolean;
  onStep: () => void;
  onReverse: () => void;
  onReload: () => void;
  frames: Frame[];
  ops: Operation[];
  index: number;
  replaying: boolean;
  onScrub: (index: number) => void;
  onLive: () => void;
};

const DEFAULT_HINT =
  'Recorded playback moves only the view — physics never rewinds.';

function Key({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Transport(props: Props) {
  const [hint, setHint] = useState('');
  const ready = props.status === 'ready';
  const primaryLabel = props.running
    ? 'Pause'
    : props.status === 'failed'
      ? 'Stopped'
      : props.finished
        ? 'Run again'
        : props.phase === 'ready'
          ? 'Turn crank'
          : 'Resume';
  const describe = (text: string) => ({
    onPointerEnter: () => setHint(text),
    onPointerLeave: () => setHint(''),
    onFocus: () => setHint(text),
    onBlur: () => setHint(''),
  });

  return (
    <div className="transport" aria-label="Transport">
      <div className="transport-row">
        <div className="transport-main">
          <button
            type="button"
            className="btn btn-crank"
            disabled={!props.canRun && !props.finished}
            onClick={props.onToggle}
            aria-keyshortcuts="Space"
            {...describe(
              props.finished
                ? 'Build a fresh world and turn the crank again. Reverse reset instead runs the crank backwards and keeps internal state.'
                : 'Drive the crank at 2 rad/s for 4 s, then let the machine settle for 2 s.',
            )}
          >
            {props.running ? (
              <Pause size={16} aria-hidden="true" />
            ) : props.finished ? (
              <RotateCw size={16} aria-hidden="true" />
            ) : (
              <Play size={16} aria-hidden="true" />
            )}
            <span>{primaryLabel}</span>
            <Key>Space</Key>
          </button>
          <button
            type="button"
            className="btn"
            disabled={!props.canRun}
            onClick={props.onStep}
            aria-keyshortcuts="ArrowRight ."
            {...describe('Advance one physics step (1/240 s).')}
          >
            <StepForward size={16} aria-hidden="true" />
            <span>Step</span>
            <Key>→</Key>
          </button>
          <button
            type="button"
            className="btn"
            disabled={!ready}
            onClick={props.onReverse}
            aria-keyshortcuts="R"
            aria-label="Reverse reset"
            {...describe(
              'Run the fixed reset schedule: crank backwards for 4 s, settle 2 s. Internal state is kept.',
            )}
          >
            <RotateCcw size={16} aria-hidden="true" />
            <span className="label-long" aria-hidden="true">
              Reverse reset
            </span>
            <span className="label-short" aria-hidden="true">
              Reverse
            </span>
            <Key>R</Key>
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            disabled={props.status === 'booting'}
            onClick={props.onReload}
            aria-keyshortcuts="L"
            aria-describedby="reload-hint"
            title="Rebuilds the world — not a mechanical reset"
            {...describe('Reload rebuilds the world — not a mechanical reset.')}
          >
            <RefreshCw size={16} aria-hidden="true" />
            <span>Reload</span>
            <Key>L</Key>
          </button>
          <span id="reload-hint" className="sr-only">
            Rebuilds the world — not a mechanical reset
          </span>
        </div>
        <div className="transport-speed">
          <span className="micro" id="speed-label">
            Speed
          </span>
          <fieldset className="seg" aria-labelledby="speed-label">
            {SPEEDS.map((option, i) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={props.speed === option.value}
                onClick={() => props.onSpeed(option.value)}
                aria-keyshortcuts={String(i + 1)}
                title={`${option.label} real time (${i + 1})`}
              >
                {option.label}
              </button>
            ))}
          </fieldset>
        </div>
      </div>
      <Timeline
        frames={props.frames}
        ops={props.ops}
        index={props.index}
        replaying={props.replaying}
        onScrub={props.onScrub}
        onLive={props.onLive}
      />
      <div className="transport-foot">
        <p className="hint" aria-live="off">
          {hint || DEFAULT_HINT}
        </p>
        <p className="stage-note">2D physics · depth is visual only</p>
        {/* The slot keeps its width so nothing shifts when it appears. */}
        <div className="live-slot">
          {props.replaying && (
            <button
              type="button"
              className="btn btn-sm btn-live"
              onClick={props.onLive}
            >
              <span className="live-dot" aria-hidden="true" />
              Back to live
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
