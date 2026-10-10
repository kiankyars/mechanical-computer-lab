import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { DRIVE_S, READ_S, TOTAL_S } from '../lib/format';
import type { Frame, Operation } from '../lib/useSimulation';

type Props = {
  frames: Frame[];
  ops: Operation[];
  /** Index of the displayed frame. */
  index: number;
  replaying: boolean;
  onScrub: (index: number) => void;
  onLive: () => void;
};

/** Approximate rendered widths (px) of the mono labels, for collision
 * checks: tick labels (11 px) and uppercase band labels (11 px, tracked). */
const TICK_CHAR = 6.8;
const BAND_CHAR = 7.6;

type Tick = {
  time: number;
  label: string;
  /** Lower draws first and wins collisions. */
  rank: number;
  major?: boolean;
  divider?: boolean;
};

/** Keeps the highest-ranked ticks whose labels do not overlap. */
function cullTicks(ticks: Tick[], x: (time: number) => number, width: number) {
  if (!width) {
    // Not measured yet: keep every tick, pinning the ends inside the track.
    const sorted = [...ticks].sort((p, q) => p.time - q.time);
    return sorted.map((tick, i) => ({
      tick,
      anchor: (i === 0
        ? 'start'
        : i === sorted.length - 1
          ? 'end'
          : 'center') as Anchor,
    }));
  }
  const kept: { tick: Tick; left: number; right: number; anchor: Anchor }[] =
    [];
  for (const tick of [...ticks].sort((p, q) => p.rank - q.rank)) {
    const w = tick.label.length * TICK_CHAR;
    const at = x(tick.time);
    const anchor: Anchor =
      at - w / 2 < 0 ? 'start' : at + w / 2 > width ? 'end' : 'center';
    const left =
      anchor === 'start' ? at : anchor === 'end' ? at - w : at - w / 2;
    const right = left + w;
    if (kept.some((k) => left < k.right + 8 && right > k.left - 8)) continue;
    kept.push({ tick, left, right, anchor });
  }
  return kept
    .sort((p, q) => p.tick.time - q.tick.time)
    .map(({ tick, anchor }) => ({ tick, anchor }));
}
type Anchor = 'start' | 'center' | 'end';
const SHIFT: Record<Anchor, string> = {
  start: 'none',
  center: 'translateX(-50%)',
  end: 'translateX(-100%)',
};

/** Nearest recorded frame to a world time (frames are time-ordered). */
function nearest(frames: Frame[], time: number): number {
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].snapshot.time < time) lo = mid + 1;
    else hi = mid;
  }
  if (
    lo > 0 &&
    Math.abs(frames[lo - 1].snapshot.time - time) <
      Math.abs(frames[lo].snapshot.time - time)
  )
    return lo - 1;
  return lo;
}

