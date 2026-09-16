import * as THREE from 'three';

type Grid = { start: number; length: number; rows: number; columns: number };
const lateralAt = (j: number, columns: number) => {
  const t = (j / columns) * 2 - 1;
  return Math.sign(t) * Math.abs(t) ** 1.7 * 850;
};
const columnAt = (lateral: number, columns: number) =>
  ((Math.sign(lateral) * (Math.abs(lateral) / 850) ** (1 / 1.7) + 1) * columns) / 2;

/** Place roots on the rendered triangles, including low-detail terrain interpolation. */
export function terrainSampler(ground: THREE.BufferGeometry) {
  const { start, length, rows, columns } = ground.userData.terrain as Grid;
  const positions = ground.getAttribute('position');
  return (meters: number, lateral: number) => {
    const row = THREE.MathUtils.clamp(((meters - start) / length) * rows, 0, rows);
    const i = Math.min(rows - 1, Math.floor(row));
    const j = THREE.MathUtils.clamp(Math.floor(columnAt(lateral, columns)), 0, columns - 1);
    const u = THREE.MathUtils.clamp(
      (lateral - lateralAt(j, columns)) / (lateralAt(j + 1, columns) - lateralAt(j, columns)),
      0,
      1,
    );
    const v = row - i;
    const k = i * (columns + 1) + j;
    const vertex = (index: number) => new THREE.Vector3().fromBufferAttribute(positions, index);
    return u + v <= 1
      ? vertex(k)
          .multiplyScalar(1 - u - v)
          .addScaledVector(vertex(k + 1), u)
          .addScaledVector(vertex(k + columns + 1), v)
      : vertex(k + columns + 2)
          .multiplyScalar(u + v - 1)
          .addScaledVector(vertex(k + 1), 1 - v)
          .addScaledVector(vertex(k + columns + 1), 1 - u);
  };
}

export type ContactPatch = { meters: number; lateral: number; radius: number };
/** Reuse complete ground triangles; an independent flat decal can float above a hill. */
export function contactGeometry(ground: THREE.BufferGeometry, patches: ContactPatch[]) {
  const { start, length, rows, columns } = ground.userData.terrain as Grid;
  const source = ground.getAttribute('position');
  const indices = ground.getIndex()!;
  const points: number[] = [],
    uv: number[] = [];
  for (const patch of patches) {
    const firstRow = Math.max(
      0,
      Math.floor(((patch.meters - patch.radius - start) / length) * rows),
    );
    const lastRow = Math.min(
      rows - 1,
      Math.floor(((patch.meters + patch.radius - start) / length) * rows),
    );
    const firstCol = Math.max(0, Math.floor(columnAt(patch.lateral - patch.radius, columns)));
    const lastCol = Math.min(
      columns - 1,
      Math.floor(columnAt(patch.lateral + patch.radius, columns)),
    );
    for (let i = firstRow; i <= lastRow; i++) {
      for (let j = firstCol; j <= lastCol; j++) {
        for (let n = 0; n < 6; n++) {
          const index = indices.getX((i * columns + j) * 6 + n);
          const row = Math.floor(index / (columns + 1)),
            col = index % (columns + 1);
          points.push(source.getX(index), source.getY(index) + 0.008, source.getZ(index));
          uv.push(
            0.5 + (lateralAt(col, columns) - patch.lateral) / (patch.radius * 2),
            0.5 + (start + (row * length) / rows - patch.meters) / (patch.radius * 2),
          );
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return geometry;
}

export function contactTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 63);
  gradient.addColorStop(0, 'rgba(25,32,19,0.42)');
  gradient.addColorStop(0.3, 'rgba(25,32,19,0.26)');
  gradient.addColorStop(0.7, 'rgba(25,32,19,0.08)');
  gradient.addColorStop(1, 'rgba(25,32,19,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A fixed compass orientation lets hills and turns move the distant skyline naturally. */
export function panoramaGeometry() {
  const points: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const rows = 24,
    columns = 64,
    radius = 2600;
  for (let i = 0; i <= rows; i++) {
    const pitch = THREE.MathUtils.degToRad(-28 + (i / rows) * 86);
    for (let j = 0; j <= columns; j++) {
      const yaw = THREE.MathUtils.degToRad(-100 + (j / columns) * 200);
      points.push(
        radius * Math.sin(yaw) * Math.cos(pitch),
        radius * Math.sin(pitch),
        -radius * Math.cos(yaw) * Math.cos(pitch),
      );
      uv.push(j / columns, i / rows);
      if (i < rows && j < columns) {
        const k = i * (columns + 1) + j;
        indices.push(k, k + 1, k + columns + 1, k + 1, k + columns + 2, k + columns + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  return geometry;
}

/** Rotate the rail's local X axis onto both the horizontal and vertical post separation. */
export function railOrientation(a: THREE.Vector3, b: THREE.Vector3) {
  const d = b.clone().sub(a);
  return { rotation: Math.atan2(-d.z, d.x), tilt: Math.atan2(d.y, Math.hypot(d.x, d.z)) };
}
