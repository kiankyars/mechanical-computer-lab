import { useLayoutEffect, useRef, useState } from 'react';
import { SETTINGS } from '../../simulator/protocol';
import { DRIVE_S, READ_S, TOTAL_S } from '../lib/format';
import type { Frame } from '../lib/useSimulation';

type Props = {
  frames: Frame[];
  /** Operation time of the replayed frame, if replaying. */
  cursor?: number;
};

// Validated categorical order (OKLab/CVD checked on the panel surface).
const SERIES = [
  { name: 'S0', color: 'var(--series-0)' },
  { name: 'S1', color: 'var(--series-1)' },
  { name: 'S2', color: 'var(--series-2)' },
];
const Y_MIN = -0.12;
const Y_MAX = 1.12;
const HEIGHT = 176;
const M = { left: 28, right: 30, top: 8, bottom: 22 };

export function SignalTrace({ frames, cursor }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  const [hoverT, setHoverT] = useState<number | null>(null);

  // Measured before the first paint as well as on resize, so the plot never
  // starts wider than a phone's panel (ResizeObserver reports a frame later).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = (px: number) => setWidth(Math.max(240, Math.round(px)));
    fit(el.clientWidth);
    const observer = new ResizeObserver(([entry]) =>
      fit(entry.contentRect.width),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const w = width - M.left - M.right;
  const h = HEIGHT - M.top - M.bottom;
  const x = (t: number) =>
    M.left + (Math.max(0, Math.min(TOTAL_S, t)) / TOTAL_S) * w;
  const y = (v: number) =>
    M.top +
    (1 - (Math.max(Y_MIN, Math.min(Y_MAX, v)) - Y_MIN) / (Y_MAX - Y_MIN)) * h;

  const paths = SERIES.map((_, i) => {
    let d = '';
    for (const frame of frames) {
      const g = frame.snapshot.output.gauges[i];
      if (!g || !Number.isFinite(g.displacement)) continue;
      d += `${d ? 'L' : 'M'}${x(frame.t).toFixed(1)},${y(g.displacement).toFixed(1)}`;
    }
    return d;
  });

  const last = frames.at(-1);
  // Direct labels at the line ends. Colliding labels are spread evenly around
  // their shared position (not pushed one way), then kept inside the plot.
  const wanted = SERIES.map((s, i) => {
    const g = last?.snapshot.output.gauges[i];
    return { ...s, i, y: g ? y(g.displacement) : null };
  })
    .filter((e): e is typeof e & { y: number } => e.y !== null)
    .sort((p, q) => p.y - q.y);
  const GAP = 11;
  const clusters: { items: typeof wanted; mean: number }[] = [];
  for (const end of wanted) {
    clusters.push({ items: [end], mean: end.y });
    while (clusters.length > 1) {
      const cur = clusters[clusters.length - 1];
      const prev = clusters[clusters.length - 2];
      const prevBottom = prev.mean + ((prev.items.length - 1) * GAP) / 2;
      const curTop = cur.mean - ((cur.items.length - 1) * GAP) / 2;
      if (curTop - prevBottom >= GAP) break;
      const items = [...prev.items, ...cur.items];
      clusters.splice(-2, 2, {
        items,
        mean: items.reduce((sum, e) => sum + e.y, 0) / items.length,
      });
    }
  }
  const ends = clusters.flatMap(({ items, mean }) =>
    items.map((e, k) => ({
      ...e,
      y: mean + (k - (items.length - 1) / 2) * GAP,
    })),
  );
  for (let k = ends.length - 1; k >= 0; k--)
    ends[k].y = Math.min(
      ends[k].y,
      k === ends.length - 1 ? M.top + h : ends[k + 1].y - GAP,
    );
  for (let k = 0; k < ends.length; k++)
    ends[k].y = Math.max(ends[k].y, k === 0 ? M.top + 6 : ends[k - 1].y + GAP);

  const probeT = hoverT ?? cursor;
  const probe =
    probeT === undefined || !frames.length
      ? null
      : frames.reduce((best, f) =>
          Math.abs(f.t - probeT) < Math.abs(best.t - probeT) ? f : best,
        );

  const onMove = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || !frames.length) return;
    const t = ((clientX - rect.left - M.left) / w) * TOTAL_S;
    setHoverT(Math.max(0, Math.min(TOTAL_S, t)));
  };

  return (
    <div className="trace">
      <div className="trace-legend" aria-hidden="true">
        {SERIES.map((s) => (
          <span key={s.name} className="trace-key">
            <i style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
        <span className="trace-key trace-key-zone">
          <i className="zone-swatch" />
          bit zones (0, 1)
        </span>
      </div>
      <div
        ref={box}
        className="trace-plot"
        onPointerMove={(event) => onMove(event.clientX)}
        onPointerLeave={() => setHoverT(null)}
      >
        <p className="sr-only">
          {`Output gauge displacement over the ${TOTAL_S} s operation. ${
            last
              ? `At ${last.t.toFixed(2)} s: ${last.snapshot.output.gauges
                  .map((g, k) => `S${k} ${g.displacement.toFixed(3)}`)
                  .join(', ')}.`
              : 'No data yet.'
          }`}
        </p>
        <svg width={width} height={HEIGHT} aria-hidden="true">
          <defs>
            <pattern
              id="read-hatch"
              width="5"
              height="5"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line x1="0" y1="0" x2="0" y2="5" className="hatch-line" />
            </pattern>
            <clipPath id="trace-clip">
              <rect x={M.left} y={M.top} width={w} height={h} />
            </clipPath>
          </defs>
          {/* Phase bands */}
          <rect
            x={x(DRIVE_S)}
            y={M.top}
            width={x(TOTAL_S) - x(DRIVE_S)}
            height={h}
            className="tr-settle"
          />
          <rect
            x={x(READ_S)}
            y={M.top}
            width={x(TOTAL_S) - x(READ_S)}
            height={h}
            fill="url(#read-hatch)"
            className="tr-read"
          />
          {/* Decoding zones */}
          <rect
            x={M.left}
            y={y(SETTINGS.zeroMax)}
            width={w}
            height={y(-0.05) - y(SETTINGS.zeroMax)}
            className="tr-zone"
          />
          <rect
            x={M.left}
            y={y(1.05)}
            width={w}
            height={y(SETTINGS.oneMin) - y(1.05)}
            className="tr-zone"
          />
          <text
            x={M.left - 8}
            y={y(0.1) + 4}
            className="tr-axis"
            textAnchor="end"
          >
            0
          </text>
          <text
            x={M.left - 8}
            y={y(0.9) + 4}
            className="tr-axis"
            textAnchor="end"
          >
            1
          </text>
          <line
            x1={M.left}
            x2={M.left + w}
            y1={y(0)}
            y2={y(0)}
            className="tr-base"
          />
          {/* Time axis */}
          {[0, 1, 2, 3, 4, 5, 6].map((t) => (
            <g key={t}>
              <line
                x1={x(t)}
                x2={x(t)}
                y1={M.top + h}
                y2={M.top + h + 4}
                className="tr-tick"
              />
              <text
                x={x(t)}
                y={HEIGHT - 6}
                className="tr-axis"
                textAnchor="middle"
              >
                {t === 6 ? '6 s' : t}
              </text>
            </g>
          ))}
          <text x={x(DRIVE_S) + 4} y={M.top + 10} className="tr-band-label">
            settle
          </text>
          <text
            x={x(READ_S) + 3}
            y={M.top + 10}
            className="tr-band-label tr-band-read"
          >
            read
          </text>
          <text x={M.left + 4} y={M.top + 10} className="tr-band-label">
            drive
          </text>
          {/* Series */}
          <g clipPath="url(#trace-clip)">
            {paths.map((d, i) => (
              <path
                key={SERIES[i].name}
                d={d}
                className="tr-line"
                style={{ stroke: SERIES[i].color }}
              />
            ))}
          </g>
          {ends.map((end) => (
            <text
              key={end.name}
              x={M.left + w + 5}
              y={end.y + 4}
              className="tr-end"
            >
              {end.name}
            </text>
          ))}
          {probe && (
            <g className="tr-probe">
              <line
                x1={x(probe.t)}
                x2={x(probe.t)}
                y1={M.top}
                y2={M.top + h}
                className={
                  hoverT === null ? 'tr-cursor tr-cursor-replay' : 'tr-cursor'
                }
              />
              {probe.snapshot.output.gauges.map((g, i) =>
                Number.isFinite(g.displacement) ? (
                  <circle
                    key={i}
                    cx={x(probe.t)}
                    cy={y(g.displacement)}
                    r={3.5}
                    className="tr-dot"
                    style={{ fill: SERIES[i].color }}
                  />
                ) : null,
              )}
            </g>
          )}
        </svg>
        {probe && hoverT !== null && (
          <div
            className="trace-tip"
            style={{
              left: Math.min(x(probe.t) + 10, width - 132),
            }}
          >
            <div className="trace-tip-t">t {probe.t.toFixed(3)} s</div>
            {[2, 1, 0].map((i) => {
              const g = probe.snapshot.output.gauges[i];
              return (
                <div key={i} className="trace-tip-row">
                  <i style={{ background: SERIES[i].color }} />
                  <strong>
                    {Number.isFinite(g.displacement)
                      ? g.displacement.toFixed(3)
                      : '—'}
                  </strong>
                  <span>S{i}</span>
                  <span className="dim">{g.bit === null ? '?' : g.bit}</span>
                </div>
              );
            })}
          </div>
        )}
        {!frames.length || (frames.length === 1 && frames[0].t === 0) ? (
          <p className="trace-empty">Turn the crank to record the gauges.</p>
        ) : null}
      </div>
    </div>
  );
}
