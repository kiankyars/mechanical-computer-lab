import { useEffect, useRef, type ReactNode } from 'react';
import { CRANK, INPUTS, OUTPUTS } from '../../simulator/protocol';
import type { Machine } from '../../simulator/schema';
import type { Snapshot } from '../../simulator/world';
import { degrees, signed } from '../lib/format';
import { JointIcon } from './Marks';

type Props = {
  machine: Machine | null;
  snapshot: Snapshot | null;
  selected: string;
  onSelect: (id: string) => void;
  onPreview: (id: string) => void;
};

const HARNESS = [
  ...INPUTS.map((x) => ({
    id: x.id,
    label: `Input ${x.word ? 'B' : 'A'} bit ${x.bit}`,
    kind: 'fixed socket',
  })),
  { id: CRANK.id, label: 'Crank · driven', kind: 'dynamic disk' },
  ...OUTPUTS.map((x, i) => ({
    id: x.id,
    label: `Output S${i} gauge`,
    kind: 'dynamic, on rail',
  })),
];

function Row({
  id,
  selected,
  onSelect,
  onPreview,
  children,
}: {
  id: string;
  selected: boolean;
  onSelect: (id: string) => void;
  onPreview: (id: string) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    // Scroll only the table's own container, never the page.
    const row = ref.current;
    const wrap = row?.closest('.table-wrap');
    if (!selected || !row || !(wrap instanceof HTMLElement)) return;
    const r = row.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    const head =
      wrap.querySelector('thead')?.getBoundingClientRect().height ?? 0;
    if (r.top < w.top + head) wrap.scrollTop -= w.top + head - r.top;
    else if (r.bottom > w.bottom) wrap.scrollTop += r.bottom - w.bottom;
  }, [selected]);
  return (
    <tr
      ref={ref}
      data-selected={selected || undefined}
      onMouseEnter={() => onPreview(id)}
      onMouseLeave={() => onPreview('')}
    >
      <td>
        <button
          type="button"
          className="row-btn mono"
          aria-pressed={selected}
          onClick={() => onSelect(selected ? '' : id)}
          onFocus={() => onPreview(id)}
          onBlur={() => onPreview('')}
        >
          {id}
        </button>
      </td>
      {children}
    </tr>
  );
}

