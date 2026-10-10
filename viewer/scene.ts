/**
 * Read-only Three.js renderer for a candidate machine and the fixed harness.
 *
 * The view is a top-down orthographic "blueprint" by default so geometry reads
 * exactly; depth, bevels and shadows are decoration only (physics is 2D).
 *
 *   const scene = new MachineScene(container, { onSelect, onHover });
 *   scene.setMachine(machine);   // rebuild candidate parts + joint glyphs
 *   scene.update(snapshot);      // per frame: poses, springs, gauges, crank
 *   scene.highlight('lever');    // '' clears
 *   scene.setInsets({ top, bottom, left, right }); // host overlays (CSS px)
 *   scene.fit();                 // toggle: fit the machine ⇄ the workspace
 *   scene.setTilt(true);         // optional 3/4 perspective view
 *   scene.dispose();
 *
 * Framing: by default the view fits the machine (its parts, their reachable
 * sweep and the fixed harness) rather than the whole [-12, 12]² workspace,
 * keeping clear of the host's corner overlays; fit() toggles between the
 * two. Interaction: wheel / trackpad pinch zooms toward the cursor, drag
 * pans, two-finger touch pinches, double-click toggles the fit. Click reports
 * a part id via `onSelect` (empty string for empty space). Hover reports the
 * part and the pointer position in CSS pixels relative to the container via
 * `onHover`. Keyboard (canvas focused): + / - zoom, Shift + arrows pan, 0 or
 * F fit (plain arrows are left to the host, e.g. for stepping). Tilt is left
 * to the host (setTilt) so its toggle state has a single owner.
 *
 * Rendering happens on demand (after update or interaction), never in a
 * perpetual animation loop.
 *
 * Legend: brushed steel = dynamic part; hatched gunmetal = fixed part (also
 * used for a part locked by an intervention); red dashed outline labelled
 * "removed" = part removed by an intervention; cyan = input (ghost sockets at both bit positions);
 * brass = output gauge (dim in the 0 zone, glowing in the 1 zone, magenta
 * when ambiguous) over a 0 / 1 zone scale; orange disk = crank, with a drive
 * arc that lights up while torque is applied. Ring + dot = hinge (plus an
 * arc with a needle when limited); diamond = weld; dark slot with end stops =
 * prismatic rail in body A's frame; zig-zag = spring (warm when stretched,
 * blue when compressed); hatched foot = anchored to $ground.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  CRANK,
  INPUTS,
  LIMITS,
  OUTPUTS,
  SETTINGS,
} from '../simulator/protocol';
import type { Joint, Machine, Shape } from '../simulator/schema';
import type { Snapshot } from '../simulator/world';
import {
  COLOR,
  CSS,
  DEPTH,
  GROUND_POSE,
  LineMaterial,
  LineSegments2,
  LineSegmentsGeometry,
  bandHeights,
  brushedTexture,
  circlePoints,
  arcPoints,
  clamp,
  contourWidth,
  dim,
  fillGeometry,
  groundMaterial,
  hatchTexture,
  lerp,
  lineObject,
  pushPolyline,
  rotate,
  shapeContour,
  shapeDistance,
  slabGeometry,
  slotContour,
  toWorld,
  turnedTexture,
  writeSegments,
  type Pose,
  type Vec2,
} from './scene-kit';

export type HoverInfo = { id: string; label?: string; x: number; y: number };
export type SceneOptions = {
  /** A part was clicked (its id), or empty space was clicked (''). */
  onSelect?: (id: string) => void;
  /** Pointer over a part (x, y: CSS px relative to the container), or null. */
  onHover?: (info: HoverInfo | null) => void;
  /** The framing changed: fitted to the machine or workspace, or null once
   * the user pans or zooms by hand. */
  onFitChange?: (mode: FitMode | null) => void;
};
export type FitMode = 'machine' | 'workspace';
/** Screen space (CSS px from each edge of the container) covered by the
 * host's own overlays. Fitting keeps content clear of either the top band
 * (`top`) or the two top-corner columns (`left` / `right`), whichever leaves
 * the larger view, and always of the bottom band. */
export type Insets = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};
type Box = [number, number, number, number];

// Harness geometry mirrors simulator/world.ts (the frozen physics source).
const INPUT_HALF: Vec2 = [0.18, 0.35];
const OUTPUT_HALF: Vec2 = [0.28, 0.28];
const ZONE_ZERO: Vec2 = [-0.05, SETTINGS.zeroMax];
const ZONE_ONE: Vec2 = [SETTINGS.oneMin, 1.05];

const WORKSPACE = LIMITS.workspace;
/** Half-extent framed by the workspace fit: the workspace plus its ticks. */
const FIT_HALF = WORKSPACE + 0.3;
/** World box of the fixed harness drawn around every machine: input sockets
 * at both bit positions, gauges with their zone scales, the crank, its drive
 * arc and label. Pixel-sized labels beside it are covered by FIT_PAD_PX. */
const HARNESS_BOX: Box = [-9.3, -7.45, 9.75, 5.0];
/** Extra CSS px around the machine fit for labels anchored at its edges
 * (input names on the left, gauge readouts on the right). */
const FIT_PAD_PX = { left: 30, right: 66, top: 10, bottom: 12 };
/** Below this zoom (px per unit) the rulers hide and readouts go compact. */
const COMPACT_SCALE = 18;
const MAX_SCALE = 560;
/** 3/4 view: camera pitch and yaw (rad), field of view (deg), and how much
 * closer the camera moves at full tilt, since foreshortening would otherwise
 * leave the machine small on a large tilted plane. */
const TILT = { pitch: 0.96, yaw: -0.36, fov: 28, zoom: 0.25 };
const PIN_R = 0.095;
/** Outline width (px) of candidate parts. */
const EDGE_W = 1.7;
/** Parts thinner than this (world units) get a light outline so they read
 * as bright bars instead of dark hairlines at workspace zoom. */
const SLENDER = 0.09;
/** Joint anchors farther than this from their body's geometry get a tether. */
const TETHER_MIN = 0.25;
const LIMIT_R = 0.26;
const SPRING_TURNS = 11;
const GAUGE_SCALE_DY = -0.58;
// Stencil ids for additive halos: each halo covers a pixel at most once, so
// the overlapping round caps of its segments never double-blend into beads.
const HALO = { input: 1, gauge: 2, select: 3 } as const;

type Style = Partial<Record<string, string>>;
type PartKind = 'candidate' | 'input' | 'output' | 'crank';
type GaugeState = 'zero' | 'one' | 'ambiguous';
type View = { cx: number; cy: number; scale: number };

type PartView = {
  id: string;
  kind: PartKind;
  label?: string;
  fixed: boolean;
  shapes: Shape[];
  group: THREE.Group;
  fills: THREE.Mesh[];
  fillMaterials: THREE.Material[];
  outline: LineSegments2;
  glow: LineSegments2;
  aura?: LineSegments2;
  edge: LineMaterial;
  top: number;
  locked: boolean;
  slender: boolean;
  ghost?: LineSegments2;
};

type JointView = {
  a: string;
  b: string;
  root: THREE.Object3D;
  place: (a: Pose, b: Pose) => void;
};

type SpringView = {
  line: LineSegments2;
  material: LineMaterial;
  ends: [THREE.Object3D, THREE.Object3D];
  from: Vec2;
  to: Vec2;
  rest: number;
  z: number;
  segments: Float32Array;
};

/** A joint/fixture symbol kept legible when zoomed out: it is enlarged (up to
 * 2.6×) so that `radius` spans at least `minPx` pixels, and optionally hidden
 * entirely while `radius` would be smaller than `hideBelowPx` pixels. */
type Glyph = {
  object: THREE.Object3D;
  radius: number;
  minPx: number;
  hideBelowPx?: number;
};

type Label = {
  el: HTMLElement;
  at: THREE.Vector3;
  align: 'left' | 'center' | 'right';
  /** 'middle' centres the label on its point; 'top' hangs it below. */
  valign: 'middle' | 'top';
  /** Constant screen-space offset in CSS px (independent of zoom). */
  nudge: Vec2;
  minScale: number;
  last: string;
};

type Gauge = {
  part: PartView;
  material: THREE.MeshStandardMaterial;
  marker: THREE.Mesh;
  markerMaterial: THREE.MeshBasicMaterial;
  value: HTMLElement;
  readout: HTMLElement;
  state: GaugeState | '';
};

const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

const fixtureLabel = (id: string) => {
  const input = INPUTS.find((x) => x.id === id);
  if (input)
    return `Input ${id.slice(1).toUpperCase()} · ${input.word ? 'B' : 'A'} bit ${input.bit}`;
  const output = OUTPUTS.findIndex((x) => x.id === id);
  if (output >= 0) return `Output S${output} · sum bit ${output}`;
  if (id === CRANK.id) return 'Crank · driven input';
  return undefined;
};

function applyStyle(el: HTMLElement, style: Style) {
  for (const [key, value] of Object.entries(style))
    if (value !== undefined) el.style.setProperty(key, value);
}

/**
 * World box to frame for a machine: the harness plus every part at its
 * starting pose and, where a part hangs on a ground or crank joint, the
 * region it can sweep (a hinge's arc, the crank's circle, a rail's travel).
 * Parts further down a linkage are covered by the fit's margin.
 */
function machineBounds(machine: Machine): Box {
  const box: Box = [...HARNESS_BOX];
  const add = ([x, y]: Vec2) => {
    box[0] = Math.min(box[0], x);
    box[1] = Math.min(box[1], y);
    box[2] = Math.max(box[2], x);
    box[3] = Math.max(box[3], y);
  };
  const points = new Map<string, Vec2[]>();
  for (const body of machine.bodies) {
    const pose = {
      x: body.position[0],
      y: body.position[1],
      angle: body.angle ?? 0,
    };
    const list = body.shapes.flatMap((shape) =>
      shapeContour(shape).map((p) => toWorld(pose, p)),
    );
    points.set(body.id, list);
    list.forEach(add);
  }
  const crank: Vec2 = [CRANK.x, CRANK.y];
  const sweep = (list: Vec2[], center: Vec2, lo: number, hi: number) => {
    const n = Math.max(2, Math.ceil(((hi - lo) / (Math.PI * 2)) * 24));
    for (let k = 0; k <= n; k++) {
      const t = lo + ((hi - lo) * k) / n;
      for (const p of list) {
        const r = rotate([p[0] - center[0], p[1] - center[1]], t);
        add([center[0] + r[0], center[1] + r[1]]);
      }
    }
  };
  for (const joint of machine.joints) {
    const onA = joint.a === '$ground' || joint.a === CRANK.id;
    const onB = joint.b === '$ground' || joint.b === CRANK.id;
    if (onA === onB) continue;
    const pivotId = onA ? joint.a : joint.b;
    const list = points.get(onA ? joint.b : joint.a);
    if (!list) continue;
    if (pivotId === CRANK.id && joint.type !== 'spring')
      sweep(list, crank, 0, Math.PI * 2);
    else if (joint.type === 'revolute') {
      const anchor = onA ? joint.anchorA : joint.anchorB;
      // Limits are B's rotation relative to A.
      const [lo, hi] = joint.limits ?? [-Math.PI, Math.PI];
      if (onA) sweep(list, anchor, lo, hi);
      else sweep(list, anchor, -hi, -lo);
    } else if (joint.type === 'prismatic' && onA)
      for (const t of joint.limits)
        for (const p of list)
          add([p[0] + joint.axis[0] * t, p[1] + joint.axis[1] * t]);
  }
  const limit = WORKSPACE + 0.3;
  return [
    Math.max(-limit, box[0]),
    Math.max(-limit, box[1]),
    Math.min(limit, box[2]),
    Math.min(limit, box[3]),
  ];
}

