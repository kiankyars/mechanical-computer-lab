// Drawing kit for the machine renderer: palette, procedural textures and the
// geometry helpers that turn collision shapes and joints into scene objects.
// Everything here is generated locally; nothing is fetched at runtime.
import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type { Shape } from '../simulator/schema';

export { LineMaterial, LineSegments2, LineSegmentsGeometry };

export type Vec2 = [number, number];
export type Pose = { x: number; y: number; angle: number };
export const GROUND_POSE: Pose = Object.freeze({ x: 0, y: 0, angle: 0 });

/** Instrument-panel palette (sRGB hex). */
export const COLOR = {
  ground: 0x0a1020,
  field: 0x0d1629,
  grid: 0x7f9fd8,
  frame: 0x2e4068,
  frameTick: 0x86a6e0,
  steel: 0xc2cbd7,
  steelEdge: 0x1f2735,
  /** Outline of slender steel parts: a dark edge would swallow the fill. */
  steelSlenderEdge: 0xd9e2ef,
  gunmetal: 0x77839a,
  gunmetalEdge: 0x9fb0cc,
  input: 0x4cc9f0,
  inputBody: 0x0f4a60,
  inputEdge: 0xbff2ff,
  brass: 0xf5b544,
  brassDim: 0x76592a,
  brassEdge: 0xffe2a6,
  brassDimEdge: 0x8f7036,
  alarm: 0xff3d8b,
  alarmEdge: 0xffa3cf,
  crank: 0xff6a3d,
  crankEdge: 0xffc6ab,
  crankInk: 0x4a1406,
  crankLight: 0xffe0d2,
  pin: 0xe8eef8,
  pinFill: 0x0b1222,
  rail: 0x93acd8,
  railFill: 0x050912,
  spring: 0x7fe3c1,
  springTension: 0xff7a59,
  /** Dashed tether to a joint anchor that lies outside its body. */
  tether: 0x6d84b0,
  springCompression: 0x7aa2ff,
  select: 0xc8ff3d,
  hover: 0xffffff,
  ghost: 0x8fa2c6,
  /** A part removed by a causal-check intervention. */
  removed: 0xff7a90,
} as const;

export const CSS = {
  label: '#a9b9d6',
  /** Secondary canvas text (rulers, scale bar); ≥ 4.5:1 on the ground. */
  dim: '#8093b8',
  input: '#8fe0f7',
  brass: '#f5b544',
  brassDim: '#a8864a',
  alarm: '#ff5c9d',
  crank: '#ff9a74',
  removed: '#ff7a90',
  ground: '#0a1020',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
} as const;

/** Vertical stacking (z) for the visual-only depth of each part. */
export const DEPTH = {
  fixedBase: 0.02,
  dynamicBase: 0.3,
  layer: 0.07,
  thickness: 0.2,
  maxFixedLayer: 3,
  maxDynamicLayer: 8,
} as const;

export const bandHeights = (fixed: boolean, layer: number) => {
  const bottom = fixed
    ? DEPTH.fixedBase + Math.min(layer, DEPTH.maxFixedLayer) * DEPTH.layer
    : DEPTH.dynamicBase + Math.min(layer, DEPTH.maxDynamicLayer) * DEPTH.layer;
  return { bottom, top: bottom + DEPTH.thickness };
};

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Mixes two sRGB hex colours (as a framebuffer blend would), 0 → a, 1 → b. */
export function mix(a: number, b: number, t: number): number {
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const ca = (a >> shift) & 255,
      cb = (b >> shift) & 255;
    out |= Math.round(ca + (cb - ca) * t) << shift;
  }
  return out;
}

/** A colour faded toward the workspace field, for opaque "dim" lines. */
export const dim = (color: number, amount: number) =>
  mix(COLOR.field, color, amount);
export const clamp = (x: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, x));

export function toWorld(pose: Pose, local: Vec2): Vec2 {
  const c = Math.cos(pose.angle),
    s = Math.sin(pose.angle);
  return [
    pose.x + c * local[0] - s * local[1],
    pose.y + s * local[0] + c * local[1],
  ];
}

