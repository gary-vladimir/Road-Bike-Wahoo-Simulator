import * as THREE from 'three';
import { routePosition, type Route } from '../ride/terrain';

export const roadWidth = 7.2;
export const centerline = (s: number) => 32 * Math.sin(s / 210) + 14 * Math.sin(s / 97);
export const heading = (s: number) => (32 / 210) * Math.cos(s / 210) + (14 / 97) * Math.cos(s / 97);
export const elevation = (s: number, route?: Route) =>
  route ? routePosition(route, Math.max(0, s)).elevation : 0;
/** One world-space frame for asphalt, paint UVs, shoulders, vegetation and camera. */
export function roadPoint(s: number, lateral: number, route?: Route, lift = 0) {
  const tangent = heading(s),
    norm = Math.hypot(1, tangent);
  return new THREE.Vector3(
    centerline(s) + lateral / norm,
    elevation(s, route) + lift,
    -s + (lateral * tangent) / norm,
  );
}
export function random(seed: number) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}
export function groundHeight(s: number, lateral: number, route?: Route) {
  const blend = THREE.MathUtils.smoothstep(Math.abs(lateral), 7, 100);
  const hills =
    8 +
    12 * Math.sin(s / 93 + lateral / 58) +
    16 * Math.sin(s / 211 - lateral / 95) +
    10 * Math.cos(lateral / 35);
  return elevation(s, route) - 0.08 + blend * Math.max(-3, hills * 0.38);
}
/** Keep the near verge normal to the road, then straighten distant terrain rows.
 * Extending road normals hundreds of meters past a tight bend folds the mesh. */
export function terrainPoint(s: number, lateral: number, route?: Route) {
  const p = roadPoint(s, lateral, route);
  const blend = THREE.MathUtils.smoothstep(Math.abs(lateral), 40, 140);
  p.x = THREE.MathUtils.lerp(p.x, centerline(s) + lateral, blend);
  p.z = THREE.MathUtils.lerp(p.z, -s, blend);
  p.y = groundHeight(s, lateral, route);
  return p;
}
export function ribbon(start: number, length: number, width: number, route?: Route, lift = 0) {
  const points: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const count = Math.ceil(length / 2);
  for (let i = 0; i <= count; i++) {
    const s = start + (i * length) / count;
    for (const side of [-1, 1]) {
      const p = roadPoint(s, (side * width) / 2, route, lift);
      points.push(p.x, p.y, p.z);
      uv.push(side === -1 ? 0 : 1, s / 12);
    }
    if (i < count) {
      const k = i * 2;
      indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
export function terrainGeometry(start: number, length: number, route?: Route, low = false) {
  const points: number[] = [],
    colors: number[] = [],
    indices: number[] = [],
    uv: number[] = [];
  const rows = low ? 72 : 144,
    columns = low ? 60 : 100;
  const sand = new THREE.Color('#faf2dd'),
    green = new THREE.Color('#bdc2a9'),
    ochre = new THREE.Color('#e5cfac');
  for (let i = 0; i <= rows; i++) {
    const s = start + (i * length) / rows;
    for (let j = 0; j <= columns; j++) {
      // Dense samples beside the pavement; broad patches farther into the hills.
      const t = (j / columns) * 2 - 1;
      const lateral = Math.sign(t) * Math.pow(Math.abs(t), 1.7) * 850;
      const p = terrainPoint(s, lateral, route);
      points.push(p.x, p.y, p.z);
      uv.push(p.x / 7, s / 7);
      const color = sand
        .clone()
        .lerp(
          green,
          THREE.MathUtils.clamp(
            0.35 + 0.3 * Math.sin(s / 48 + lateral / 31) + 0.22 * Math.cos(s / 27 - lateral / 47),
            0,
            1,
          ),
        );
      color.lerp(ochre, random(s * 193 + j) * 0.25);
      colors.push(color.r, color.g, color.b);
      if (i < rows && j < columns) {
        const k = i * (columns + 1) + j;
        indices.push(k, k + 1, k + columns + 1, k + 1, k + columns + 2, k + columns + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
export function pavementTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#5c5d56';
  ctx.fillRect(0, 0, 512, 1024);
  for (let i = 0; i < 85000; i++) {
    const light = Math.floor(65 + random(i * 3) * 65);
    ctx.fillStyle = `rgba(${light},${light},${light - 4},.35)`;
    ctx.fillRect(
      random(i + 4) * 512,
      random(i + 8) * 1024,
      1 + random(i) * 2,
      1 + random(i + 1) * 2,
    );
  }
  // Painted directly into the road's own UVs: curves cannot separate paint from asphalt.
  ctx.fillStyle = '#e5e2ce';
  ctx.fillRect(23, 0, 5, 1024);
  ctx.fillRect(484, 0, 5, 1024);
  ctx.fillStyle = '#dfbd63';
  ctx.fillRect(252, 0, 8, 427);
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = 'rgba(80,80,70,.23)';
    ctx.fillRect(random(i + 77) * 512, random(i + 56) * 1024, 1, 3);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}
export function agaveGeometry() {
  const positions: number[] = [],
    colors: number[] = [];
  for (let leaf = 0; leaf < 13; leaf++) {
    const angle = leaf * 2.39996,
      length = 0.8 + random(leaf) * 0.8;
    const color = new THREE.Color(leaf % 3 ? '#668776' : '#a1afa0');
    for (let segment = 0; segment < 5; segment++) {
      const row = (t: number, side: number) => {
        const width = Math.sin(t * Math.PI) * 0.13 * side;
        const radius = t * length;
        return [
          Math.sin(angle) * radius + Math.cos(angle) * width,
          0.08 + 0.85 * Math.sin(t * 1.8) - 0.4 * t,
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
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}
export function grassGeometry() {
  const positions: number[] = [];
  for (let i = 0; i < 7; i++) {
    const a = i * 2.4,
      x = Math.sin(a) * 0.1,
      z = Math.cos(a) * 0.1;
    const h = 0.5 + random(i + 1) * 0.5;
    positions.push(
      x - 0.012,
      0,
      z,
      x + 0.012,
      0,
      z,
      x + 0.06,
      h * 0.6,
      z + 0.02,
      x + 0.012,
      0,
      z,
      x + 0.085,
      h,
      z + 0.04,
      x + 0.06,
      h * 0.6,
      z + 0.02,
    );
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}