/** Stacking layers so that bodies which can legitimately overlap (joined by a
 * non-spring joint, or static supports) never share a height. */
function assignLayers(machine: Machine): Map<string, number> {
  const layer = new Map<string, number>();
  const fixed = new Map<string, boolean>();
  for (const id of [CRANK.id, ...OUTPUTS.map((o) => o.id)]) {
    layer.set(id, 0);
    fixed.set(id, false);
  }
  for (const input of INPUTS) {
    layer.set(input.id, 0);
    fixed.set(input.id, true);
  }
  for (const b of machine.bodies) fixed.set(b.id, b.type === 'fixed');
  const links = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    if (!links.has(a)) links.set(a, new Set());
    if (!links.has(b)) links.set(b, new Set());
    links.get(a)!.add(b);
    links.get(b)!.add(a);
  };
  for (const j of machine.joints)
    if (j.type !== 'spring' && j.a !== '$ground' && j.b !== '$ground')
      link(j.a, j.b);
  const boxes: { id: string; box: [number, number, number, number] }[] =
    INPUTS.map((i) => ({
      id: i.id,
      box: [
        i.x - INPUT_HALF[0],
        i.y - INPUT_HALF[1],
        i.x + SETTINGS.inputTravel + INPUT_HALF[0],
        i.y + INPUT_HALF[1],
      ],
    }));
  for (const body of machine.bodies) {
    if (body.type !== 'fixed') continue;
    const pose = {
      x: body.position[0],
      y: body.position[1],
      angle: body.angle ?? 0,
    };
    const box: [number, number, number, number] = [
      Infinity,
      Infinity,
      -Infinity,
      -Infinity,
    ];
    for (const shape of body.shapes)
      for (const p of shapeContour(shape)) {
        const [x, y] = toWorld(pose, p);
        box[0] = Math.min(box[0], x);
        box[1] = Math.min(box[1], y);
        box[2] = Math.max(box[2], x);
        box[3] = Math.max(box[3], y);
      }
    boxes.push({ id: body.id, box });
  }
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i].box, boxes[j].box];
      if (a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3])
        link(boxes[i].id, boxes[j].id);
    }
  for (const body of machine.bodies) {
    const used = new Set<number>();
    for (const other of links.get(body.id) ?? [])
      if (layer.has(other) && fixed.get(other) === (body.type === 'fixed'))
        used.add(layer.get(other)!);
    let k = 0;
    while (used.has(k)) k++;
    layer.set(body.id, k);
  }
  return layer;
}

export class MachineScene {
  #container: HTMLElement;
  #options: SceneOptions;
  #renderer: THREE.WebGLRenderer;
  #canvas: HTMLCanvasElement;
  #scene = new THREE.Scene();
  #ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  #persp = new THREE.PerspectiveCamera(TILT.fov, 1, 0.1, 800);
  #raycaster = new THREE.Raycaster();
  #groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  #observer: ResizeObserver;
  #overlay: HTMLDivElement;
  #hud: { bar: HTMLDivElement; text: HTMLSpanElement; cursor: HTMLSpanElement };
  #title: Label;
  #environment: THREE.Texture;

