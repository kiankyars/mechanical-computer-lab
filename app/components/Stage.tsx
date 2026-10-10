import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { Crosshair, Maximize2, Minimize2, Upload, X } from 'lucide-react';
import { OUTPUTS, SETTINGS } from '../../simulator/protocol';
import type { Machine } from '../../simulator/schema';
import type { Intervention, Snapshot } from '../../simulator/world';
import { MachineScene, type FitMode, type HoverInfo } from '../../viewer/scene';
import { degrees, fixed, signed, type PhaseInfo } from '../lib/format';
import type { Frame } from '../lib/useSimulation';

type Props = {
  sceneRef: RefObject<MachineScene | null>;
  machine: Machine | null;
  frame: Frame | null;
  /** The frame before `frame`, for speeds in the hover card. */
  previous: Frame | null;
  /** 'failed' / 'loading': there is no world for the current selection. */
  world: 'ok' | 'loading' | 'failed';
  intervention: Intervention | null;
  onClearIntervention: () => void;
  phase: PhaseInfo;
  running: boolean;
  replay: { index: number; total: number; liveTime: number } | null;
  tilt: boolean;
  onTilt: (on: boolean) => void;
  onFit: () => void;
  selected: string;
  onSelect: (id: string) => void;
  onInspect: () => void;
  onDropFile: (file: File) => void;
};

/** Readouts float over large stages (the scene keeps the machine clear of
 * them, see MachineScene.setInsets); smaller stages put them in a strip
 * above the viewport. */
const overlayFits = (width: number, height: number) =>
  width >= 600 && height >= 400;

/** Live facts about a hovered part, from the displayed snapshot. */
function partFacts(
  machine: Machine | null,
  id: string,
  snapshot: Snapshot | undefined,
  previous: Snapshot | undefined,
): string[] {
  const facts: string[] = [];
  const body = machine?.bodies.find((b) => b.id === id);
  if (body)
    facts.push(
      `${body.type} · ${body.shapes.length} shape${body.shapes.length === 1 ? '' : 's'}`,
    );
  const gauge = OUTPUTS.findIndex((o) => o.id === id);
  const reading = gauge >= 0 ? snapshot?.output.gauges[gauge] : undefined;
  if (reading) {
    const zone =
      reading.bit === 1
        ? '1 zone'
        : reading.bit === 0
          ? '0 zone'
          : 'between zones';
    facts.push(
      `displacement ${signed(reading.displacement, 3)} · ${zone}`,
      `speed ${fixed(Math.abs(reading.speed), 3)} u/s · bit ${reading.bit ?? '?'}`,
    );
    return facts;
  }
  const pose = snapshot?.bodies.find((b) => b.id === id);
  if (pose) {
    facts.push(
      `x ${signed(pose.x, 2)}  y ${signed(pose.y, 2)}  θ ${degrees(pose.angle).toFixed(1)}°`,
    );
    const before = previous?.bodies.find((b) => b.id === id);
    const dt = snapshot && previous ? snapshot.time - previous.time : 0;
    if (before && dt > 0)
      facts.push(
        `speed ${(Math.hypot(pose.x - before.x, pose.y - before.y) / dt).toFixed(2)} u/s`,
      );
    if (pose.type === 'fixed' && body?.type === 'dynamic')
      facts.push('locked by the causal check');
  } else if (body) facts.push('removed by the causal check');
  const joints = (machine?.joints ?? [])
    .filter((j) => j.a === id || j.b === id)
    .map((j) => j.id);
  if (joints.length)
    facts.push(
      `joints ${joints.slice(0, 4).join(', ')}${joints.length > 4 ? ` +${joints.length - 4}` : ''}`,
    );
  if (!body && id.startsWith('$') && gauge < 0) facts.push('harness fixture');
  return facts;
}

const PAUSABLE = new Set(['drive', 'settle', 'read', 'reverse']);