export function Timeline({
  frames,
  ops,
  index,
  replaying,
  onScrub,
  onLive,
}: Props) {
  const start = frames[0]?.snapshot.time ?? 0;
  const lastOp = ops.at(-1);
  const end = Math.max(start + TOTAL_S, (lastOp?.start ?? 0) + TOTAL_S);
  const span = end - start || TOTAL_S;
  const pct = (time: number) => `${((time - start) / span) * 100}%`;
  const size = (seconds: number) => `${(seconds / span) * 100}%`;
  const count = frames.length;
  const shown = frames[index];
  // The track's pixel width decides which labels fit.
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const px = (time: number) => ((time - start) / span) * width;
  /** The longest of `labels` that fits a band `seconds` long, or null. */
  const fit = (seconds: number, labels: string[]) => {
    if (!width) return labels[0];
    const room = (seconds / span) * width - 10;
    return labels.find((l) => l.length * BAND_CHAR <= room) ?? null;
  };
  const live = frames.at(-1);
  const disabled = count < 2;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (disabled || event.metaKey || event.ctrlKey || event.altKey) return;
    const jump = Math.max(1, Math.round(count / 20));
    const next: Record<string, number> = {
      ArrowLeft: index - 1,
      ArrowDown: index - 1,
      ArrowRight: index + 1,
      ArrowUp: index + 1,
      PageDown: index - jump,
      PageUp: index + jump,
      Home: 0,
      End: count - 1,
    };
    if (!(event.key in next)) return;
    event.preventDefault();
    const target = Math.max(0, Math.min(count - 1, next[event.key]));
    if (target === count - 1) onLive();
    else onScrub(target);
  };

  // An operation interrupted by the next one (e.g. a reverse reset started
  // mid-drive) is clipped where the next one begins.
  const spans = ops.map((op, i) => {
    const next = ops[i + 1];
    const end = next
      ? Math.min(op.start + TOTAL_S, next.start)
      : op.start + TOTAL_S;
    return { ...op, end };
  });
  const band = (
    from: number,
    to: number,
    op: { start: number; end: number },
  ) => {
    const a = Math.min(op.start + from, op.end);
    const b = Math.min(op.start + to, op.end);
    return b > a ? { left: pct(a), width: size(b - a) } : null;
  };
  // Operation clocks: 0 at each start, 4 (drive ends), 5.5 (read window)
  // and 6 s. Where one operation begins exactly as the previous one ends, a
  // single divider tick replaces the "6" and "0" that would overlap.
  const ticks: Tick[] = [];
  spans.forEach((op, i) => {
    const previous = spans[i - 1];
    const joined =
      previous &&
      Math.abs(previous.end - op.start) < 1e-6 &&
      previous.end >= previous.start + TOTAL_S - 1e-9;
    if (!joined)
      ticks.push({ time: op.start, label: '0', rank: 0, major: true });
    for (const [t, label, rank] of [
      [DRIVE_S, '4', 2],
      [READ_S, '5.5', 3],
    ] as const)
      if (op.start + t < op.end - 0.2)
        ticks.push({ time: op.start + t, label, rank });
    const last = i === spans.length - 1;
    const next = spans[i + 1];
    if (op.end >= op.start + TOTAL_S - 1e-9) {
      const divider = !!next && Math.abs(next.start - op.end) < 1e-6;
      ticks.push({
        time: op.end,
        label: divider ? '6│0' : last ? '6 s' : '6',
        rank: last ? 0 : 1,
        major: true,
        divider,
      });
    }
  });
  const shownTicks = cullTicks(ticks, px, width);

  const opTime = shown ? shown.t : 0;
  const valueText = shown
    ? `${replaying ? 'Recorded frame' : 'Live frame'} ${index + 1} of ${count}, t = ${shown.snapshot.time.toFixed(2)} s (operation ${opTime.toFixed(2)} s)`
    : 'No frames recorded';

  return (
    <div
      ref={root}
      className="timeline"
      data-replaying={replaying || undefined}
    >
      <div className="timeline-track" aria-hidden="true">
        {spans.map((op, i) => {
          const drive = band(0, DRIVE_S, op);
          const settle = band(DRIVE_S, TOTAL_S, op);
          const read = band(READ_S, TOTAL_S, op);
          const until = (t: number) =>
            Math.max(0, Math.min(op.start + t, op.end) - op.start);
          const driveLabel = fit(
            until(DRIVE_S),
            op.kind === 'reverse'
              ? ['reverse drive', 'reverse', 'rev']
              : ['drive'],
          );
          // The settle label sits left of the read window's hatching.
          const settleLabel = fit(Math.max(0, until(READ_S) - DRIVE_S), [
            'settle',
          ]);
          const readLabel = fit(Math.max(0, until(TOTAL_S) - READ_S), ['read']);
          return (
            <div key={i} className="timeline-op" data-kind={op.kind}>
              {drive && (
                <span className="band band-drive" style={drive}>
                  {driveLabel && (
                    <span className="band-label">{driveLabel}</span>
                  )}
                </span>
              )}
              {settle && (
                <span className="band band-settle" style={settle}>
                  {settleLabel && (
                    <span className="band-label">{settleLabel}</span>
                  )}
                </span>
              )}
              {read && (
                <span className="band band-read" style={read}>
                  {readLabel && <span className="band-label">{readLabel}</span>}
                </span>
              )}
            </div>
          );
        })}
        {live && count > 1 && (
          <span
            className="timeline-recorded"
            style={{ left: 0, width: pct(live.snapshot.time) }}
          />
        )}
        {live && (
          <span
            className="timeline-live"
            style={{ left: pct(live.snapshot.time) }}
            aria-hidden="true"
          />
        )}
      </div>
      <input
        type="range"
        className="timeline-input"
        min={0}
        max={Math.round(span * 1000)}
        step={1}
        value={shown ? Math.round((shown.snapshot.time - start) * 1000) : 0}
        disabled={disabled}
        aria-label="Recorded playback"
        aria-valuetext={valueText}
        onChange={(event) => {
          const i = nearest(frames, start + Number(event.target.value) / 1000);
          if (i === count - 1) onLive();
          else onScrub(i);
        }}
        onKeyDown={onKeyDown}
      />
      <div className="timeline-ticks" aria-hidden="true">
        {shownTicks.map(({ tick, anchor }) => (
          <span
            key={`${tick.time}-${tick.label}`}
            className={`tick${tick.major ? ' tick-major' : ''}${tick.divider ? ' tick-divider' : ''}`}
            style={{ left: pct(tick.time), transform: SHIFT[anchor] }}
          >
            {tick.label}
          </span>
        ))}
      </div>
    </div>
  );
}