  // Scene-lifetime resources.
  #textures: THREE.Texture[] = [];
  #materials: THREE.Material[] = [];
  #lineMaterials = new Map<string, LineMaterial>();
  #fixtureTrash: { dispose(): void }[] = [];
  #shared: Record<string, THREE.BufferGeometry | LineSegmentsGeometry> = {};
  #m: {
    steel: THREE.MeshStandardMaterial;
    steelTurned: THREE.MeshStandardMaterial;
    gunmetal: THREE.MeshStandardMaterial;
    input: THREE.MeshStandardMaterial;
    crank: THREE.MeshStandardMaterial;
    glyphDark: THREE.MeshBasicMaterial;
    glyphLight: THREE.MeshBasicMaterial;
    railFill: THREE.MeshBasicMaterial;
    railFillBody: THREE.MeshBasicMaterial;
    driveArrow: THREE.MeshBasicMaterial;
  };

  // Content.
  #fixtures = new THREE.Group();
  #machineRoot = new THREE.Group();
  #machineTrash: { dispose(): void }[] = [];
  #machineKey = '';
  #machine: Machine | null = null;
  #parts = new Map<string, PartView>();
  #joints: JointView[] = [];
  #springs: SpringView[] = [];
  #fixtureGlyphs: Glyph[] = [];
  #machineGlyphs: Glyph[] = [];
  #labels: Label[] = [];
  #machineLabels: Label[] = [];
  #gauges: Gauge[] = [];
  #drive!: { group: THREE.Group; arc: LineMaterial; direction: number };
  #ghostLabels = new Map<string, Label>();
  #bounds: Box = [...HARNESS_BOX];
  #poses = new Map<string, Pose>();
  #types = new Map<string, string>();
  #tops = new Map<string, number>();

  // View state.
  #width = 0;
  #height = 0;
  #view: View = { cx: 0, cy: 0, scale: 20 };
  #insets: Insets = { top: 0, bottom: 0, left: 0, right: 0 };
  #fitMode: FitMode = 'machine';
  #tilt = 0;
  #tiltOn = false;
  #userMoved = false;
  #tween: { from: View; to: View; start: number; duration: number } | null =
    null;
  #tiltTween: {
    from: number;
    to: number;
    start: number;
    duration: number;
  } | null = null;
  #glyphScaleFor = 0;
  #springsDirty = true;
  #compact = false;
  #raf = 0;
  #hoverRaf = 0;
  #disposed = false;

  // Interaction state.
  #selected = '';
  #hovered = '';
  #pointers = new Map<number, Vec2>();
  #drag: { moved: boolean; start: Vec2 } | null = null;
  #hoverPoint: Vec2 | null = null;

  constructor(container: HTMLElement, options: SceneOptions = {}) {
    this.#container = container;
    this.#options = options;
    this.#renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      stencil: true,
      powerPreference: 'high-performance',
    });
    const renderer = this.#renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(COLOR.ground);
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    this.#canvas = renderer.domElement;
    // Absolutely positioned so the canvas never feeds back into the
    // container's layout size (the container alone decides the viewport).
    applyStyle(this.#canvas, {
      position: 'absolute',
      inset: '0',
      display: 'block',
      width: '100%',
      height: '100%',
      'touch-action': 'none',
      outline: 'none',
      cursor: 'default',
    });
    this.#canvas.tabIndex = 0;
    this.#canvas.setAttribute('role', 'img');
    this.#canvas.setAttribute(
      'aria-label',
      'Machine view. Drag to pan, scroll or pinch to zoom, double-click to switch between fitting the machine and the workspace, click a part to select it.',
    );
    if (getComputedStyle(container).position === 'static')
      container.style.position = 'relative';
    container.appendChild(this.#canvas);

    this.#overlay = document.createElement('div');
    this.#overlay.className = 'mcl-overlay';
    applyStyle(this.#overlay, {
      position: 'absolute',
      inset: '0',
      overflow: 'hidden',
      'pointer-events': 'none',
      'font-family': CSS.mono,
      'user-select': 'none',
    });
    const vignette = document.createElement('div');
    applyStyle(vignette, {
      position: 'absolute',
      inset: '0',
      background:
        'radial-gradient(125% 95% at 50% 46%, rgba(3,6,14,0) 58%, rgba(3,6,14,0.5) 100%)',
    });
    this.#overlay.appendChild(vignette);
    container.appendChild(this.#overlay);
    this.#hud = this.#makeHud();

    // Lighting: a soft key light with shadows plus image-based reflections from
    // a locally generated studio environment (no network assets).
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    this.#environment = pmrem.fromScene(room, 0.03).texture;
    room.dispose();
    pmrem.dispose();
    this.#scene.environment = this.#environment;
    this.#scene.environmentIntensity = 0.75;
    this.#scene.environmentRotation.set(Math.PI / 2, 0, 0.4);
    const hemisphere = new THREE.HemisphereLight(0xcfdcff, 0x0a1020, 0.9);
    hemisphere.position.set(0, 0, 1);
    this.#scene.add(hemisphere);
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(-6, 8.5, 24);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, {
      left: -15,
      right: 15,
      top: 15,
      bottom: -15,
      near: 1,
      far: 60,
    });
    key.shadow.camera.updateProjectionMatrix();
    key.shadow.radius = 3;
    key.shadow.bias = -0.0004;
    this.#scene.add(key, key.target);
    const rim = new THREE.DirectionalLight(0x9fb8ff, 0.5);
    rim.position.set(8, -10, 7);
    this.#scene.add(rim);

    const brushed = brushedTexture(),
      turned = turnedTexture(),
      hatch = hatchTexture();
    this.#textures.push(brushed, turned, hatch, this.#environment);
    const standard = (p: THREE.MeshStandardMaterialParameters) =>
      this.#own(new THREE.MeshStandardMaterial(p));
    const basic = (p: THREE.MeshBasicMaterialParameters) =>
      this.#own(new THREE.MeshBasicMaterial({ toneMapped: false, ...p }));
    this.#m = {
      steel: standard({
        color: COLOR.steel,
        map: brushed,
        metalness: 0.55,
        roughness: 0.36,
        vertexColors: true,
      }),
      steelTurned: standard({
        color: COLOR.steel,
        map: turned,
        metalness: 0.6,
        roughness: 0.3,
        vertexColors: true,
      }),
      gunmetal: standard({
        color: COLOR.gunmetal,
        map: hatch,
        metalness: 0.3,
        roughness: 0.62,
        vertexColors: true,
      }),
      input: standard({
        color: COLOR.inputBody,
        emissive: COLOR.input,
        emissiveIntensity: 0.85,
        metalness: 0.1,
        roughness: 0.3,
      }),
      crank: standard({
        color: COLOR.crank,
        map: turned,
        metalness: 0.4,
        roughness: 0.34,
        emissive: 0x3a0e00,
      }),
      glyphDark: basic({ color: COLOR.pinFill }),
      glyphLight: basic({ color: COLOR.pin }),
      railFill: basic({
        color: COLOR.railFill,
        transparent: true,
        opacity: 0.88,
        depthWrite: false,
      }),
      // A slot cut into a moving part: translucent so the part still reads.
      railFillBody: basic({
        color: COLOR.railFill,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
      driveArrow: basic({ color: COLOR.crank, side: THREE.DoubleSide }),
    };
    this.#buildSharedGlyphs();

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(260, 260),
      this.#own(groundMaterial(WORKSPACE)),
    );
    ground.renderOrder = -2;
    const catcher = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * WORKSPACE + 2, 2 * WORKSPACE + 2),
      this.#own(new THREE.ShadowMaterial({ opacity: 0.5, depthWrite: false })),
    );
    catcher.position.z = 0.004;
    catcher.receiveShadow = true;
    this.#fixtureTrash.push(ground.geometry, catcher.geometry);
    this.#scene.add(ground, catcher, this.#fixtures, this.#machineRoot);
    this.#buildFrame();
    this.#buildFixtures();
    // Hangs inside the frame's top-left corner at every zoom.
    this.#title = this.#label('', -WORKSPACE, WORKSPACE, {
      align: 'left',
      valign: 'top',
      nudge: [12, 10],
      style: { color: CSS.label, 'font-size': '12px', 'line-height': '1.3' },
    });
    this.#title.el.style.display = 'none';
    this.#defaultFixturePoses();
    this.#applyPoses();

    this.#observer = new ResizeObserver(() => this.#resize());
    this.#observer.observe(container);
    const c = this.#canvas;
    c.addEventListener('pointerdown', this.#onPointerDown);
    c.addEventListener('pointermove', this.#onPointerMove);
    c.addEventListener('pointerup', this.#onPointerUp);
    c.addEventListener('pointercancel', this.#onPointerUp);
    c.addEventListener('pointerleave', this.#onPointerLeave);
    c.addEventListener('wheel', this.#onWheel, { passive: false });
    c.addEventListener('dblclick', this.#onDoubleClick);
    c.addEventListener('keydown', this.#onKey);
    this.#resize();
  }

  // -------------------------------------------------------------------------
  // Public API

  /** Rebuilds candidate parts and joint glyphs. Harness fixtures always stay. */
  setMachine(machine: Machine | null): void {
    if (this.#disposed) return;
    const key = machine ? JSON.stringify(machine) : '';
    if (key === this.#machineKey) {
      if (machine) this.#resetCandidatePoses();
      this.#invalidate();
      return;
    }
    this.#clearMachine();
    this.#machineKey = key;
    this.#machine = machine;
    if (!machine) {
      this.#title.el.style.display = 'none';
      this.#invalidate();
      return;
    }
    const layers = assignLayers(machine);
    for (const body of machine.bodies) {
      const pose = {
        x: body.position[0],
        y: body.position[1],
        angle: body.angle ?? 0,
      };
      const part = this.#makePart(
        {
          id: body.id,
          kind: 'candidate',
          fixed: body.type === 'fixed',
          shapes: body.shapes,
          layer: layers.get(body.id) ?? 0,
          label: body.label,
        },
        this.#machineRoot,
        this.#machineTrash,
      );
      const ghost: number[] = [];
      for (const shape of body.shapes)
        pushPolyline(
          ghost,
          shapeContour(shape).map((p) => toWorld(pose, p)),
          0.016,
          true,
        );
      part.ghost = lineObject(
        ghost,
        this.#line(COLOR.removed, 2, {
          dashed: true,
          dashSize: 0.12,
          gapSize: 0.08,
        }),
      );
      part.ghost.visible = false;
      this.#machineTrash.push(part.ghost.geometry);
      this.#machineRoot.add(part.ghost);
      const ghostLabel = this.#label('removed', pose.x, pose.y, {
        z: 0.3,
        style: {
          color: CSS.removed,
          'font-size': '11px',
          'font-weight': '700',
          'text-transform': 'uppercase',
          'letter-spacing': '0.1em',
        },
      });
      ghostLabel.el.style.display = 'none';
      this.#machineLabels.push(ghostLabel);
      this.#ghostLabels.set(body.id, ghostLabel);
      this.#poses.set(body.id, pose);
    }
    for (const joint of machine.joints) {
      const view = this.#makeJoint(joint);
      if (view) this.#joints.push(this.#withTethers(joint, view));
    }
    const parts = machine.bodies.length,
      joints = machine.joints.length;
    this.#title.el.replaceChildren(
      Object.assign(document.createElement('div'), {
        textContent: machine.name.toUpperCase(),
      }),
      Object.assign(document.createElement('div'), {
        textContent: `${parts} part${parts === 1 ? '' : 's'} · ${joints} joint${joints === 1 ? '' : 's'}`,
        style: `color:${CSS.dim};margin-top:4px;font-size:11px`,
      }),
    );
    this.#title.el.style.display = '';
    this.#title.last = '';
    this.#glyphScaleFor = 0;
    this.#applyPoses();
    if (this.#selected) this.highlight(this.#selected);
    // Frame the new machine (unless the user has taken over the view).
    this.#bounds = machineBounds(machine);
    if (!this.#userMoved) this.#animateTo(this.#fitView(), 420);
    this.#invalidate();
  }

  /** Per-frame state: body poses, spring coils, gauge glow and crank drive. */
  update(snapshot: Snapshot): void {
    if (this.#disposed) return;
    this.#poses.clear();
    this.#types.clear();
    for (const body of snapshot.bodies) {
      if (![body.x, body.y, body.angle].every(Number.isFinite)) continue;
      this.#poses.set(body.id, { x: body.x, y: body.y, angle: body.angle });
      this.#types.set(body.id, body.type);
    }
    this.#applyPoses();
    snapshot.output.gauges.forEach((gauge, i) => {
      if (this.#gauges[i])
        this.#setGauge(
          this.#gauges[i],
          gauge.bit === 1 ? 'one' : gauge.bit === 0 ? 'zero' : 'ambiguous',
        );
    });
    const driving = Math.abs(snapshot.torque) > 1e-9;
    if (driving) this.#drive.direction = Math.sign(snapshot.torque);
    this.#drive.group.scale.x = this.#drive.direction;
    const drive = dim(COLOR.crank, driving ? 1 : 0.35);
    this.#drive.arc.color.set(drive);
    this.#m.driveArrow.color.set(drive);
    this.#invalidate();
  }

  /** Emphasises one part ('' clears). */
  highlight(id: string): void {
    if (this.#disposed) return;
    const previous = this.#selected;
    this.#selected = id;
    for (const pid of [previous, id]) {
      const part = this.#parts.get(pid);
      if (part) this.#restyle(part);
    }
    this.#invalidate();
  }

  /**
   * Fits the view. Without an argument it toggles: after panning or zooming
   * it returns to the machine; from the machine fit it shows the whole
   * workspace, and back.
   */
  fit(mode?: FitMode): void {
    if (this.#disposed) return;
    const next =
      mode ??
      (!this.#userMoved && this.#fitMode === 'machine'
        ? 'workspace'
        : 'machine');
    this.#fitMode = next;
    this.#userMoved = false;
    this.#animateTo(this.#fitView(), 450);
    this.#options.onFitChange?.(next);
  }

  /** Screen areas covered by the host's overlays (see Insets). */
  setInsets(insets: Insets): void {
    if (this.#disposed) return;
    const old = this.#insets;
    if (
      old.top === insets.top &&
      old.bottom === insets.bottom &&
      old.left === insets.left &&
      old.right === insets.right
    )
      return;
    this.#insets = { ...insets };
    if (!this.#userMoved) {
      this.#tween = null;
      this.#view = this.#fitView();
    }
    this.#invalidate();
  }

  /** Optional dramatic 3/4 perspective view (true) or the exact plan (false). */
  setTilt(on: boolean): void {
    if (this.#disposed || on === this.#tiltOn) return;
    this.#tiltOn = on;
    this.#tiltTween = {
      from: this.#tilt,
      to: on ? 1 : 0,
      start: performance.now(),
      duration: 750,
    };
    this.#invalidate();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    cancelAnimationFrame(this.#raf);
    cancelAnimationFrame(this.#hoverRaf);
    this.#observer.disconnect();
    const c = this.#canvas;
    c.removeEventListener('pointerdown', this.#onPointerDown);
    c.removeEventListener('pointermove', this.#onPointerMove);
    c.removeEventListener('pointerup', this.#onPointerUp);
    c.removeEventListener('pointercancel', this.#onPointerUp);
    c.removeEventListener('pointerleave', this.#onPointerLeave);
    c.removeEventListener('wheel', this.#onWheel);
    c.removeEventListener('dblclick', this.#onDoubleClick);
    c.removeEventListener('keydown', this.#onKey);
    this.#clearMachine();
    for (const item of this.#fixtureTrash) item.dispose();
    for (const geometry of Object.values(this.#shared)) geometry.dispose();
    for (const material of this.#materials) material.dispose();
    for (const material of this.#lineMaterials.values()) material.dispose();
    for (const texture of this.#textures) texture.dispose();
    this.#renderer.dispose();
    this.#renderer.forceContextLoss();
    this.#canvas.remove();
    this.#overlay.remove();
  }

  // -------------------------------------------------------------------------
  // Resources

  #own<T extends THREE.Material>(material: T): T {
    this.#materials.push(material);
    return material;
  }

  /** Shared pixel-width line material (cached by appearance). */
  #halo(color: number, width: number, opacity: number, ref: number) {
    return this.#line(color, width, {
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      stencilWrite: true,
      stencilRef: ref,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilZPass: THREE.ReplaceStencilOp,
    });
  }

  #line(
    color: number,
    width: number,
    extra: ConstructorParameters<typeof LineMaterial>[0] = {},
  ): LineMaterial {
    const key = JSON.stringify([color, width, extra]);
    let material = this.#lineMaterials.get(key);
    if (!material) {
      material = new LineMaterial({
        color,
        linewidth: width,
        toneMapped: false,
        ...extra,
      });
      this.#lineMaterials.set(key, material);
    }
    return material;
  }

  #buildSharedGlyphs() {
    const ring = (r: number, n = 28) =>
      (() => {
        const g = new LineSegmentsGeometry();
        g.setPositions(pushPolyline([], circlePoints([0, 0], r, n), 0, true));
        return g;
      })();
    const diamond = (r: number): Vec2[] => [
      [r, 0],
      [0, r],
      [-r, 0],
      [0, -r],
    ];
    const segments = (s: number[]) => {
      const g = new LineSegmentsGeometry();
      g.setPositions(s);
      return g;
    };
    // Ground symbol pointing along -y from the anchor.
    const groundLines: number[] = [
      0, 0, 0, 0, -0.13, 0, -0.15, -0.13, 0, 0.15, -0.13, 0,
    ];
    for (let i = 0; i < 4; i++) {
      const x = -0.12 + i * 0.08;
      groundLines.push(x, -0.13, 0, x - 0.06, -0.21, 0);
    }
    const carriage: Vec2[] = [
      [-0.11, -0.06],
      [0.11, -0.06],
      [0.11, 0.06],
      [-0.11, 0.06],
    ];
    this.#shared = {
      pinDisk: new THREE.CircleGeometry(PIN_R, 32),
      pinDot: new THREE.CircleGeometry(PIN_R * 0.32, 16),
      pinRing: ring(PIN_R, 32),
      weld: fillGeometry(diamond(0.1), 0),
      weldCore: fillGeometry(diamond(0.04), 0.002),
      weldEdge: segments(pushPolyline([], diamond(0.1), 0.001, true)),
      eyeDisk: new THREE.CircleGeometry(0.04, 16),
      eyeRing: ring(0.04, 16),
      ground: segments(groundLines),
      carriage: fillGeometry(carriage, 0),
      carriageEdge: segments(pushPolyline([], carriage, 0.001, true)),
      crosshair: segments([-0.09, 0, 0, 0.09, 0, 0, 0, -0.09, 0, 0, 0.09, 0]),
      marker: fillGeometry(
        [
          [0, 0],
          [0.075, 0.13],
          [-0.075, 0.13],
        ],
        0,
      ),
    };
  }

  #pinGlyph(z: number, grounded: boolean): THREE.Group {
    const s = this.#shared;
    const group = new THREE.Group();
    group.position.z = z;
    const disk = new THREE.Mesh(s.pinDisk, this.#m.glyphDark);
    const dot = new THREE.Mesh(s.pinDot, this.#m.glyphLight);
    dot.position.z = 0.002;
    const ring = new LineSegments2(
      s.pinRing as LineSegmentsGeometry,
      this.#line(grounded ? COLOR.rail : COLOR.pin, grounded ? 2.4 : 2),
    );
    ring.position.z = 0.001;
    group.add(disk, ring, dot);
    return group;
  }

  #groundGlyph(z: number, direction: Vec2): THREE.Object3D {
    const mark = new LineSegments2(
      this.#shared.ground as LineSegmentsGeometry,
      this.#line(COLOR.rail, 1.4),
    );
    mark.position.z = z;
    mark.rotation.z = Math.atan2(direction[1], direction[0]) + Math.PI / 2;
    return mark;
  }

  // -------------------------------------------------------------------------
  // Parts

  #steelEdge(slender: boolean): LineMaterial {
    return slender
      ? this.#line(COLOR.steelSlenderEdge, EDGE_W + 0.5)
      : this.#line(COLOR.steelEdge, EDGE_W);
  }

  #makePart(
    spec: {
      id: string;
      kind: PartKind;
      fixed: boolean;
      shapes: Shape[];
      layer: number;
      label?: string;
      material?: THREE.Material;
      edge?: LineMaterial;
    },
    root: THREE.Object3D,
    trash: { dispose(): void }[],
  ): PartView {
    const { bottom, top } = bandHeights(spec.fixed, spec.layer);
    const group = new THREE.Group();
    group.name = spec.id;
    const contours = spec.shapes.map((shape) => shapeContour(shape));
    // Brush along the body's long axis; vary the grain start per part.
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of contours.flat()) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
    const grain = maxY - minY > maxX - minX ? Math.PI / 2 : 0;
    let hash = 0;
    for (const ch of spec.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const shift = (hash % 1000) / 1000;
    const initial = this.#machine?.bodies.find((b) => b.id === spec.id);
    const worldPose: Pose = initial
      ? {
          x: initial.position[0],
          y: initial.position[1],
          angle: initial.angle ?? 0,
        }
      : GROUND_POSE;
    const fills: THREE.Mesh[] = [];
    spec.shapes.forEach((shape, index) => {
      const ball = shape.type === 'ball';
      let material: THREE.Material;
      let uv: (x: number, y: number) => Vec2;
      if (spec.material) material = spec.material;
      else if (spec.fixed) material = this.#m.gunmetal;
      else material = ball ? this.#m.steelTurned : this.#m.steel;
      if (spec.fixed && !spec.material) {
        uv = (x, y) => {
          const w = toWorld(worldPose, [x, y]);
          return [w[0] / 0.6, w[1] / 0.6];
        };
      } else if (ball) {
        const [ox, oy] = shape.offset ?? [0, 0];
        const r = shape.radius;
        uv = (x, y) => [(x - ox) / (2 * r) + 0.5, (y - oy) / (2 * r) + 0.5];
      } else
        uv = (x, y) => {
          const [u, v] = rotate([x, y], -grain);
          return [u / 3.2 + shift, v / 3.2 + shift * 3];
        };
      // A soft diagonal sheen across the whole body reads as polished metal.
      const halfW = Math.max((maxX - minX) / 2, 0.05),
        halfH = Math.max((maxY - minY) / 2, 0.05);
      const midX = (minX + maxX) / 2,
        midY = (minY + maxY) / 2;
      const shade = (x: number, y: number) =>
        0.97 +
        0.11 * (0.62 * ((y - midY) / halfH) - 0.38 * ((x - midX) / halfW));
      const geometry = slabGeometry(contours[index], bottom, top, uv, shade);
      trash.push(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.part = spec.id;
      group.add(mesh);
      fills.push(mesh);
    });
    const slender = contours.some((c) => contourWidth(c) < SLENDER);
    const edgeMaterial =
      spec.edge ??
      (spec.fixed
        ? this.#line(COLOR.gunmetalEdge, EDGE_W)
        : this.#steelEdge(slender));
    const outline = lineObject(
      contours.reduce<number[]>(
        (out, contour) => pushPolyline(out, contour, top + 0.004, true),
        [],
      ),
      edgeMaterial,
    );
    trash.push(outline.geometry);
    const glow = new LineSegments2(
      outline.geometry,
      this.#halo(COLOR.select, 10, 0.32, HALO.select),
    );
    glow.position.z = -DEPTH.thickness / 2 - 0.004;
    glow.visible = false;
    group.add(outline, glow);
    root.add(group);
    const part: PartView = {
      id: spec.id,
      kind: spec.kind,
      label: spec.label ?? fixtureLabel(spec.id),
      fixed: spec.fixed,
      shapes: spec.shapes,
      group,
      fills,
      fillMaterials: fills.map((m) => m.material as THREE.Material),
      outline,
      glow,
      edge: edgeMaterial,
      top,
      locked: false,
      slender,
    };
    this.#parts.set(spec.id, part);
    this.#tops.set(spec.id, top);
    return part;
  }

  #restyle(part: PartView) {
    const selected = part.id === this.#selected && part.group.visible;
    part.outline.material = selected
      ? this.#line(COLOR.select, 3)
      : part.id === this.#hovered
        ? this.#line(COLOR.hover, 2.4)
        : part.edge;
    part.glow.visible = selected;
  }

  #defaultFixturePoses() {
    for (const f of [...INPUTS, ...OUTPUTS, CRANK])
      this.#poses.set(f.id, { x: f.x, y: f.y, angle: 0 });
  }

  #resetCandidatePoses() {
    for (const body of this.#machine?.bodies ?? [])
      this.#poses.set(body.id, {
        x: body.position[0],
        y: body.position[1],
        angle: body.angle ?? 0,
      });
    this.#applyPoses();
  }

  #clearMachine() {
    for (const part of this.#parts.values())
      if (part.kind === 'candidate') {
        this.#parts.delete(part.id);
        this.#tops.delete(part.id);
      }
    this.#machineRoot.clear();
    for (const item of this.#machineTrash) item.dispose();
    for (const spring of this.#springs) spring.material.dispose();
    this.#machineTrash = [];
    this.#joints = [];
    this.#springs = [];
    this.#machineGlyphs = [];
    for (const label of this.#machineLabels) label.el.remove();
    this.#labels = this.#labels.filter((l) => !this.#machineLabels.includes(l));
    this.#machineLabels = [];
    this.#ghostLabels.clear();
    this.#machine = null;
    this.#machineKey = '';
    if (this.#hovered && !this.#parts.has(this.#hovered)) this.#hovered = '';
  }

  #applyPoses() {
    for (const part of this.#parts.values()) {
      const pose = this.#poses.get(part.id);
      const ghostLabel = this.#ghostLabels.get(part.id);
      if (!pose) {
        // Absent from the snapshot (removed by an intervention): show a ghost.
        part.group.visible = false;
        if (part.ghost) part.ghost.visible = true;
        if (ghostLabel) ghostLabel.el.style.display = '';
        continue;
      }
      part.group.visible = true;
      if (part.ghost) part.ghost.visible = false;
      if (ghostLabel) ghostLabel.el.style.display = 'none';
      part.group.position.set(pose.x, pose.y, 0);
      part.group.rotation.z = pose.angle;
      const locked =
        part.kind === 'candidate' &&
        !part.fixed &&
        this.#types.get(part.id) === 'fixed';
      if (locked !== part.locked) {
        part.locked = locked;
        part.fills.forEach((mesh, i) => {
          mesh.material = locked ? this.#m.gunmetal : part.fillMaterials[i];
        });
        part.edge = locked
          ? this.#line(COLOR.gunmetalEdge, EDGE_W)
          : this.#steelEdge(part.slender);
      }
      this.#restyle(part);
    }
    for (const gauge of this.#gauges) {
      const pose = this.#poses.get(gauge.part.id);
      gauge.marker.visible = !!pose;
      if (pose) gauge.marker.position.x = pose.x;
    }
    for (const joint of this.#joints) {
      const a = joint.a === '$ground' ? GROUND_POSE : this.#poses.get(joint.a);
      const b = joint.b === '$ground' ? GROUND_POSE : this.#poses.get(joint.b);
      joint.root.visible = !!a && !!b;
      if (a && b) joint.place(a, b);
    }
    this.#springsDirty = true;
  }

  // -------------------------------------------------------------------------
  // Joints

  #top(id: string) {
    return id === '$ground' ? 0 : (this.#tops.get(id) ?? 0);
  }

  #initialPose(id: string): Pose {
    if (id === '$ground') return GROUND_POSE;
    const body = this.#machine?.bodies.find((b) => b.id === id);
    if (body)
      return {
        x: body.position[0],
        y: body.position[1],
        angle: body.angle ?? 0,
      };
    return this.#poses.get(id) ?? GROUND_POSE;
  }

  /** Direction pointing away from the body attached to a grounded anchor. */
  #awayFrom(other: string, point: Vec2): Vec2 {
    const center = this.#initialPose(other);
    const dx = point[0] - center.x,
      dy = point[1] - center.y;
    const length = Math.hypot(dx, dy);
    return length > 0.05 ? [dx / length, dy / length] : [0, -1];
  }

  /** Ideal joints may anchor far outside a body's geometry (a pin on an
   * invisible lever arm). Draw a faint dashed tether from the body's nearest
   * edge to such an anchor so the abstraction is visible, not hidden. */
  #withTethers(joint: Joint, view: JointView): JointView {
    const ends: { side: 'a' | 'b'; from: Vec2; to: Vec2 }[] = [];
    for (const side of ['a', 'b'] as const) {
      const id = joint[side];
      const anchor = side === 'a' ? joint.anchorA : joint.anchorB;
      const shapes = id === '$ground' ? undefined : this.#parts.get(id)?.shapes;
      if (!shapes?.length) continue;
      if (shapes.some((s) => shapeDistance(s, GROUND_POSE, anchor) === 0))
        continue;
      let best: Vec2 = anchor,
        bestDistance = Infinity;
      for (const shape of shapes) {
        const contour = shapeContour(shape);
        contour.forEach((p, i) => {
          const q = contour[(i + 1) % contour.length];
          const dx = q[0] - p[0],
            dy = q[1] - p[1];
          const t = clamp(
            ((anchor[0] - p[0]) * dx + (anchor[1] - p[1]) * dy) /
              (dx * dx + dy * dy || 1),
            0,
            1,
          );
          const c: Vec2 = [p[0] + t * dx, p[1] + t * dy];
          const d = Math.hypot(anchor[0] - c[0], anchor[1] - c[1]);
          if (d < bestDistance) [best, bestDistance] = [c, d];
        });
      }
      if (bestDistance > TETHER_MIN)
        ends.push({ side, from: best, to: anchor });
    }
    if (!ends.length) return view;
    const z = Math.max(this.#top(joint.a), this.#top(joint.b)) + 0.01;
    const line = lineObject(
      Array.from({ length: ends.length * 6 }, () => 0),
      this.#line(COLOR.tether, 1.1, {
        dashed: true,
        dashSize: 0.1,
        gapSize: 0.09,
      }),
    );
    this.#machineTrash.push(line.geometry);
    view.root.add(line);
    const segments = new Float32Array(ends.length * 6);
    const place = view.place;
    return {
      ...view,
      place: (a, b) => {
        place(a, b);
        ends.forEach((end, i) => {
          const pose = end.side === 'a' ? a : b;
          const from = toWorld(pose, end.from),
            to = toWorld(pose, end.to);
          segments.set([from[0], from[1], z, to[0], to[1], z], i * 6);
        });
        writeSegments(line, segments);
        line.computeLineDistances();
      },
    };
  }

  #makeJoint(joint: Joint): JointView | null {
    const root = new THREE.Group();
    root.name = `joint:${joint.id}`;
    this.#machineRoot.add(root);
    const z = Math.max(this.#top(joint.a), this.#top(joint.b)) + 0.02;
    const grounded =
      joint.a === '$ground' ? 'a' : joint.b === '$ground' ? 'b' : null;
    const addGround = (height: number) => {
      if (!grounded) return;
      const point =
        grounded === 'a'
          ? toWorld(GROUND_POSE, joint.anchorA)
          : toWorld(GROUND_POSE, joint.anchorB);
      const away = this.#awayFrom(grounded === 'a' ? joint.b : joint.a, point);
      const mark = this.#groundGlyph(height, away);
      mark.position.x = point[0];
      mark.position.y = point[1];
      root.add(mark);
      this.#machineGlyphs.push({ object: mark, radius: 0.2, minPx: 7 });
    };

    if (joint.type === 'revolute') {
      addGround(z - 0.001);
      const pin = this.#pinGlyph(z, !!grounded);
      root.add(pin);
      this.#machineGlyphs.push({ object: pin, radius: PIN_R, minPx: 5 });
      const limit = joint.limits ? this.#limitGlyph(joint.limits, z) : null;
      if (limit) root.add(limit.group);
      return {
        a: joint.a,
        b: joint.b,
        root,
        place: (a, b) => {
          const p = toWorld(a, joint.anchorA);
          pin.position.x = p[0];
          pin.position.y = p[1];
          limit?.place(p, a, b);
        },
      };
    }

    if (joint.type === 'fixed') {
      addGround(z - 0.001);
      const weld = new THREE.Group();
      weld.position.z = z;
      const core = new THREE.Mesh(this.#shared.weldCore, this.#m.glyphDark);
      weld.add(
        new THREE.Mesh(this.#shared.weld, this.#m.glyphLight),
        new LineSegments2(
          this.#shared.weldEdge as LineSegmentsGeometry,
          this.#line(COLOR.pinFill, 1.2),
        ),
        core,
      );
      root.add(weld);
      this.#machineGlyphs.push({ object: weld, radius: 0.1, minPx: 6 });
      return {
        a: joint.a,
        b: joint.b,
        root,
        place: (a) => {
          const p = toWorld(a, joint.anchorA);
          weld.position.x = p[0];
          weld.position.y = p[1];
          weld.rotation.z = a.angle;
        },
      };
    }

    if (joint.type === 'prismatic') {
      const axis = joint.axis;
      const along = (t: number): Vec2 => [
        joint.anchorA[0] + axis[0] * t,
        joint.anchorA[1] + axis[1] * t,
      ];
      const railZ = joint.a === '$ground' ? 0.012 : this.#top(joint.a) + 0.012;
      const rail = this.#railGlyph(
        along(joint.limits[0]),
        along(joint.limits[1]),
        railZ,
        joint.a === '$ground',
        [along(joint.limits[0]), along(joint.limits[1])],
        this.#machineTrash,
      );
      root.add(rail);
      const carriage = new THREE.Group();
      carriage.position.z = z;
      const dot = new THREE.Mesh(this.#shared.pinDot, this.#m.glyphLight);
      dot.position.z = 0.002;
      carriage.add(
        new THREE.Mesh(this.#shared.carriage, this.#m.glyphDark),
        new LineSegments2(
          this.#shared.carriageEdge as LineSegmentsGeometry,
          this.#line(COLOR.pin, 1.5),
        ),
        dot,
      );
      root.add(carriage);
      this.#machineGlyphs.push({ object: carriage, radius: 0.11, minPx: 6 });
      const axisAngle = Math.atan2(axis[1], axis[0]);
      return {
        a: joint.a,
        b: joint.b,
        root,
        place: (a, b) => {
          rail.position.set(a.x, a.y, 0);
          rail.rotation.z = a.angle;
          const p = toWorld(b, joint.anchorB);
          carriage.position.x = p[0];
          carriage.position.y = p[1];
          carriage.rotation.z = a.angle + axisAngle;
        },
      };
    }

    // Spring: a coil rebuilt every frame between the two live anchors.
    const count = SPRING_TURNS + 3;
    const segments = new Float32Array(count * 6);
    const material = new LineMaterial({
      color: COLOR.spring,
      linewidth: 2.2,
      toneMapped: false,
    });
    const line = lineObject(Array.from(segments), material);
    line.frustumCulled = false;
    this.#machineTrash.push(line.geometry);
    const end = () => {
      const eye = new THREE.Group();
      eye.position.z = z + 0.003;
      eye.add(
        new THREE.Mesh(this.#shared.eyeDisk, this.#m.glyphDark),
        new LineSegments2(
          this.#shared.eyeRing as LineSegmentsGeometry,
          this.#line(COLOR.spring, 1.4),
        ),
      );
      this.#machineGlyphs.push({ object: eye, radius: 0.04, minPx: 2.6 });
      return eye;
    };
    const spring: SpringView = {
      line,
      material,
      ends: [end(), end()],
      from: [0, 0],
      to: [0, 0],
      rest: joint.restLength,
      z,
      segments,
    };
    addGround(0.013);
    root.add(line, ...spring.ends);
    this.#springs.push(spring);
    return {
      a: joint.a,
      b: joint.b,
      root,
      place: (a, b) => {
        spring.from = toWorld(a, joint.anchorA);
        spring.to = toWorld(b, joint.anchorB);
      },
    };
  }

  /**
   * Allowed-angle arc for a limited hinge, drawn in body A's frame, with a
   * needle along body B's x axis (the joint angle is B's rotation relative to
   * A, zero when both start aligned). The needle turns warm on a stop.
   */
  #limitGlyph(limits: Vec2, z: number) {
    const [lo, hi] = limits;
    const r = LIMIT_R;
    const group = new THREE.Group();
    group.position.z = z - 0.002;
    const n = Math.max(6, Math.ceil(((hi - lo) / (Math.PI * 2)) * 64));
    const segments = pushPolyline(
      [],
      arcPoints([0, 0], r, lo, hi, n),
      0,
      false,
    );
    for (const t of [lo, hi]) {
      const c = Math.cos(t),
        s = Math.sin(t);
      segments.push(
        c * r * 0.72,
        s * r * 0.72,
        0,
        c * r * 1.25,
        s * r * 1.25,
        0,
      );
    }
    // Light strokes over a dark casing so the arc reads on bright steel too.
    const casing = lineObject(segments, this.#line(COLOR.pinFill, 4));
    const arc = new LineSegments2(casing.geometry, this.#line(COLOR.rail, 1.5));
    arc.position.z = 0.0005;
    const needleSegments = [PIN_R * 1.15, 0, 0.001, r * 1.12, 0, 0.001];
    const needleCasing = lineObject(
      needleSegments,
      this.#line(COLOR.pinFill, 4.4),
    );
    const needle = new LineSegments2(
      needleCasing.geometry,
      this.#line(COLOR.pin, 1.8),
    );
    needle.position.z = 0.0005;
    const pointer = new THREE.Group();
    pointer.add(needleCasing, needle);
    this.#machineTrash.push(casing.geometry, needleCasing.geometry);
    group.add(casing, arc, pointer);
    this.#machineGlyphs.push({
      object: group,
      radius: r,
      minPx: 0,
      hideBelowPx: 7,
    });
    const free = this.#line(COLOR.pin, 1.8),
      stopped = this.#line(COLOR.springTension, 2.2);
    return {
      group,
      place: (p: Vec2, a: Pose, b: Pose) => {
        group.position.x = p[0];
        group.position.y = p[1];
        group.rotation.z = a.angle;
        const turn = b.angle - a.angle;
        const relative = Math.atan2(Math.sin(turn), Math.cos(turn));
        pointer.rotation.z = relative;
        needle.material =
          relative <= lo + 0.01 || relative >= hi - 0.01 ? stopped : free;
      },
    };
  }

  /** A guide slot (rail) in its owner's frame from `from` to `to`. */
  #railGlyph(
    from: Vec2,
    to: Vec2,
    z: number,
    grounded: boolean,
    stops: Vec2[],
    trash: { dispose(): void }[],
  ): THREE.Group {
    const group = new THREE.Group();
    const half = 0.065;
    const contour = slotContour(from, to, half);
    const fill = new THREE.Mesh(
      fillGeometry(contour, z),
      grounded ? this.#m.railFill : this.#m.railFillBody,
    );
    const dx = to[0] - from[0],
      dy = to[1] - from[1];
    const length = Math.hypot(dx, dy) || 1;
    const u: Vec2 = [dx / length, dy / length];
    const n: Vec2 = [-u[1], u[0]];
    const lines = pushPolyline([], contour, z + 0.001, true);
    const stopLines: number[] = [];
    for (const s of stops)
      stopLines.push(
        s[0] - n[0] * half * 2.1,
        s[1] - n[1] * half * 2.1,
        z + 0.002,
        s[0] + n[0] * half * 2.1,
        s[1] + n[1] * half * 2.1,
        z + 0.002,
      );
    if (grounded)
      for (let t = 0.06; t <= length + 1e-6; t += 0.2) {
        const p: Vec2 = [
          from[0] + u[0] * t - n[0] * (half + 0.02),
          from[1] + u[1] * t - n[1] * (half + 0.02),
        ];
        lines.push(
          p[0],
          p[1],
          z + 0.001,
          p[0] - n[0] * 0.08 - u[0] * 0.06,
          p[1] - n[1] * 0.08 - u[1] * 0.06,
          z + 0.001,
        );
      }
    const outline = lineObject(lines, this.#line(dim(COLOR.rail, 0.85), 1));
    const stopObject = lineObject(stopLines, this.#line(COLOR.pin, 1.8));
    trash.push(fill.geometry, outline.geometry, stopObject.geometry);
    group.add(fill, outline, stopObject);
    return group;
  }

  #layoutSprings() {
    const amplitude = clamp(3.4 / this.#view.scale, 0.085, 0.3);
    const tension = new THREE.Color(COLOR.springTension);
    const compression = new THREE.Color(COLOR.springCompression);
    for (const spring of this.#springs) {
      const [a, b] = [spring.from, spring.to];
      const dx = b[0] - a[0],
        dy = b[1] - a[1];
      const length = Math.hypot(dx, dy);
      const u: Vec2 = length > 1e-6 ? [dx / length, dy / length] : [1, 0];
      const n: Vec2 = [-u[1], u[0]];
      const lead = Math.min(0.14, length * 0.16);
      const coil = Math.max(0, length - 2 * lead);
      const points: Vec2[] = [a, [a[0] + u[0] * lead, a[1] + u[1] * lead]];
      for (let i = 0; i < SPRING_TURNS; i++) {
        const t = lead + (coil * (i + 0.5)) / SPRING_TURNS;
        const side = i % 2 === 0 ? amplitude : -amplitude;
        points.push([
          a[0] + u[0] * t + n[0] * side,
          a[1] + u[1] * t + n[1] * side,
        ]);
      }
      points.push([b[0] - u[0] * lead, b[1] - u[1] * lead], b);
      for (let i = 0; i < points.length - 1; i++) {
        spring.segments.set(
          [
            points[i][0],
            points[i][1],
            spring.z,
            points[i + 1][0],
            points[i + 1][1],
            spring.z,
          ],
          i * 6,
        );
      }
      writeSegments(spring.line, spring.segments);
      spring.ends[0].position.x = a[0];
      spring.ends[0].position.y = a[1];
      spring.ends[1].position.x = b[0];
      spring.ends[1].position.y = b[1];
      const strain = (length - spring.rest) / Math.max(spring.rest, 0.25);
      const t = clamp(Math.abs(strain) / 0.35, 0, 1);
      spring.material.color
        .set(COLOR.spring)
        .lerp(strain >= 0 ? tension : compression, t);
    }
    this.#springsDirty = false;
  }

  // -------------------------------------------------------------------------
  // Fixtures, frame and labels

  #buildFixtures() {
    const trash = this.#fixtureTrash;
    const box = (half: Vec2): Shape[] => [
      { type: 'box', half: [...half], offset: [0, 0], angle: 0 },
    ];

    // Inputs: luminous blocks with ghost sockets at both bit positions.
    const socket = this.#line(dim(COLOR.input, 0.55), 1.1, {
      dashed: true,
      dashSize: 0.08,
      gapSize: 0.06,
    });
    for (const input of INPUTS) {
      const name = input.id.slice(1).toUpperCase();
      const part = this.#makePart(
        {
          id: input.id,
          kind: 'input',
          fixed: true,
          shapes: box(INPUT_HALF),
          layer: 0,
          material: this.#m.input,
          edge: this.#line(COLOR.inputEdge, 1.2),
        },
        this.#fixtures,
        trash,
      );
      part.aura = this.#aura(part, COLOR.input, 0.22, HALO.input);
      part.group.position.set(input.x, input.y, 0);
      const ghosts: number[] = [];
      for (const bit of [0, 1]) {
        const cx = input.x + bit * SETTINGS.inputTravel;
        pushPolyline(
          ghosts,
          [
            [cx - INPUT_HALF[0], input.y - INPUT_HALF[1]],
            [cx + INPUT_HALF[0], input.y - INPUT_HALF[1]],
            [cx + INPUT_HALF[0], input.y + INPUT_HALF[1]],
            [cx - INPUT_HALF[0], input.y + INPUT_HALF[1]],
          ],
          0.012,
          true,
        );
        this.#label(String(bit), cx, input.y - INPUT_HALF[1] - 0.24, {
          minScale: 26,
          style: { color: CSS.input, opacity: '0.75', 'font-size': '11px' },
        });
      }
      const sockets = lineObject(ghosts, socket);
      const travel = lineObject(
        [
          input.x + INPUT_HALF[0],
          input.y,
          0.012,
          input.x + SETTINGS.inputTravel - INPUT_HALF[0],
          input.y,
          0.012,
        ],
        this.#line(dim(COLOR.input, 0.3), 1),
      );
      trash.push(sockets.geometry, travel.geometry);
      this.#fixtures.add(sockets, travel);
      this.#label(name, input.x - INPUT_HALF[0] - 0.28, input.y, {
        align: 'right',
        style: {
          color: CSS.input,
          'font-size': '12px',
          'font-weight': '700',
        },
      });
    }

    // Outputs: brass gauges on grounded rails over a 0 / 1 zone scale. The
    // brass is untextured (a smooth sheen): any grain on a dark warm base
    // reads as wood rather than metal.
    OUTPUTS.forEach((output, index) => {
      const material = this.#own(
        new THREE.MeshStandardMaterial({
          color: COLOR.brassDim,
          metalness: 0.6,
          roughness: 0.28,
          vertexColors: true,
        }),
      );
      const part = this.#makePart(
        {
          id: output.id,
          kind: 'output',
          fixed: false,
          shapes: box(OUTPUT_HALF),
          layer: 0,
          material,
          edge: this.#line(COLOR.brassDimEdge, 1.2),
        },
        this.#fixtures,
        trash,
      );
      part.group.position.set(output.x, output.y, 0);
      const cross = new LineSegments2(
        this.#shared.crosshair as LineSegmentsGeometry,
        this.#line(COLOR.pinFill, 1.3),
      );
      cross.position.z = part.top + 0.006;
      part.group.add(cross);
      part.aura = this.#aura(part, COLOR.brass, 0.3, HALO.gauge);
      part.aura.visible = false;
      const x0 = output.x,
        y0 = output.y;
      this.#fixtures.add(
        this.#railGlyph(
          [x0 + ZONE_ZERO[0], y0],
          [x0 + ZONE_ONE[1], y0],
          0.012,
          true,
          [
            [x0, y0],
            [x0 + SETTINGS.outputTravel, y0],
          ],
          trash,
        ),
      );
      // Zone scale.
      const ys = y0 + GAUGE_SCALE_DY;
      const band = (range: Vec2, color: number, opacity: number) => {
        const mesh = new THREE.Mesh(
          fillGeometry(
            [
              [x0 + range[0], ys - 0.04],
              [x0 + range[1], ys - 0.04],
              [x0 + range[1], ys + 0.04],
              [x0 + range[0], ys + 0.04],
            ],
            0.012,
          ),
          this.#own(
            new THREE.MeshBasicMaterial({
              color,
              transparent: true,
              opacity,
              toneMapped: false,
              depthWrite: false,
            }),
          ),
        );
        trash.push(mesh.geometry);
        this.#fixtures.add(mesh);
      };
      band(ZONE_ZERO, 0x4a6190, 0.9);
      band(ZONE_ONE, COLOR.brass, 0.8);
      const ticks: number[] = [];
      for (const [t, h] of [
        [0, 0.13],
        [SETTINGS.outputTravel, 0.13],
        [ZONE_ZERO[1], 0.08],
        [ZONE_ONE[0], 0.08],
        [0.5, 0.05],
      ])
        ticks.push(x0 + t, ys - 0.04, 0.013, x0 + t, ys - 0.04 - h, 0.013);
      const tickLines = lineObject(ticks, this.#line(dim(COLOR.rail, 0.8), 1));
      const dead = lineObject(
        [x0 + ZONE_ZERO[1], ys, 0.013, x0 + ZONE_ONE[0], ys, 0.013],
        this.#line(dim(COLOR.alarm, 0.55), 1.2, {
          dashed: true,
          dashSize: 0.04,
          gapSize: 0.04,
        }),
      );
      trash.push(tickLines.geometry, dead.geometry);
      this.#fixtures.add(tickLines, dead);
      this.#label('0', x0 + 0.1, ys - 0.3, {
        minScale: 27,
        style: { color: '#8ea6d6', 'font-size': '11px' },
      });
      this.#label('1', x0 + 0.9, ys - 0.3, {
        minScale: 27,
        style: { color: CSS.brass, 'font-size': '11px' },
      });
      const markerMaterial = this.#own(
        new THREE.MeshBasicMaterial({
          color: COLOR.brassDimEdge,
          toneMapped: false,
        }),
      );
      const marker = new THREE.Mesh(this.#shared.marker, markerMaterial);
      marker.position.set(x0, ys + 0.055, 0.014);
      this.#fixtures.add(marker);
      this.#fixtureGlyphs.push({ object: marker, radius: 0.13, minPx: 5 });
      // A small readout window: its own dark backing keeps the digit legible
      // even when candidate geometry passes underneath the overlay.
      const readout = this.#label('', x0 + ZONE_ONE[1] + 0.62, y0, {
        align: 'left',
        style: {
          'font-size': '11px',
          padding: '3px 7px 4px',
          'border-radius': '4px',
          border: '1px solid transparent',
          background: 'rgba(8, 13, 26, 0.82)',
          transition: 'border-color .15s, box-shadow .15s',
        },
      });
      const name = Object.assign(document.createElement('span'), {
        textContent: `S${index}`,
      });
      name.style.cssText = `color:${CSS.brassDim};margin-right:8px`;
      const value = document.createElement('span');
      value.style.cssText =
        'font-size:20px;font-weight:700;vertical-align:-3px;transition:color .15s,text-shadow .15s';
      readout.el.append(name, value);
      const gauge: Gauge = {
        part,
        material,
        marker,
        markerMaterial,
        value,
        readout: readout.el,
        state: '',
      };
      this.#gauges.push(gauge);
      this.#setGauge(gauge, 'zero');
    });

    // Crank: warm disk with spokes and a handle; fixed bearing; drive arrow.
    const crank = this.#makePart(
      {
        id: CRANK.id,
        kind: 'crank',
        fixed: false,
        shapes: [
          { type: 'ball', radius: CRANK.radius, offset: [0, 0], angle: 0 },
        ],
        layer: 0,
        material: this.#m.crank,
        edge: this.#line(COLOR.crankEdge, 1.2),
      },
      this.#fixtures,
      trash,
    );
    crank.group.position.set(CRANK.x, CRANK.y, 0);
    const zc = crank.top + 0.005;
    const spokes: number[] = [];
    for (let k = 0; k < 3; k++) {
      const t = (k * Math.PI * 2) / 3 + Math.PI / 2;
      spokes.push(
        Math.cos(t) * 0.15,
        Math.sin(t) * 0.15,
        zc,
        Math.cos(t) * CRANK.radius * 0.86,
        Math.sin(t) * CRANK.radius * 0.86,
        zc,
      );
    }
    const spokeLines = lineObject(spokes, this.#line(COLOR.crankInk, 2.2));
    const hub = new THREE.Mesh(
      new THREE.CircleGeometry(0.15, 32),
      this.#m.glyphDark,
    );
    hub.position.z = zc;
    const handle = new THREE.Mesh(
      new THREE.CircleGeometry(0.085, 24),
      this.#own(
        new THREE.MeshBasicMaterial({
          color: COLOR.crankLight,
          toneMapped: false,
        }),
      ),
    );
    const knob: Vec2 = [
      Math.cos(Math.PI * 0.83) * CRANK.radius * 0.6,
      Math.sin(Math.PI * 0.83) * CRANK.radius * 0.6,
    ];
    handle.position.set(knob[0], knob[1], zc + 0.002);
    const handleRing = lineObject(
      pushPolyline([], circlePoints(knob, 0.085, 20), zc + 0.003, true),
      this.#line(COLOR.crankInk, 1.4),
    );
    trash.push(
      spokeLines.geometry,
      hub.geometry,
      handle.geometry,
      handleRing.geometry,
    );
    crank.group.add(spokeLines, hub, handle, handleRing);
    const bearing = this.#pinGlyph(zc + 0.01, true);
    bearing.position.x = CRANK.x;
    bearing.position.y = CRANK.y;
    this.#fixtures.add(bearing);
    this.#fixtureGlyphs.push({ object: bearing, radius: PIN_R, minPx: 4.2 });

    const arcFrom = Math.PI * 1.1,
      arcTo = Math.PI * 1.9,
      arcR = CRANK.radius + 0.3;
    const arc = this.#own(
      new LineMaterial({
        color: dim(COLOR.crank, 0.35),
        linewidth: 2.2,
        toneMapped: false,
      }),
    );
    const arcLine = lineObject(
      pushPolyline([], arcPoints([0, 0], arcR, arcFrom, arcTo, 40), 0, false),
      arc,
    );
    const tip = arcPoints([0, 0], arcR, arcTo, arcTo, 1)[0];
    const tangent: Vec2 = [-Math.sin(arcTo), Math.cos(arcTo)];
    const radial: Vec2 = [Math.cos(arcTo), Math.sin(arcTo)];
    const arrow = new THREE.Mesh(
      fillGeometry(
        [
          [tip[0] + tangent[0] * 0.16, tip[1] + tangent[1] * 0.16],
          [tip[0] - radial[0] * 0.09, tip[1] - radial[1] * 0.09],
          [tip[0] + radial[0] * 0.09, tip[1] + radial[1] * 0.09],
        ],
        0,
      ),
      this.#m.driveArrow,
    );
    trash.push(arcLine.geometry, arrow.geometry);
    const drive = new THREE.Group();
    drive.position.set(CRANK.x, CRANK.y, 0.014);
    drive.add(arcLine, arrow);
    this.#m.driveArrow.color.set(dim(COLOR.crank, 0.35));
    this.#fixtures.add(drive);
    this.#drive = { group: drive, arc, direction: 1 };
    this.#label('CRANK', CRANK.x, CRANK.y - arcR - 0.42, {
      style: { color: CSS.crank, 'font-size': '11px', 'font-weight': '700' },
    });
  }

  #aura(
    part: PartView,
    color: number,
    opacity: number,
    ref: number,
  ): LineSegments2 {
    const aura = new LineSegments2(
      part.outline.geometry,
      this.#halo(color, 12, opacity, ref),
    );
    aura.position.z = -DEPTH.thickness / 2 - 0.004;
    part.group.add(aura);
    return aura;
  }

  #setGauge(gauge: Gauge, state: GaugeState) {
    if (gauge.state === state) return;
    gauge.state = state;
    const { part, material } = gauge;
    const aura = part.aura!;
    if (state === 'one') {
      material.color.set(COLOR.brass);
      material.emissive.set(COLOR.brass);
      material.emissiveIntensity = 0.55;
      part.edge = this.#line(COLOR.brassEdge, 1.3);
      aura.material = this.#halo(COLOR.brass, 14, 0.34, HALO.gauge);
      gauge.markerMaterial.color.set(COLOR.brass);
    } else if (state === 'ambiguous') {
      material.color.set(COLOR.alarm);
      material.emissive.set(COLOR.alarm);
      material.emissiveIntensity = 0.45;
      part.edge = this.#line(COLOR.alarmEdge, 1.3);
      aura.material = this.#halo(COLOR.alarm, 14, 0.34, HALO.gauge);
      gauge.markerMaterial.color.set(COLOR.alarm);
    } else {
      material.color.set(COLOR.brassDim);
      material.emissive.set(0x000000);
      material.emissiveIntensity = 0;
      part.edge = this.#line(COLOR.brassDimEdge, 1.2);
      gauge.markerMaterial.color.set(COLOR.brassDimEdge);
    }
    aura.visible = state !== 'zero';
    gauge.value.textContent =
      state === 'one' ? '1' : state === 'zero' ? '0' : '?';
    gauge.value.style.color =
      state === 'one' ? CSS.brass : state === 'zero' ? CSS.brassDim : CSS.alarm;
    gauge.value.style.textShadow =
      state === 'zero'
        ? 'none'
        : `0 0 10px ${state === 'one' ? CSS.brass : CSS.alarm}`;
    const accent =
      state === 'one' ? CSS.brass : state === 'zero' ? CSS.brassDim : CSS.alarm;
    gauge.readout.style.borderColor = `${accent}${state === 'zero' ? '40' : '99'}`;
    gauge.readout.style.boxShadow =
      state === 'zero' ? 'none' : `0 0 14px ${accent}33`;
    this.#restyle(part);
  }

  #buildFrame() {
    const w = WORKSPACE;
    const frame = lineObject(
      pushPolyline(
        [],
        [
          [-w, -w],
          [w, -w],
          [w, w],
          [-w, w],
        ],
        0.006,
        true,
      ),
      this.#line(COLOR.frame, 1.2),
    );
    const corners: number[] = [];
    const o = 0.22,
      arm = 0.9;
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const cx = sx * (w + o),
        cy = sy * (w + o);
      corners.push(cx, cy, 0.006, cx - sx * arm, cy, 0.006);
      corners.push(cx, cy, 0.006, cx, cy - sy * arm, 0.006);
    }
    const ticks: number[] = [];
    for (let k = -w; k <= w; k++) {
      const long = k % 4 === 0 ? 0.3 : 0.12;
      ticks.push(k, -w, 0.006, k, -w - long, 0.006);
      ticks.push(k, w, 0.006, k, w + long, 0.006);
      ticks.push(-w, k, 0.006, -w - long, k, 0.006);
      ticks.push(w, k, 0.006, w + long, k, 0.006);
    }
    const cornerLines = lineObject(corners, this.#line(COLOR.frameTick, 1.6));
    const tickLines = lineObject(ticks, this.#line(COLOR.frame, 1));
    this.#fixtureTrash.push(
      frame.geometry,
      cornerLines.geometry,
      tickLines.geometry,
    );
    this.#fixtures.add(frame, cornerLines, tickLines);
    const ruler = { color: CSS.dim, 'font-size': '11px' };
    for (let k = -w; k <= w; k += 4) {
      const text = k < 0 ? `−${-k}` : String(k);
      const minScale = COMPACT_SCALE;
      this.#label(text, k, -w - 0.62, { style: ruler, minScale });
      this.#label(text, -w - 0.5, k, {
        align: 'right',
        style: ruler,
        minScale,
      });
    }
  }

  #label(
    text: string,
    x: number,
    y: number,
    options: {
      align?: Label['align'];
      valign?: Label['valign'];
      nudge?: Vec2;
      minScale?: number;
      z?: number;
      style?: Style;
    } = {},
  ): Label {
    const el = document.createElement('div');
    el.className = 'mcl-label';
    el.textContent = text;
    applyStyle(el, {
      position: 'absolute',
      left: '0',
      top: '0',
      'white-space': 'nowrap',
      'font-size': '11px',
      'font-weight': '500',
      'line-height': '1',
      'letter-spacing': '0.06em',
      color: CSS.label,
      'text-shadow': `0 0 3px ${CSS.ground}, 0 0 7px ${CSS.ground}`,
      'will-change': 'transform',
      ...options.style,
    });
    this.#overlay.appendChild(el);
    const label: Label = {
      el,
      at: new THREE.Vector3(x, y, options.z ?? 0.02),
      align: options.align ?? 'center',
      valign: options.valign ?? 'middle',
      nudge: options.nudge ?? [0, 0],
      minScale: options.minScale ?? 0,
      last: '',
    };
    this.#labels.push(label);
    return label;
  }

  #makeHud() {
    const hud = document.createElement('div');
    hud.className = 'mcl-hud';
    applyStyle(hud, {
      position: 'absolute',
      left: '14px',
      bottom: '12px',
      display: 'flex',
      'flex-direction': 'column',
      'align-items': 'flex-start',
      gap: '6px',
      color: CSS.dim,
      'font-size': '11px',
      'letter-spacing': '0.06em',
    });
    const scale = document.createElement('div');
    applyStyle(scale, {
      display: 'flex',
      'flex-direction': 'column',
      gap: '4px',
    });
    const bar = document.createElement('div');
    applyStyle(bar, {
      height: '5px',
      border: `1px solid ${CSS.label}`,
      'border-top': 'none',
      opacity: '0.7',
    });
    const text = document.createElement('span');
    scale.append(bar, text);
    const cursor = document.createElement('span');
    applyStyle(cursor, { 'white-space': 'pre' });
    hud.append(cursor, scale);
    this.#overlay.appendChild(hud);
    return { bar, text, cursor };
  }

  // -------------------------------------------------------------------------
  // Camera

  /**
   * The view that frames the machine (or the whole workspace) for the
   * current size. Pixel margins leave room for edge labels (rulers in the
   * workspace fit), the scene's own scale bar and the host's overlays: the
   * content avoids either the top band or the two top-corner columns,
   * whichever allows the larger scale.
   */
  #fitView(mode: FitMode = this.#fitMode): View {
    const w = this.#width,
      h = this.#height;
    if (!w || !h) return { cx: 0, cy: 0, scale: 20 };
    const roomy = Math.min(w, h) >= 480;
    let box: Box;
    let pad: { left: number; right: number; top: number; bottom: number };
    if (mode === 'workspace') {
      box = [-FIT_HALF, -FIT_HALF, FIT_HALF, FIT_HALF];
      const side = roomy ? 34 : 10;
      pad = {
        left: side,
        right: side,
        top: roomy ? 22 : 10,
        bottom: roomy ? 30 : 16,
      };
    } else {
      const [x0, y0, x1, y1] = this.#bounds;
      const margin = Math.max(0.4, 0.05 * Math.max(x1 - x0, y1 - y0));
      box = [x0 - margin, y0 - margin, x1 + margin, y1 + margin];
      pad = FIT_PAD_PX;
    }
    const ins = this.#insets;
    // The scale bar (bottom-left) is the scene's own overlay.
    const bottom = Math.max(ins.bottom, roomy ? 34 : 30) + pad.bottom;
    const bw = box[2] - box[0],
      bh = box[3] - box[1];
    const layouts = [
      { x0: pad.left, x1: w - pad.right, y0: ins.top + pad.top },
      { x0: ins.left + pad.left, x1: w - ins.right - pad.right, y0: pad.top },
    ].map((l) => ({ ...l, y1: h - bottom }));
    let best = { cx: 0, cy: 0, scale: 0 };
    for (const l of layouts) {
      const scale = Math.max(
        1,
        Math.min((l.x1 - l.x0) / bw, (l.y1 - l.y0) / bh),
      );
      if (scale <= best.scale) continue;
      const ax = (l.x0 + l.x1) / 2,
        ay = (l.y0 + l.y1) / 2;
      best = {
        cx: (box[0] + box[2]) / 2 - (ax - w / 2) / scale,
        cy: (box[1] + box[3]) / 2 + (ay - h / 2) / scale,
        scale,
      };
    }
    return best;
  }

  #clampView() {
    const v = this.#view;
    v.scale = clamp(v.scale, this.#fitView('workspace').scale * 0.6, MAX_SCALE);
    v.cx = clamp(v.cx, -WORKSPACE - 2, WORKSPACE + 2);
    v.cy = clamp(v.cy, -WORKSPACE - 2, WORKSPACE + 2);
  }

  #camera(): THREE.Camera {
    return this.#tilt > 0.001 ? this.#persp : this.#ortho;
  }

  #syncCamera() {
    const { cx, cy, scale } = this.#view;
    const w = this.#width || 1,
      h = this.#height || 1;
    const o = this.#ortho;
    o.left = -w / 2 / scale;
    o.right = w / 2 / scale;
    o.top = h / 2 / scale;
    o.bottom = -h / 2 / scale;
    o.position.set(cx, cy, 100);
    o.quaternion.identity();
    o.updateProjectionMatrix();
    o.updateMatrixWorld();
    const p = this.#persp;
    const t = easeInOut(this.#tilt);
    const distance =
      h /
      2 /
      scale /
      Math.tan(THREE.MathUtils.degToRad(TILT.fov / 2)) /
      (1 + TILT.zoom * t);
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(TILT.pitch * t, 0, TILT.yaw * t, 'ZXY'),
    );
    p.aspect = w / h;
    p.near = distance * 0.02;
    p.far = distance * 12;
    p.position
      .set(0, 0, distance)
      .applyQuaternion(q)
      .add(new THREE.Vector3(cx, cy, 0));
    p.quaternion.copy(q);
    p.updateProjectionMatrix();
    p.updateMatrixWorld();
  }

  /** Ground-plane point under a container-relative CSS pixel. */
  #groundAt(point: Vec2): Vec2 | null {
    if (!this.#width || !this.#height) return null;
    const ndc = new THREE.Vector2(
      (point[0] / this.#width) * 2 - 1,
      -(point[1] / this.#height) * 2 + 1,
    );
    this.#raycaster.setFromCamera(ndc, this.#camera());
    const hit = this.#raycaster.ray.intersectPlane(
      this.#groundPlane,
      new THREE.Vector3(),
    );
    return hit ? [hit.x, hit.y] : null;
  }

  #zoomAt(point: Vec2, factor: number) {
    const before = this.#groundAt(point);
    this.#view.scale *= factor;
    this.#clampView();
    this.#syncCamera();
    const after = this.#groundAt(point);
    if (before && after) {
      this.#view.cx += before[0] - after[0];
      this.#view.cy += before[1] - after[1];
    }
    this.#afterMove();
  }

  #panBetween(from: Vec2, to: Vec2) {
    const a = this.#groundAt(from),
      b = this.#groundAt(to);
    if (!a || !b) return;
    this.#view.cx += a[0] - b[0];
    this.#view.cy += a[1] - b[1];
    this.#afterMove();
  }

  #afterMove() {
    this.#tween = null;
    if (!this.#userMoved) this.#options.onFitChange?.(null);
    this.#userMoved = true;
    this.#clampView();
    this.#syncCamera();
    this.#invalidate();
  }

  #animateTo(to: View, duration: number) {
    const reduced =
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!this.#width || duration <= 0 || reduced) {
      this.#tween = null;
      this.#view = { ...to };
      this.#invalidate();
      return;
    }
    this.#tween = {
      from: { ...this.#view },
      to,
      start: performance.now(),
      duration,
    };
    this.#invalidate();
  }

  #resize() {
    const width = this.#container.clientWidth,
      height = this.#container.clientHeight;
    if (!width || !height) return;
    this.#width = width;
    this.#height = height;
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.#renderer.setSize(width, height, false);
    if (!this.#userMoved) {
      this.#tween = null;
      this.#view = this.#fitView();
    } else this.#clampView();
    this.#glyphScaleFor = 0;
    this.#render(performance.now());
  }

  // -------------------------------------------------------------------------
  // Rendering

  #invalidate() {
    if (!this.#raf && !this.#disposed)
      this.#raf = requestAnimationFrame(this.#frame);
  }

  #frame = (now: number) => {
    this.#raf = 0;
    this.#render(now);
  };

  #render(now: number) {
    if (this.#disposed || !this.#width) return;
    let animating = false;
    if (this.#tween) {
      const { from, to, start, duration } = this.#tween;
      const t = clamp((now - start) / duration, 0, 1);
      const e = easeInOut(t);
      this.#view = {
        cx: lerp(from.cx, to.cx, e),
        cy: lerp(from.cy, to.cy, e),
        scale: from.scale * (to.scale / from.scale) ** e,
      };
      if (t < 1) animating = true;
      else this.#tween = null;
    }
    if (this.#tiltTween) {
      const { from, to, start, duration } = this.#tiltTween;
      const t = clamp((now - start) / duration, 0, 1);
      this.#tilt = lerp(from, to, t);
      if (t < 1) animating = true;
      else this.#tiltTween = null;
    }
    this.#syncCamera();
    if (this.#glyphScaleFor !== this.#view.scale) {
      this.#glyphScaleFor = this.#view.scale;
      for (const glyph of [...this.#fixtureGlyphs, ...this.#machineGlyphs]) {
        const px = glyph.radius * this.#view.scale;
        const s = clamp(glyph.minPx / px, 1, 2.6);
        glyph.object.scale.set(s, s, 1);
        if (glyph.hideBelowPx) glyph.object.visible = px >= glyph.hideBelowPx;
      }
      this.#springsDirty = true;
      this.#updateScaleBar();
      this.#setCompact(this.#view.scale < COMPACT_SCALE);
    }
    if (this.#springsDirty) this.#layoutSprings();
    const camera = this.#camera();
    this.#renderer.render(this.#scene, camera);
    this.#placeLabels(camera);
    if (animating) this.#invalidate();
  }

  #placeLabels(camera: THREE.Camera) {
    const v = new THREE.Vector3();
    const shift = { left: '0', center: '-50%', right: '-100%' };
    for (const label of this.#labels) {
      let transform = 'hidden';
      if (this.#view.scale >= label.minScale) {
        v.copy(label.at).project(camera);
        if (v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.3 && Math.abs(v.y) < 1.3) {
          const x = ((v.x + 1) / 2) * this.#width + label.nudge[0],
            y = ((1 - v.y) / 2) * this.#height + label.nudge[1];
          // A label that would start beyond the edge it grows away from
          // (e.g. the title block in the 3/4 view) is hidden, not clipped.
          const cut =
            (label.align === 'left' && x < 0) ||
            (label.align === 'right' && x > this.#width);
          const dy = label.valign === 'top' ? '0' : '-50%';
          if (!cut)
            transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(${shift[label.align]},${dy})`;
        }
      }
      if (transform === label.last) continue;
      label.last = transform;
      if (transform === 'hidden') label.el.style.visibility = 'hidden';
      else {
        label.el.style.visibility = '';
        label.el.style.transform = transform;
      }
    }
  }

  /** Smaller gauge readouts for small views, so they stay inside the frame. */
  #setCompact(compact: boolean) {
    if (compact === this.#compact) return;
    this.#compact = compact;
    for (const { readout, value } of this.#gauges) {
      readout.style.padding = compact ? '2px 5px 3px' : '3px 7px 4px';
      (readout.firstElementChild as HTMLElement).style.marginRight = compact
        ? '4px'
        : '8px';
      value.style.fontSize = compact ? '14px' : '20px';
      value.style.verticalAlign = compact ? '-1px' : '-3px';
    }
  }

  #updateScaleBar() {
    const scale = this.#view.scale;
    const steps = [0.1, 0.2, 0.25, 0.5, 1, 2, 4, 5, 10];
    const unit = steps.find((s) => s * scale >= 56) ?? 10;
    this.#hud.bar.style.width = `${Math.round(unit * scale)}px`;
    this.#hud.text.textContent = `${unit} u`;
  }

  // -------------------------------------------------------------------------
  // Picking and interaction

  #local(event: PointerEvent | WheelEvent | MouseEvent): Vec2 {
    const rect = this.#canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  #pick(point: Vec2): string {
    if (!this.#width) return '';
    this.#syncCamera();
    this.#scene.updateMatrixWorld();
    const meshes: THREE.Mesh[] = [];
    for (const part of this.#parts.values())
      if (part.group.visible) meshes.push(...part.fills);
    this.#raycaster.setFromCamera(
      new THREE.Vector2(
        (point[0] / this.#width) * 2 - 1,
        -(point[1] / this.#height) * 2 + 1,
      ),
      this.#camera(),
    );
    const hit = this.#raycaster.intersectObjects(meshes, false)[0];
    if (hit) return String(hit.object.userData.part);
    if (this.#tilt > 0.001) return '';
    // Thin parts: accept a near miss within a few pixels in the plan view.
    const world = this.#groundAt(point);
    if (!world) return '';
    let best = 7 / this.#view.scale,
      id = '';
    for (const part of this.#parts.values()) {
      const pose = this.#poses.get(part.id);
      if (!part.group.visible || !pose) continue;
      for (const shape of part.shapes) {
        const d = shapeDistance(shape, pose, world);
        if (d < best) {
          best = d;
          id = part.id;
        }
      }
    }
    return id;
  }

  #setHovered(id: string) {
    if (id === this.#hovered) return;
    const previous = this.#parts.get(this.#hovered);
    this.#hovered = id;
    if (previous) this.#restyle(previous);
    const next = this.#parts.get(id);
    if (next) this.#restyle(next);
    this.#invalidate();
  }

  #processHover = () => {
    this.#hoverRaf = 0;
    const point = this.#hoverPoint;
    if (!point || this.#drag) return;
    const world = this.#groundAt(point);
    this.#hud.cursor.textContent = world
      ? `x ${world[0] >= 0 ? ' ' : '−'}${Math.abs(world[0]).toFixed(2).padStart(5)}  y ${world[1] >= 0 ? ' ' : '−'}${Math.abs(world[1]).toFixed(2).padStart(5)}`
      : '';
    const id = this.#pick(point);
    this.#setHovered(id);
    this.#canvas.style.cursor = id ? 'pointer' : 'default';
    if (id)
      this.#options.onHover?.({
        id,
        label: this.#parts.get(id)?.label,
        x: point[0],
        y: point[1],
      });
    else this.#options.onHover?.(null);
  };

  #onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    this.#canvas.focus({ preventScroll: true });
    try {
      this.#canvas.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic events may not be capturable.
    }
    const point = this.#local(event);
    this.#pointers.set(event.pointerId, point);
    this.#tween = null;
    if (this.#pointers.size === 1) this.#drag = { moved: false, start: point };
    else if (this.#drag) this.#drag.moved = true;
  };

  #onPointerMove = (event: PointerEvent) => {
    const point = this.#local(event);
    const previous = this.#pointers.get(event.pointerId);
    if (!previous) {
      if (event.pointerType === 'touch') return;
      this.#hoverPoint = point;
      if (!this.#hoverRaf)
        this.#hoverRaf = requestAnimationFrame(this.#processHover);
      return;
    }
    if (this.#pointers.size >= 2) {
      const [a, b] = [...this.#pointers.entries()];
      const other = a[0] === event.pointerId ? b[1] : a[1];
      const before = Math.hypot(previous[0] - other[0], previous[1] - other[1]);
      const after = Math.hypot(point[0] - other[0], point[1] - other[1]);
      const midBefore: Vec2 = [
        (previous[0] + other[0]) / 2,
        (previous[1] + other[1]) / 2,
      ];
      const midAfter: Vec2 = [
        (point[0] + other[0]) / 2,
        (point[1] + other[1]) / 2,
      ];
      this.#pointers.set(event.pointerId, point);
      if (before > 1) this.#zoomAt(midBefore, clamp(after / before, 0.5, 2));
      this.#panBetween(midBefore, midAfter);
      return;
    }
    this.#pointers.set(event.pointerId, point);
    const drag = this.#drag;
    if (!drag) return;
    if (
      !drag.moved &&
      Math.hypot(point[0] - drag.start[0], point[1] - drag.start[1]) > 4
    ) {
      drag.moved = true;
      this.#setHovered('');
      this.#options.onHover?.(null);
    }
    if (drag.moved) {
      this.#canvas.style.cursor = 'grabbing';
      this.#panBetween(previous, point);
    }
  };

  #onPointerUp = (event: PointerEvent) => {
    if (!this.#pointers.has(event.pointerId)) return;
    const point = this.#local(event);
    this.#pointers.delete(event.pointerId);
    try {
      this.#canvas.releasePointerCapture(event.pointerId);
    } catch {
      // Already released.
    }
    const drag = this.#drag;
    if (this.#pointers.size > 0) return;
    this.#drag = null;
    this.#canvas.style.cursor = this.#hovered ? 'pointer' : 'default';
    if (event.type === 'pointerup' && drag && !drag.moved)
      this.#options.onSelect?.(this.#pick(point));
  };

  #onPointerLeave = () => {
    if (this.#pointers.size) return;
    this.#hoverPoint = null;
    this.#hud.cursor.textContent = '';
    this.#setHovered('');
    this.#options.onHover?.(null);
  };

  #onWheel = (event: WheelEvent) => {
    event.preventDefault();
    let delta = event.deltaY;
    if (event.deltaMode === 1) delta *= 16;
    else if (event.deltaMode === 2) delta *= this.#height;
    const factor = Math.exp(-delta * (event.ctrlKey ? 0.012 : 0.0022));
    this.#zoomAt(this.#local(event), clamp(factor, 0.5, 2));
  };

  #onDoubleClick = (event: MouseEvent) => {
    event.preventDefault();
    this.fit();
  };

  #onKey = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // Plain arrows belong to the host (step / scrub); Shift + arrows pan.
    if (event.key.startsWith('Arrow') && !event.shiftKey) return;
    const center: Vec2 = [this.#width / 2, this.#height / 2];
    const step = 70;
    const pan = (dx: number, dy: number) =>
      this.#panBetween(center, [center[0] - dx, center[1] - dy]);
    switch (event.key) {
      case '+':
      case '=':
        this.#zoomAt(center, 1.25);
        break;
      case '-':
      case '_':
        this.#zoomAt(center, 0.8);
        break;
      case 'ArrowLeft':
        pan(step, 0);
        break;
      case 'ArrowRight':
        pan(-step, 0);
        break;
      case 'ArrowUp':
        pan(0, step);
        break;
      case 'ArrowDown':
        pan(0, -step);
        break;
      case '0':
      case 'f':
      case 'F':
        this.fit();
        break;
      default:
        return;
    }
    event.preventDefault();
  };
}