export function Inspector({
  machine,
  snapshot,
  selected,
  onSelect,
  onPreview,
}: Props) {
  const bodies = machine?.bodies ?? [];
  const joints = machine?.joints ?? [];
  // Labels are optional; skip the column when no part has one.
  const labelled = bodies.some((b) => b.label);
  const pose = snapshot?.bodies.find((b) => b.id === selected);
  const body = bodies.find((b) => b.id === selected);
  const harness = HARNESS.find((h) => h.id === selected);
  const attached = joints.filter((j) => j.a === selected || j.b === selected);
  const jointSel = joints.find((j) => j.id === selected);

  return (
    <div className="inspector">
      <div className="inspector-lists">
        <section>
          <h3 className="micro">
            Bodies <span className="dim">{bodies.length}</span>
          </h3>
          {bodies.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">ID</th>
                    {labelled && <th scope="col">Label</th>}
                    <th scope="col">Type</th>
                    <th scope="col" className="num">
                      Shapes
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {bodies.map((b) => (
                    <Row
                      key={b.id}
                      id={b.id}
                      selected={selected === b.id}
                      onSelect={onSelect}
                      onPreview={onPreview}
                    >
                      {labelled && <td className="dim">{b.label ?? '—'}</td>}
                      <td>
                        <span className="pill" data-type={b.type}>
                          {b.type}
                        </span>
                      </td>
                      <td className="num mono">{b.shapes.length}</td>
                    </Row>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="fine">
              No candidate parts. The fixed harness below is all there is.
            </p>
          )}
        </section>
        <section>
          <h3 className="micro">
            Joints <span className="dim">{joints.length}</span>
          </h3>
          {joints.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">ID</th>
                    <th scope="col">Type</th>
                    <th scope="col">Connects</th>
                  </tr>
                </thead>
                <tbody>
                  {joints.map((j) => (
                    <tr
                      key={j.id}
                      data-selected={selected === j.id || undefined}
                    >
                      <td>
                        <button
                          type="button"
                          className="row-btn mono"
                          aria-pressed={selected === j.id}
                          onClick={() =>
                            onSelect(selected === j.id ? '' : j.id)
                          }
                          onMouseEnter={() =>
                            onPreview(j.b.startsWith('$') ? j.a : j.b)
                          }
                          onMouseLeave={() => onPreview('')}
                          onFocus={() =>
                            onPreview(j.b.startsWith('$') ? j.a : j.b)
                          }
                          onBlur={() => onPreview('')}
                        >
                          {j.id}
                        </button>
                      </td>
                      <td>
                        <span className="joint-type" data-type={j.type}>
                          <JointIcon type={j.type} />
                          {j.type}
                        </span>
                      </td>
                      <td className="mono">
                        <button
                          type="button"
                          className="link-btn mono"
                          onClick={() => onSelect(j.a)}
                          onMouseEnter={() => onPreview(j.a)}
                          onMouseLeave={() => onPreview('')}
                        >
                          {j.a}
                        </button>{' '}
                        <span className="dim" aria-label="to">
                          →
                        </span>{' '}
                        <button
                          type="button"
                          className="link-btn mono"
                          onClick={() => onSelect(j.b)}
                          onMouseEnter={() => onPreview(j.b)}
                          onMouseLeave={() => onPreview('')}
                        >
                          {j.b}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="fine">No joints.</p>
          )}
        </section>
        <section>
          <h3 className="micro">Harness · fixed by the protocol</h3>
          <div className="harness">
            {HARNESS.map((h) => (
              <button
                key={h.id}
                type="button"
                className="chip mono"
                aria-pressed={selected === h.id}
                onClick={() => onSelect(selected === h.id ? '' : h.id)}
                onMouseEnter={() => onPreview(h.id)}
                onMouseLeave={() => onPreview('')}
                onFocus={() => onPreview(h.id)}
                onBlur={() => onPreview('')}
                title={h.label}
              >
                {h.id}
              </button>
            ))}
          </div>
        </section>
      </div>

      <section className="inspector-detail" aria-live="polite">
        <h3 className="micro">Selection</h3>
        {!selected ? (
          <p className="fine">
            Click a part in the viewport or a row here. Hovering a row
            highlights it in the viewport.
          </p>
        ) : jointSel ? (
          <dl className="kv">
            <dt>Joint</dt>
            <dd className="mono">{jointSel.id}</dd>
            <dt>Type</dt>
            <dd>{jointSel.type}</dd>
            <dt>Connects</dt>
            <dd className="mono">
              {jointSel.a} → {jointSel.b}
            </dd>
            <dt>Anchors</dt>
            <dd className="mono">
              ({jointSel.anchorA.join(', ')}) · ({jointSel.anchorB.join(', ')})
            </dd>
            {'limits' in jointSel && jointSel.limits && (
              <>
                <dt>Limits</dt>
                <dd className="mono">[{jointSel.limits.join(', ')}]</dd>
              </>
            )}
            {jointSel.type === 'spring' && (
              <>
                <dt>Spring</dt>
                <dd className="mono">
                  rest {jointSel.restLength} · k {jointSel.stiffness} · c{' '}
                  {jointSel.damping}
                </dd>
              </>
            )}
          </dl>
        ) : (
          <dl className="kv">
            <dt>Part</dt>
            <dd className="mono">{selected}</dd>
            <dt>Role</dt>
            <dd>
              {body
                ? `${body.type} candidate part${body.label ? ` · ${body.label}` : ''}`
                : (harness?.label ?? 'unknown')}
            </dd>
            <dt>Position</dt>
            <dd className="mono">
              {pose ? `x ${signed(pose.x, 3)}  y ${signed(pose.y, 3)}` : '—'}
            </dd>
            <dt>Angle</dt>
            <dd className="mono">
              {pose ? `${degrees(pose.angle).toFixed(1)}°` : '—'}
            </dd>
            {body && (
              <>
                <dt>Shapes</dt>
                <dd className="mono">
                  {body.shapes.map((s) => s.type).join(', ')}
                </dd>
              </>
            )}
            <dt>Joints</dt>
            <dd className="mono">
              {attached.length
                ? attached.map((j) => `${j.id} (${j.type})`).join(', ')
                : 'none'}
            </dd>
          </dl>
        )}
      </section>
    </div>
  );
}
