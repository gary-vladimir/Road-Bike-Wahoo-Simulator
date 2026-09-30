import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type PropKind = 'tree' | 'cactus' | 'agave' | 'grass' | 'rock' | 'post' | 'shadow';
export type Prop = {
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  scale: number;
  rotation: number;
  /** Optional per-instance tint multiplier (grass, rocks). */
  tint?: number;
  /** Ground normal, for shadows lying on slopes. */
  nx?: number;
  nz?: number;
};

const random = (seed: number) => {
  const v = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};

/** Two crossed vertical cards: a photographic tree that holds up from any viewing angle. */
function treeCards(aspect: number) {
  const a = new THREE.PlaneGeometry(aspect, 1).translate(0, 0.5, 0);
  const b = a.clone().rotateY(Math.PI / 2);
  return mergeGeometries([a, b])!;
}

/** Organ-pipe cactus (órgano): ribbed columns rising from a short base. */
function cactusGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const columns = 7;
  for (let i = 0; i < columns; i++) {
    const angle = (i / columns) * Math.PI * 2 + random(i) * 0.5;
    const r = i === 0 ? 0 : 0.16 + random(i + 3) * 0.1;
    const h = 0.55 + random(i + 7) * 0.45;
    const col = new THREE.CylinderGeometry(0.075, 0.085, h, 8, 1, false);
    col.translate(Math.cos(angle) * r, h / 2 + 0.05, Math.sin(angle) * r);
    const cap = new THREE.SphereGeometry(0.075, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    cap.translate(Math.cos(angle) * r, h + 0.05, Math.sin(angle) * r);
    parts.push(col, cap);
  }
  const base = new THREE.CylinderGeometry(0.2, 0.26, 0.12, 8).translate(0, 0.06, 0);
  parts.push(base);
  const merged = mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
  // Darken the lower stems and add vertical rib striping.
  const pos = merged.getAttribute('position');
  const colors: number[] = [];
  const top = new THREE.Color('#7c8f64'),
    low = new THREE.Color('#56684a'),
    c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i),
      rib = 0.9 + 0.1 * Math.sin(Math.atan2(pos.getZ(i), pos.getX(i)) * 16);
    c.copy(low).lerp(top, Math.min(1, y)).multiplyScalar(rib);
    colors.push(c.r, c.g, c.b);
  }
  merged.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  merged.computeVertexNormals();
  return merged;
}

