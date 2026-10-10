import { CRANK, INPUTS, OUTPUTS } from '../../simulator/protocol';

type Vec = [number, number];
type LooseShape = {
  type?: string;
  half?: Vec;
  radius?: number;
  vertices?: Vec[];
  offset?: Vec;
  angle?: number;
};
type LooseBody = {
  type?: string;
  position?: Vec;
  angle?: number;
  shapes?: LooseShape[];
};

const rot = ([x, y]: Vec, a: number): Vec => [
  x * Math.cos(a) - y * Math.sin(a),
  x * Math.sin(a) + y * Math.cos(a),
];

function outline(body: LooseBody, shape: LooseShape): string | null {
  const [px, py] = body.position ?? [0, 0];
  const [ox, oy] = shape.offset ?? [0, 0];
  const ba = body.angle ?? 0;
  const sa = shape.angle ?? 0;
  let local: Vec[];
  if (shape.type === 'box' && shape.half) {
    const [w, h] = shape.half;
    local = [
      [-w, -h],
      [w, -h],
      [w, h],
      [-w, h],
    ];
  } else if (shape.type === 'ball' && shape.radius) {
    const r = shape.radius;
    local = Array.from({ length: 16 }, (_, i) => {
      const t = (i / 16) * Math.PI * 2;
      return [r * Math.cos(t), r * Math.sin(t)] as Vec;
    });
  } else if (shape.type === 'convex' && shape.vertices) local = shape.vertices;
  else return null;
  const pts = local.map((p) => {
    const [sx, sy] = rot(p, sa);
    const [wx, wy] = rot([sx + ox, sy + oy], ba);
    return `${(wx + px).toFixed(2)},${(-(wy + py)).toFixed(2)}`;
  });
  return `M${pts.join('L')}Z`;
}

/** A tiny top-down silhouette of a machine and the fixed harness. */
export function MachineThumb({ text }: { text: string }) {
  let bodies: LooseBody[] = [];
  try {
    const parsed = JSON.parse(text) as { bodies?: LooseBody[] };
    if (Array.isArray(parsed.bodies)) bodies = parsed.bodies.slice(0, 128);
  } catch {
    // An unparsable machine just shows the harness.
  }
  return (
    <svg viewBox="-12.5 -12.5 25 25" className="thumb" aria-hidden="true">
      {[-8, -4, 0, 4, 8].map((v) => (
        <g key={v} className="thumb-grid">
          <line x1={v} x2={v} y1={-12} y2={12} />
          <line x1={-12} x2={12} y1={v} y2={v} />
        </g>
      ))}
      <rect x="-12" y="-12" width="24" height="24" className="thumb-frame" />
      {bodies.map((body, i) =>
        (body.shapes ?? []).slice(0, 8).map((shape, j) => {
          const d = outline(body, shape);
          return d ? (
            <path
              key={`${i}-${j}`}
              d={d}
              className={body.type === 'fixed' ? 'thumb-fixed' : 'thumb-part'}
            />
          ) : null;
        }),
      )}
      {INPUTS.map((input) => (
        <rect
          key={input.id}
          x={input.x - 0.4}
          y={-input.y - 0.7}
          width={0.8}
          height={1.4}
          rx={0.15}
          className="thumb-input"
        />
      ))}
      {OUTPUTS.map((output) => (
        <rect
          key={output.id}
          x={output.x - 0.55}
          y={-output.y - 0.55}
          width={1.1}
          height={1.1}
          rx={0.15}
          className="thumb-output"
        />
      ))}
      <circle
        cx={CRANK.x}
        cy={-CRANK.y}
        r={CRANK.radius * 1.8}
        className="thumb-crank"
      />
    </svg>
  );
}