export function rotate(v: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return [c * v[0] - s * v[1], s * v[0] + c * v[1]];
}

/** Number of polygon segments used to draw a disk of the given radius. */
export const circleSegments = (radius: number) =>
  Math.round(clamp(radius * 110, 32, 128));

/** A shape's outline in its body's local frame (offset and angle applied). */
export function shapeContour(shape: Shape): Vec2[] {
  const offset = shape.offset ?? [0, 0];
  const angle = shape.angle ?? 0;
  let points: Vec2[];
  if (shape.type === 'box') {
    const [hx, hy] = shape.half;
    points = [
      [-hx, -hy],
      [hx, -hy],
      [hx, hy],
      [-hx, hy],
    ];
  } else if (shape.type === 'ball') {
    const n = circleSegments(shape.radius);
    points = Array.from({ length: n }, (_, i) => {
      const t = (i / n) * Math.PI * 2;
      return [Math.cos(t) * shape.radius, Math.sin(t) * shape.radius] as Vec2;
    });
  } else points = shape.vertices.map((v) => [v[0], v[1]] as Vec2);
  return points.map((p) => {
    const r = rotate(p, angle);
    return [r[0] + offset[0], r[1] + offset[1]] as Vec2;
  });
}

/** Smallest caliper width of a convex contour (a thin bar's thickness). */
export function contourWidth(points: Vec2[]): number {
  let width = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 1e-9) continue;
    let far = 0;
    for (const p of points)
      far = Math.max(
        far,
        Math.abs(
          (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]),
        ) / length,
      );
    width = Math.min(width, far);
  }
  return width;
}

/** Radius of the largest circle around the centroid that stays inside. */
function inradius(points: Vec2[]): number {
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
  const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
  let best = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    const ex = b[0] - a[0],
      ey = b[1] - a[1];
    const length = Math.hypot(ex, ey) || 1;
    best = Math.min(
      best,
      Math.abs((cx - a[0]) * ey - (cy - a[1]) * ex) / length,
    );
  }
  return Number.isFinite(best) ? best : 0.02;
}

/**
 * Extrudes a contour into a bevelled slab whose silhouette is exactly the
 * contour (the bevel is inset), spanning z in [bottom, top].
 */
export function slabGeometry(
  contour: Vec2[],
  bottom: number,
  top: number,
  uv: (x: number, y: number) => Vec2,
  shade?: (x: number, y: number) => number,
): THREE.BufferGeometry {
  const bevel = Math.min(0.028, 0.32 * inradius(contour));
  const thickness = bevel * 0.85;
  const depth = Math.max(0.01, top - bottom - 2 * thickness);
  const geometry = new THREE.ExtrudeGeometry(
    new THREE.Shape(contour.map(([x, y]) => new THREE.Vector2(x, y))),
    {
      depth,
      curveSegments: 1,
      bevelEnabled: true,
      bevelThickness: thickness,
      bevelSize: bevel,
      bevelOffset: -bevel,
      bevelSegments: 2,
    },
  ).translate(0, 0, bottom + thickness);
  const position = geometry.getAttribute('position');
  const uvs = geometry.getAttribute('uv');
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      y = position.getY(i);
    const [u, v] = uv(x, y);
    uvs.setXY(i, u, v);
    colors.fill(shade ? shade(x, y) : 1, i * 3, i * 3 + 3);
  }
  uvs.needsUpdate = true;
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** Flat filled polygon at height z. */
export function fillGeometry(contour: Vec2[], z: number): THREE.BufferGeometry {
  return new THREE.ShapeGeometry(
    new THREE.Shape(contour.map(([x, y]) => new THREE.Vector2(x, y))),
  ).translate(0, 0, z);
}

/** Appends a polyline as independent segments (x,y,z,x,y,z) to `out`. */
export function pushPolyline(
  out: number[],
  points: Vec2[],
  z: number,
  closed: boolean,
): number[] {
  const n = points.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = points[i],
      b = points[(i + 1) % n];
    out.push(a[0], a[1], z, b[0], b[1], z);
  }
  return out;
}

