import * as THREE from 'three';
import { courseStep, type Course } from '../ride/course';
import { roadHalfWidth } from './ground';
import type { Prop } from './props';

const chunkLength = 200;
const shoulder = 1.3;

const random = (seed: number) => {
  const v = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};

/** Asphalt with edge lines and a dashed centerline painted into the road's own UVs. */
export function pavementTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#56574f';
  ctx.fillRect(0, 0, 512, 1024);
  for (let i = 0; i < 70000; i++) {
    const light = Math.floor(58 + random(i * 3) * 70);
    ctx.fillStyle = `rgba(${light},${light},${light - 5},.32)`;
    ctx.fillRect(
      random(i + 4) * 512,
      random(i + 8) * 1024,
      1 + random(i) * 2,
      1 + random(i + 1) * 2,
    );
  }
  // Tire tracks: slightly darker, polished bands in each lane.
  for (const x of [118, 150, 362, 394]) {
    ctx.fillStyle = 'rgba(30,30,28,.12)';
    ctx.fillRect(x - 14, 0, 28, 1024);
  }
  ctx.fillStyle = '#e8e4d2';
  ctx.fillRect(20, 0, 7, 1024);
  ctx.fillRect(485, 0, 7, 1024);
  ctx.fillStyle = '#e2bf5f';
  ctx.fillRect(250, 0, 12, 470);
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = 'rgba(70,70,62,.25)';
    ctx.fillRect(random(i + 77) * 512, random(i + 56) * 1024, 1, 3);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function kmTexture(km: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 160;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f2efe4';
  ctx.fillRect(0, 0, 128, 160);
  ctx.fillStyle = '#1f3d2b';
  ctx.fillRect(0, 0, 128, 40);
  ctx.fillStyle = '#f2efe4';
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('KM', 64, 30);
  ctx.fillStyle = '#1b1b1b';
  ctx.font = 'bold 64px sans-serif';
  ctx.fillText(String(km), 64, 118);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

type Chunk = {
  index: number;
  group: THREE.Group;
  disposables: { dispose(): void }[];
  props: Prop[];
};

/** Streams road chunks from just behind the rider to the horizon. */
export class RoadChunks {
  readonly group = new THREE.Group();
  private chunks = new Map<number, Chunk>();
  private asphalt: THREE.MeshStandardMaterial;
  private verge: THREE.MeshStandardMaterial;
  private texture = pavementTexture();
  propsVersion = 0;
  constructor(private course: Course) {
    this.asphalt = new THREE.MeshStandardMaterial({
      map: this.texture,
      roughness: 0.93,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.verge = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
  }

  private build(index: number): Chunk {
    const course = this.course;
    const s0 = index * chunkLength,
      s1 = Math.min(course.length, s0 + chunkLength);
    const steps = Math.max(1, Math.round((s1 - s0) / courseStep));
    const road: number[] = [],
      roadUv: number[] = [],
      side: number[] = [],
      sideColor: number[] = [];
    const roadIdx: number[] = [],
      sideIdx: number[] = [];
    for (let k = 0; k <= steps; k++) {
      const s = s0 + ((s1 - s0) * k) / steps;
      const p = course.point(s),
        d = course.direction(s),
        y = course.elevation(s);
      const rx = -d.z,
        rz = d.x;
      for (const lateral of [-roadHalfWidth, roadHalfWidth]) {
        road.push(p.x + rx * lateral, y + 0.02, p.z + rz * lateral);
        roadUv.push(lateral < 0 ? 0 : 1, s / 12);
      }
      const dust = 0.36 + random(s * 0.37) * 0.06;
      // Gravel shoulder, then a short strip sloping into the terrain so no edge can show.
      for (const [lateral, drop] of [
        [-roadHalfWidth - shoulder - 0.8, -0.55],
        [-roadHalfWidth - shoulder, -0.08],
        [-roadHalfWidth, 0.01],
        [roadHalfWidth, 0.01],
        [roadHalfWidth + shoulder, -0.08],
        [roadHalfWidth + shoulder + 0.8, -0.55],
      ]) {
        side.push(p.x + rx * lateral, y + drop, p.z + rz * lateral);
        sideColor.push(dust, dust * 0.91, dust * 0.78);
      }
      if (k < steps) {
        const a = k * 2;
        // Counter-clockwise seen from above: left edge → right edge → next sample.
        roadIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        const b = k * 6;
        // Quads between neighboring lateral vertices, except across the asphalt (2→3).
        for (const a of [b, b + 1, b + 3, b + 4])
          sideIdx.push(a, a + 1, a + 6, a + 1, a + 7, a + 6);
      }
    }
    const make = (pos: number[], idx: number[], extra: (g: THREE.BufferGeometry) => void) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      extra(g);
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const roadGeometry = make(road, roadIdx, (g) =>
      g.setAttribute('uv', new THREE.Float32BufferAttribute(roadUv, 2)),
    );
    const sideGeometry = make(side, sideIdx, (g) =>
      g.setAttribute('color', new THREE.Float32BufferAttribute(sideColor, 3)),
    );
    const group = new THREE.Group();
    group.add(new THREE.Mesh(roadGeometry, this.asphalt), new THREE.Mesh(sideGeometry, this.verge));
    const disposables: { dispose(): void }[] = [roadGeometry, sideGeometry];
    const props: Prop[] = [];
    // Delineators every 50 m on both verges.
    for (let s = Math.ceil(s0 / 50) * 50; s < s1; s += 50)
      for (const lateral of [-(roadHalfWidth + 1.2), roadHalfWidth + 1.2]) {
        const q = course.offset(s, lateral);
        const d = course.direction(s);
        props.push({
          kind: 'post',
          x: q.x,
          y: q.y - 0.05,
          z: q.z,
          scale: 1,
          rotation: Math.atan2(d.x, d.z),
        });
      }
    // Kilometer posts on the right verge.
    for (let s = Math.ceil(s0 / 1000) * 1000; s < s1; s += 1000) {
      if (s === 0) continue;
      const q = course.offset(s, roadHalfWidth + 2.2);
      const d = course.direction(s);
      const texture = kmTexture(s / 1000);
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(0.5, 0.62),
        new THREE.MeshStandardMaterial({ map: texture, roughness: 0.7 }),
      );
      plate.position.set(q.x, q.y + 1.05, q.z);
      // Face riders coming up the road.
      plate.rotation.y = Math.atan2(-d.x, -d.z);
      const pole = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.8, 0.08),
        new THREE.MeshStandardMaterial({ color: '#dcd6c6' }),
      );
      pole.position.set(q.x, q.y + 0.4, q.z);
      group.add(plate, pole);
      disposables.push(
        texture,
        plate.geometry,
        plate.material as THREE.Material,
        pole.geometry,
        pole.material as THREE.Material,
      );
    }
    return { index, group, disposables, props };
  }

  /** Keep chunks from just behind `meters` to `ahead` meters in front, within a time budget. */
  update(meters: number, ahead: number, budgetMs: number) {
    const first = Math.max(0, Math.floor((meters - 150) / chunkLength));
    const last = Math.floor(Math.min(this.course.length - 1e-6, meters + ahead) / chunkLength);
    for (const [index, chunk] of this.chunks)
      if (index < first || index > last) {
        this.group.remove(chunk.group);
        chunk.disposables.forEach((d) => d.dispose());
        this.chunks.delete(index);
        this.propsVersion++;
      }
    const start = performance.now();
    for (let index = first; index <= last; index++) {
      if (this.chunks.has(index)) continue;
      if (performance.now() - start > budgetMs) return true;
      const chunk = this.build(index);
      this.chunks.set(index, chunk);
      this.group.add(chunk.group);
      this.propsVersion++;
    }
    return false;
  }

  *props() {
    for (const chunk of this.chunks.values()) yield* chunk.props;
  }

  dispose() {
    for (const chunk of this.chunks.values()) chunk.disposables.forEach((d) => d.dispose());
    this.chunks.clear();
    this.asphalt.dispose();
    this.verge.dispose();
    this.texture.dispose();
  }
}
