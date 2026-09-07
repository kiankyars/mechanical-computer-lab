import * as THREE from 'three';
import type { Snapshot, BodyView } from '../simulator/world';
import { INPUTS, OUTPUTS } from '../simulator/protocol';

const colors = {
  input: 0x145ed1,
  output: 0xd17816,
  fixed: 0x7a899c,
  dynamic: 0xb9c6d6,
  selected: 0x00a18c,
};

export class MachineScene {
  #renderer: THREE.WebGLRenderer;
  #scene = new THREE.Scene();
  #camera = new THREE.OrthographicCamera(-12, 12, 9, -9, 0.1, 100);
  #parts = new Map<string, THREE.Group>();
  #observer: ResizeObserver;
  #container: HTMLElement;
  #select: (id: string) => void;
  #highlight = '';

  constructor(container: HTMLElement, select: (id: string) => void) {
    this.#container = container;
    this.#select = select;
    this.#renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.setClearColor(0xedf2f8);
    this.#renderer.domElement.setAttribute(
      'aria-label',
      'Physical machine. Click a part to highlight it.',
    );
    container.appendChild(this.#renderer.domElement);
    this.#camera.position.set(0, 0, 30);
    this.#scene.add(new THREE.AmbientLight(0xffffff, 2));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(-8, 10, 20);
    this.#scene.add(light);
    const grid = new THREE.GridHelper(24, 24, 0xc5cfdc, 0xdce3ec);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.2;
    this.#scene.add(grid);
    for (const input of INPUTS)
      this.#label(
        input.id.replace('$', '').toUpperCase(),
        input.x,
        input.y + 0.7,
      );
    for (const output of OUTPUTS) {
      this.#label(
        output.id.replace('$', '').toUpperCase(),
        output.x + 0.5,
        output.y + 0.7,
      );
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(1.7, 0.08, 0.04),
        new THREE.MeshBasicMaterial({ color: 0xa3afbd }),
      );
      rail.position.set(output.x + 0.5, output.y, -0.1);
      this.#scene.add(rail);
    }
    this.#label('CRANK', 0, -7);
    this.#observer = new ResizeObserver(() => this.#resize());
    this.#observer.observe(container);
    this.#renderer.domElement.addEventListener('pointerdown', this.#pick);
    this.#renderer.domElement.addEventListener('wheel', this.#zoom, {
      passive: false,
    });
    this.#resize();
  }

  #label(text: string, x: number, y: number) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#536476';
    context.font = '28px monospace';
    context.textAlign = 'center';
    context.fillText(text, 128, 43);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(canvas),
        transparent: true,
        depthTest: false,
      }),
    );
    sprite.position.set(x, y, 0.6);
    sprite.scale.set(2.2, 0.55, 1);
    this.#scene.add(sprite);
  }

  #resize() {
    const width = this.#container.clientWidth,
      height = this.#container.clientHeight;
    if (!width || !height) return;
    const aspect = width / height,
      halfHeight = Math.max(8.5, 12 / aspect);
    this.#camera.left = -halfHeight * aspect;
    this.#camera.right = halfHeight * aspect;
    this.#camera.top = halfHeight;
    this.#camera.bottom = -halfHeight;
    this.#camera.updateProjectionMatrix();
    this.#renderer.setSize(width, height);
    this.#render();
  }

  #makePart(body: BodyView) {
    const group = new THREE.Group();
    for (const shape of body.shapes) {
      let geometry: THREE.BufferGeometry;
      if (shape.type === 'box')
        geometry = new THREE.BoxGeometry(
          shape.half[0] * 2,
          shape.half[1] * 2,
          0.22,
        );
      else if (shape.type === 'ball')
        geometry = new THREE.CylinderGeometry(
          shape.radius,
          shape.radius,
          0.22,
          40,
        ).rotateX(Math.PI / 2);
      else {
        const contour = new THREE.Shape(
          shape.vertices.map(([x, y]) => new THREE.Vector2(x, y)),
        );
        geometry = new THREE.ExtrudeGeometry(contour, {
          depth: 0.22,
          bevelEnabled: false,
        }).translate(0, 0, -0.11);
      }
      const color =
        body.id.startsWith('$a') || body.id.startsWith('$b')
          ? colors.input
          : body.id.startsWith('$s')
            ? colors.output
            : body.type === 'fixed'
              ? colors.fixed
              : colors.dynamic;
      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.65,
        metalness: 0.2,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...shape.offset, 0);
      mesh.rotation.z = shape.angle;
      mesh.userData = { id: body.id, color };
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: 0x42556d }),
      );
      mesh.add(edges);
      group.add(mesh);
    }
    if (body.id === '$crank') {
      const mark = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.05, 0.02),
        new THREE.MeshBasicMaterial({ color: 0x263b54 }),
      );
      mark.position.set(0.2, 0, 0.13);
      group.add(mark);
    }
    this.#parts.set(body.id, group);
    this.#scene.add(group);
    return group;
  }

  update(snapshot: Snapshot) {
    const ids = new Set(snapshot.bodies.map((body) => body.id));
    for (const [id, group] of this.#parts) group.visible = ids.has(id);
    for (const body of snapshot.bodies) {
      const group = this.#parts.get(body.id) ?? this.#makePart(body);
      group.position.set(body.x, body.y, 0);
      group.rotation.z = body.angle;
    }
    this.highlight(this.#highlight);
  }

  highlight(id: string) {
    this.#highlight = id;
    for (const group of this.#parts.values())
      group.traverse((object) => {
        if (object instanceof THREE.Mesh && object.userData.id)
          object.material.color.setHex(
            object.userData.id === id ? colors.selected : object.userData.color,
          );
      });
    this.#render();
  }

  #pick = (event: PointerEvent) => {
    const rect = this.#renderer.domElement.getBoundingClientRect();
    const point = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(point, this.#camera);
    const hit = ray
      .intersectObjects([...this.#parts.values()], true)
      .find((x) => x.object.userData.id);
    if (hit) this.#select(hit.object.userData.id);
  };

  #zoom = (event: WheelEvent) => {
    event.preventDefault();
    this.#camera.zoom = Math.max(
      0.7,
      Math.min(3, this.#camera.zoom * (event.deltaY < 0 ? 1.08 : 0.92)),
    );
    this.#camera.updateProjectionMatrix();
    this.#render();
  };

  #render() {
    this.#renderer.render(this.#scene, this.#camera);
  }

  dispose() {
    this.#observer.disconnect();
    this.#renderer.domElement.removeEventListener('pointerdown', this.#pick);
    this.#renderer.domElement.removeEventListener('wheel', this.#zoom);
    this.#scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments)
        object.geometry.dispose();
      const material = (object as THREE.Mesh).material;
      if (material)
        for (const item of Array.isArray(material) ? material : [material]) {
          (item as THREE.MeshStandardMaterial).map?.dispose();
          item.dispose();
        }
    });
    this.#renderer.dispose();
    this.#renderer.domElement.remove();
  }
}