export function arcPoints(
  center: Vec2,
  radius: number,
  from: number,
  to: number,
  segments = 32,
): Vec2[] {
  return Array.from({ length: segments + 1 }, (_, i) => {
    const t = from + ((to - from) * i) / segments;
    return [
      center[0] + Math.cos(t) * radius,
      center[1] + Math.sin(t) * radius,
    ] as Vec2;
  });
}

export function circlePoints(center: Vec2, radius: number, segments = 32) {
  return arcPoints(center, radius, 0, Math.PI * 2, segments).slice(0, -1);
}

/** Stadium (slot) outline from a to b with the given half width. */
export function slotContour(a: Vec2, b: Vec2, half: number): Vec2[] {
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const up = angle + Math.PI / 2;
  return [
    ...arcPoints(b, half, up - Math.PI, up, 10),
    ...arcPoints(a, half, up, up + Math.PI, 10),
  ];
}

export function lineObject(
  segments: number[],
  material: LineMaterial,
): LineSegments2 {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(segments.length ? segments : [0, 0, 0, 0, 0, 0]);
  const line = new LineSegments2(geometry, material);
  if (material.dashed) line.computeLineDistances();
  return line;
}

/**
 * Overwrites a line geometry's segments in place. The segment count must not
 * change after creation, so per-frame updates allocate nothing.
 */