/** Agave rosette: long pointed leaves in a golden-angle spiral. */
function agaveGeometry() {
  const positions: number[] = [],
    colors: number[] = [];
  for (let leaf = 0; leaf < 15; leaf++) {
    const angle = leaf * 2.39996,
      length = 0.75 + random(leaf) * 0.8;
    const color = new THREE.Color(leaf % 3 ? '#6d8a79' : '#a3b3a2');
    for (let segment = 0; segment < 5; segment++) {
      const row = (t: number, side: number) => {
        const width = Math.sin(t * Math.PI) * 0.13 * side;
        const radius = t * length;
        return [
          Math.sin(angle) * radius + Math.cos(angle) * width,
          0.06 + 0.85 * Math.sin(t * 1.8) - 0.42 * t,
          Math.cos(angle) * radius - Math.sin(angle) * width,
        ];
      };
      const a = segment / 5,
        b = (segment + 1) / 5;
      for (const p of [row(a, -1), row(a, 1), row(b, -1), row(a, 1), row(b, 1), row(b, -1)]) {
        positions.push(...p);
        colors.push(color.r, color.g, color.b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

function grassGeometry() {
  const positions: number[] = [];
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4,
      x = Math.sin(a) * 0.12,
      z = Math.cos(a) * 0.12;
    const h = 0.5 + random(i + 1) * 0.5,
      lean = 0.04 + random(i + 5) * 0.06;
    positions.push(x - 0.014, 0, z, x + 0.014, 0, z, x + lean, h, z + lean * 0.5);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

function rockGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const k = 0.78 + random(i * 3.1) * 0.35;
    pos.setXYZ(i, pos.getX(i) * k, Math.max(-0.2, pos.getY(i)) * k * 0.6, pos.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Roadside delineator: white post with an amber reflector. */
function postGeometry() {
  const post = new THREE.BoxGeometry(0.1, 1, 0.1).translate(0, 0.5, 0).toNonIndexed();
  const band = new THREE.BoxGeometry(0.105, 0.12, 0.105).translate(0, 0.82, 0).toNonIndexed();
  const paint = (g: THREE.BufferGeometry, hex: string) => {
    const c = new THREE.Color(hex);
    g.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(
        Array.from({ length: g.getAttribute('position').count }, () => [c.r, c.g, c.b]).flat(),
        3,
      ),
    );
    return g;
  };
  return mergeGeometries([paint(post, '#ece6d6'), paint(band, '#e7a33e')])!;
}

function shadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 31);
  g.addColorStop(0, 'rgba(20,24,14,0.5)');
  g.addColorStop(0.45, 'rgba(20,24,14,0.28)');
  g.addColorStop(1, 'rgba(20,24,14,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const capacity: Record<PropKind, number> = {
  tree: 4500,
  cactus: 2400,
  agave: 5000,
  grass: 9000,
  rock: 2400,
  post: 800,
  shadow: 7000,
};

/** One instanced mesh per kind of prop, refilled whenever the set of nearby tiles changes. */
export class PropLayers {
  readonly group = new THREE.Group();
  private meshes = new Map<PropKind, THREE.InstancedMesh>();
  private disposables: { dispose(): void }[] = [];
  constructor(treeTexture: THREE.Texture) {
    const image = treeTexture.image as { width: number; height: number } | undefined;
    const aspect = image ? image.width / image.height : 1;
    treeTexture.colorSpace = THREE.SRGBColorSpace;
    const lit = (vertexColors = false, flat = false) =>
      new THREE.MeshStandardMaterial({
        color: '#ffffff',
        vertexColors,
        roughness: 0.95,
        flatShading: flat,
      });
    const shadowMap = shadowTexture();
    const make: Record<PropKind, [THREE.BufferGeometry, THREE.Material]> = {
      tree: [
        treeCards(aspect),
        new THREE.MeshBasicMaterial({
          map: treeTexture,
          alphaTest: 0.42,
          side: THREE.DoubleSide,
          toneMapped: false,
          color: '#e9e6dc',
        }),
      ],
      cactus: [cactusGeometry(), lit(true)],
      agave: [
        agaveGeometry(),
        new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.9,
          side: THREE.DoubleSide,
        }),
      ],
      grass: [
        grassGeometry(),
        new THREE.MeshStandardMaterial({ color: '#b9aa72', roughness: 1, side: THREE.DoubleSide }),
      ],
      rock: [
        rockGeometry(),
        new THREE.MeshStandardMaterial({ color: '#9b917f', roughness: 0.95, flatShading: true }),
      ],
      post: [postGeometry(), lit(true)],
      shadow: [
        new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({
          map: shadowMap,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      ],
    };
    for (const kind of Object.keys(make) as PropKind[]) {
      const [geometry, material] = make[kind];
      const mesh = new THREE.InstancedMesh(geometry, material, capacity[kind]);
      mesh.count = 0;
      mesh.frustumCulled = false;
      if (kind === 'shadow') mesh.renderOrder = 1;
      this.meshes.set(kind, mesh);
      this.group.add(mesh);
      this.disposables.push(geometry, material);
    }
    this.disposables.push(shadowMap);
  }
  /** Replace every instance from the props of the currently detailed tiles. */
  fill(props: Iterable<Prop>) {
    const counts = new Map<PropKind, number>();
    const o = new THREE.Object3D(),
      color = new THREE.Color(),
      up = new THREE.Vector3(0, 1, 0),
      normal = new THREE.Vector3();
    for (const p of props) {
      const mesh = this.meshes.get(p.kind)!;
      const i = counts.get(p.kind) ?? 0;
      if (i >= capacity[p.kind]) continue;
      counts.set(p.kind, i + 1);
      o.position.set(p.x, p.y, p.z);
      if (p.kind === 'shadow') {
        normal.set(p.nx ?? 0, 1, p.nz ?? 0).normalize();
        o.quaternion.setFromUnitVectors(up, normal);
        o.position.y += 0.04;
        o.scale.set(p.scale, 1, p.scale);
      } else {
        o.quaternion.setFromAxisAngle(up, p.rotation);
        o.scale.setScalar(p.scale);
      }
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      if (p.tint !== undefined) mesh.setColorAt(i, color.setScalar(p.tint));
    }
    for (const [kind, mesh] of this.meshes) {
      mesh.count = counts.get(kind) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}