export function Stage(props: Props) {
  const { sceneRef, frame, phase, replay, machine } = props;
  const root = useRef<HTMLElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [tipPos, setTipPos] = useState<{ left: number; top: number } | null>(
    null,
  );
  const [webgl, setWebgl] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [overlay, setOverlay] = useState(true);
  const [fitMode, setFitMode] = useState<FitMode | null>('machine');
  const onSelect = useRef(props.onSelect);
  onSelect.current = props.onSelect;
  const onDropFile = useRef(props.onDropFile);
  onDropFile.current = props.onDropFile;

  useEffect(() => {
    if (!host.current) return;
    let scene: MachineScene | null = null;
    try {
      scene = new MachineScene(host.current, {
        onSelect: (id) => onSelect.current(id),
        onHover: setHover,
        onFitChange: setFitMode,
      });
    } catch {
      setWebgl(false);
    }
    sceneRef.current = scene;
    return () => {
      scene?.dispose();
      sceneRef.current = null;
    };
  }, [sceneRef]);

  // Tell the scene which parts of the viewport the readouts cover, so the
  // fitted machine never sits underneath them. Measured when the stage or
  // the layout changes, not per frame, so the view never jumps mid-run.
  const measure = useRef(() => {});
  measure.current = () => {
    const scene = sceneRef.current;
    const vp = viewport.current;
    if (!scene || !vp) return;
    const box = vp.getBoundingClientRect();
    const rect = (selector: string) =>
      vp.querySelector(selector)?.getBoundingClientRect();
    const time = overlay ? rect('.hud-tl .hud-time') : undefined;
    const chip = overlay ? rect('.hud-tl .phase-chip') : undefined;
    // The causal-check chip sits under the phase chip while it applies.
    const iv = overlay ? rect('.hud-tl .intervene-chip') : undefined;
    const tele = overlay ? rect('.hud-tr') : undefined;
    const controls = rect('.view-controls');
    const up = (n: number) => Math.max(0, Math.ceil(n / 4) * 4);
    scene.setInsets({
      top: up(
        Math.max(
          chip ? chip.bottom - box.top : 0,
          iv ? iv.bottom - box.top : 0,
          tele ? tele.bottom - box.top : 0,
        ) + 6,
      ),
      left: up(
        Math.max(time?.right ?? 0, chip?.right ?? 0, iv?.right ?? 0) -
          box.left +
          6,
      ),
      right: tele ? up(box.right - tele.left + 6) : 0,
      bottom: controls ? up(box.bottom - controls.top + 4) : 0,
    });
  };
  // Decide where the readouts go from the whole stage size (not the viewport,
  // whose height depends on that decision).
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setOverlay(overlayFits(width, height));
      measure.current();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const hasIntervention = !!props.intervention;
  useLayoutEffect(() => measure.current(), [overlay, webgl, hasIntervention]);

  // Drop a machine JSON anywhere on the stage.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const hasFiles = (event: DragEvent) =>
      [...(event.dataTransfer?.types ?? [])].includes('Files');
    const over = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragging(true);
    };
    const leave = (event: DragEvent) => {
      if (el.contains(event.relatedTarget as Node | null)) return;
      setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer?.files[0];
      if (file) onDropFile.current(file);
    };
    el.addEventListener('dragover', over);
    el.addEventListener('dragleave', leave);
    el.addEventListener('drop', drop);
    return () => {
      el.removeEventListener('dragover', over);
      el.removeEventListener('dragleave', leave);
      el.removeEventListener('drop', drop);
    };
  }, []);

  // Keep the hover tooltip inside the viewport.
  useLayoutEffect(() => {
    if (!hover || !tip.current || !viewport.current) {
      setTipPos(null);
      return;
    }
    const box = viewport.current.getBoundingClientRect();
    const own = tip.current.getBoundingClientRect();
    let left = hover.x + 14;
    let top = hover.y + 14;
    if (left + own.width > box.width - 8) left = hover.x - own.width - 14;
    if (top + own.height > box.height - 8) top = hover.y - own.height - 14;
    setTipPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [hover]);

  const snapshot = frame?.snapshot;
  const torque = snapshot?.torque ?? 0;
  const torqueFraction = Math.max(
    -1,
    Math.min(1, torque / SETTINGS.crankTorque),
  );
  const driving = Math.abs(torque) > 1e-9;
  const paused = !props.running && PAUSABLE.has(phase.key);
  const fitLabel =
    fitMode === 'machine'
      ? 'Show the whole workspace (F)'
      : 'Fit the machine (F)';

  const clock = (
    <div className="hud-clock">
      <div className="hud-time">
        <span className="hud-key">t</span>
        <span className="hud-value">{fixed(snapshot?.time, 3)}</span>
        <span className="hud-unit">s</span>
      </div>
      <div className="phase-chip" data-phase={phase.key}>
        <span className="phase-dot" aria-hidden="true" />
        <span className="phase-label">{phase.label}</span>
        <span className="phase-detail">
          {phase.detail}
          {paused ? ' · paused' : ''}
        </span>
      </div>
      {replay && (
        <div className="replay-chip">
          <span>
            Replay {replay.index + 1}/{replay.total}
          </span>
          <span className="replay-sub">
            physics at {replay.liveTime.toFixed(2)} s
          </span>
        </div>
      )}
      {props.intervention && (
        <output className="intervene-chip" data-kind={props.intervention.kind}>
          <span className="intervene-kind">
            {props.intervention.kind === 'remove' ? 'Removed' : 'Locked'}
          </span>
          <span className="mono intervene-id">{props.intervention.body}</span>
          <button
            type="button"
            className="icon-btn icon-btn-xs"
            aria-label={`Restore ${props.intervention.body} (make the machine intact)`}
            title="Restore the intact machine"
            onClick={props.onClearIntervention}
          >
            <X size={12} aria-hidden="true" />
          </button>
        </output>
      )}
    </div>
  );

  const telemetry = (
    <dl className="hud-telemetry" aria-label="Crank telemetry">
      <div className="hud-row">
        <dt>Crank angle</dt>
        <dd>
          {snapshot ? `${degrees(snapshot.crankAngle).toFixed(1)}°` : '—'}
        </dd>
      </div>
      <div className="hud-row">
        <dt>Torque</dt>
        <dd className="torque">
          <span
            className="torque-bar"
            data-live={driving || undefined}
            aria-hidden="true"
          >
            <span
              className="torque-fill"
              style={{
                left: `${50 + Math.min(0, torqueFraction) * 50}%`,
                width: `${Math.abs(torqueFraction) * 50}%`,
              }}
            />
          </span>
          <span>{signed(torque, 2)}</span>
          <span className="hud-unit">N·m</span>
        </dd>
      </div>
      <div className="hud-row">
        <dt>Work</dt>
        <dd>
          {fixed(snapshot?.positiveWork, 3)}
          <span className="hud-unit">J</span>
        </dd>
      </div>
      <div className="hud-row hud-diag">
        <dt title="Largest joint residual and overlap so far">Residual</dt>
        <dd>
          {fixed(snapshot?.maxJointError, 4)}/
          {fixed(snapshot?.maxPenetration, 3)}
        </dd>
      </div>
    </dl>
  );

  return (
    <section
      ref={root}
      className="stage"
      data-hud={overlay ? 'overlay' : 'strip'}
      aria-label="Simulation viewport"
    >
      {!overlay && (
        <div className="hud-strip">
          {clock}
          {telemetry}
        </div>
      )}
      <div ref={viewport} className="viewport">
        <div ref={host} className="stage-canvas" />
        {webgl && props.world !== 'ok' && (
          <div className="world-veil" data-world={props.world}>
            {props.world === 'failed' ? (
              <>
                <strong>No world to show</strong>
                <span>
                  Setup failed for these settings, so nothing here is live. See
                  the message above.
                </span>
              </>
            ) : (
              <span>Building the world…</span>
            )}
          </div>
        )}
        {!webgl && (
          <div className="stage-fallback" role="note">
            <strong>WebGL is unavailable in this browser.</strong>
            <p>
              The physics still runs: gauges, signal trace, evaluation and
              stress test all work without the 3D view, and so does the
              command-line evaluator (<code>npm run evaluate</code>).
            </p>
          </div>
        )}
        {overlay && (
          <>
            <div className="hud hud-tl">{clock}</div>
            <div className="hud hud-tr">{telemetry}</div>
          </>
        )}
        <div className="hud hud-br">
          {props.selected && (
            <div className="select-chip">
              <Crosshair size={13} aria-hidden="true" />
              <span className="mono select-id">{props.selected}</span>
              <button
                type="button"
                className="link-btn"
                onClick={props.onInspect}
              >
                Inspect
              </button>
              <button
                type="button"
                className="icon-btn icon-btn-xs"
                aria-label="Clear selection"
                onClick={() => props.onSelect('')}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </div>
          )}
          {webgl && (
            <div className="view-controls">
              <fieldset className="seg seg-sm" aria-label="View">
                <button
                  type="button"
                  aria-pressed={!props.tilt}
                  onClick={() => props.onTilt(false)}
                >
                  Plan
                </button>
                <button
                  type="button"
                  aria-pressed={props.tilt}
                  onClick={() => props.onTilt(true)}
                >
                  3/4
                </button>
              </fieldset>
              <button
                type="button"
                className="icon-btn icon-btn-sm"
                onClick={props.onFit}
                aria-label={fitLabel}
                title={fitLabel}
              >
                {fitMode === 'machine' ? (
                  <Maximize2 size={14} aria-hidden="true" />
                ) : (
                  <Minimize2 size={14} aria-hidden="true" />
                )}
              </button>
            </div>
          )}
        </div>

        {hover && (
          <div
            ref={tip}
            className="stage-tip"
            style={
              tipPos
                ? { left: tipPos.left, top: tipPos.top }
                : {
                    left: hover.x + 14,
                    top: hover.y + 14,
                    visibility: 'hidden',
                  }
            }
          >
            <strong className="mono">{hover.id}</strong>
            {hover.label && <span>{hover.label}</span>}
            {partFacts(
              machine,
              hover.id,
              snapshot,
              props.previous?.snapshot,
            ).map((fact) => (
              <span key={fact} className="tip-meta">
                {fact}
              </span>
            ))}
          </div>
        )}
        {dragging && (
          <div className="drop-veil" aria-hidden="true">
            <Upload size={22} />
            <span>Drop a machine JSON to load it</span>
            <small>It stays in this browser; nothing is uploaded.</small>
          </div>
        )}
      </div>
    </section>
  );
}