export function writeSegments(line: LineSegments2, segments: Float32Array) {
  const attribute = line.geometry.getAttribute(
    'instanceStart',
  ) as THREE.InterleavedBufferAttribute;
  const buffer = attribute.data;
  (buffer.array as Float32Array).set(segments);
  buffer.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Procedural textures

function canvas(size: number) {
  const element = document.createElement('canvas');
  element.width = element.height = size;
  const context = element.getContext('2d');
  if (!context) throw new Error('2D canvas unavailable');
  return { element, context };
}

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function finish(element: HTMLCanvasElement, repeat: boolean) {
  const texture = new THREE.CanvasTexture(element);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** Brushed-metal streaks running along texture u. */
export function brushedTexture(): THREE.Texture {
  const size = 512;
  const { element, context } = canvas(size);
  const random = seeded(7);
  context.fillStyle = '#dcdcdc';
  context.fillRect(0, 0, size, size);
  for (let i = 0; i < 1400; i++) {
    const y = random() * size;
    const x = random() * size;
    const length = 60 + random() * 420;
    const light = random() > 0.5;
    context.strokeStyle = light
      ? `rgba(255,255,255,${0.05 + random() * 0.12})`
      : `rgba(40,48,60,${0.03 + random() * 0.07})`;
    context.lineWidth = 0.6 + random() * 1.4;
    for (const dy of [0, y > size - 3 ? -size : y < 3 ? size : 0]) {
      for (const dx of [0, -size]) {
        context.beginPath();
        context.moveTo(x + dx, y + dy);
        context.lineTo(x + dx + length, y + dy);
        context.stroke();
      }
    }
  }
  return finish(element, true);
}

/** Concentric lathe-turned finish for disks (uv spans the disk). */
export function turnedTexture(): THREE.Texture {
  const size = 256;
  const { element, context } = canvas(size);
  const random = seeded(11);
  context.fillStyle = '#d8d8d8';
  context.fillRect(0, 0, size, size);
  for (let r = size / 2; r > 1; r -= 0.75) {
    const shade = 190 + Math.round(random() * 60);
    context.strokeStyle = `rgba(${shade},${shade},${shade + 4},0.55)`;
    context.lineWidth = 0.9;
    context.beginPath();
    context.arc(size / 2, size / 2, r, 0, Math.PI * 2);
    context.stroke();
  }
  const sheen = context.createLinearGradient(0, 0, size, size);
  sheen.addColorStop(0, 'rgba(255,255,255,0.22)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
  sheen.addColorStop(1, 'rgba(0,0,0,0.12)');
  context.fillStyle = sheen;
  context.fillRect(0, 0, size, size);
  return finish(element, false);
}

/** 45 degree section hatch for grounded (fixed) parts. */
export function hatchTexture(): THREE.Texture {
  const size = 64;
  const { element, context } = canvas(size);
  context.fillStyle = '#9a9a9a';
  context.fillRect(0, 0, size, size);
  context.strokeStyle = '#ececec';
  context.lineWidth = 5;
  for (let k = -size; k <= size * 2; k += size / 2) {
    context.beginPath();
    context.moveTo(k, 0);
    context.lineTo(k - size, size);
    context.stroke();
  }
  return finish(element, true);
}

// ---------------------------------------------------------------------------
// Blueprint ground: an anti-aliased analytic grid that works at any zoom and
// in the tilted perspective view.

export function groundMaterial(workspace: number): THREE.ShaderMaterial {
  const linear = (hex: number) => new THREE.Color(hex);
  return new THREE.ShaderMaterial({
    uniforms: {
      uOuter: { value: linear(COLOR.ground) },
      uField: { value: linear(COLOR.field) },
      uLine: { value: linear(COLOR.grid) },
      uHalf: { value: workspace },
    },
    vertexShader: /* glsl */ `
      varying vec2 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xy;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uOuter;
      uniform vec3 uField;
      uniform vec3 uLine;
      uniform float uHalf;
      varying vec2 vWorld;
      float gridLine(vec2 p, float spacing, float width) {
        vec2 c = p / spacing;
        vec2 w = max(fwidth(c), vec2(1e-6));
        vec2 g = abs(fract(c - 0.5) - 0.5) / w;
        return 1.0 - min(min(g.x, g.y) / width, 1.0);
      }
      void main() {
        vec2 p = vWorld;
        float px = max(max(fwidth(p.x), fwidth(p.y)), 1e-6);
        float edge = max(abs(p.x), abs(p.y)) - uHalf;
        float inside = 1.0 - smoothstep(-px, px, edge);
        float far = 1.0 - smoothstep(0.0, 9.0, edge);
        float minor = gridLine(p, 0.5, 1.0) * 0.045 * smoothstep(5.0, 11.0, 0.5 / px);
        float major = gridLine(p, 1.0, 1.0) * 0.085 * smoothstep(4.0, 9.0, 1.0 / px);
        float block = gridLine(p, 4.0, 1.25) * 0.13;
        vec2 a = abs(p) / vec2(max(fwidth(p.x), 1e-6), max(fwidth(p.y), 1e-6));
        float axis = (1.0 - min(min(a.x, a.y) / 1.25, 1.0)) * 0.2;
        float lines = max(max(minor, major), max(block, axis));
        lines *= mix(0.35, 1.0, inside) * far;
        float glow = (1.0 - smoothstep(0.0, uHalf * 1.35, length(p))) * inside;
        vec3 base = mix(uOuter, uField * (1.0 + 0.35 * glow), inside);
        gl_FragColor = vec4(mix(base, uLine, lines), 1.0);
        #include <colorspace_fragment>
      }`,
    depthWrite: true,
  });
}

/** Distance from a world point to a shape on a posed body (0 when inside). */
export function shapeDistance(shape: Shape, pose: Pose, point: Vec2): number {
  const center = toWorld(pose, shape.offset ?? [0, 0]);
  const [x, y] = rotate(
    [point[0] - center[0], point[1] - center[1]],
    -(pose.angle + (shape.angle ?? 0)),
  );
  if (shape.type === 'ball')
    return Math.max(0, Math.hypot(x, y) - shape.radius);
  if (shape.type === 'box')
    return Math.hypot(
      Math.max(Math.abs(x) - shape.half[0], 0),
      Math.max(Math.abs(y) - shape.half[1], 0),
    );
  const v = shape.vertices;
  let inside = true,
    best = Infinity;
  for (let i = 0; i < v.length; i++) {
    const a = v[i],
      b = v[(i + 1) % v.length];
    const ex = b[0] - a[0],
      ey = b[1] - a[1];
    if (ex * (y - a[1]) - ey * (x - a[0]) < 0) inside = false;
    const t = clamp(
      ((x - a[0]) * ex + (y - a[1]) * ey) / (ex * ex + ey * ey || 1),
      0,
      1,
    );
    best = Math.min(best, Math.hypot(x - a[0] - ex * t, y - a[1] - ey * t));
  }
  return inside ? 0 : best;
}
