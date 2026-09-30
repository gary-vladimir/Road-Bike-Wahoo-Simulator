import * as THREE from 'three';
import { groundColor, smoothstep, type Ground } from './ground';

/** Afternoon sun from the southwest, about 38° high. */
export const sunDirection = new THREE.Vector3(-0.55, 0.62, 0.56).normalize();
export const skyColors = {
  zenith: new THREE.Color('#5d8fc9'),
  horizon: new THREE.Color('#cfdbe3'),
  haze: new THREE.Color('#c9d3d6'),
};

/** Gradient sky with a soft sun and drifting fair-weather clouds. */
export function skyDome() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: skyColors.zenith },
      horizon: { value: skyColors.horizon },
      sun: { value: sunDirection },
      time: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        // Drawn first without depth writes, so everything else paints over it.
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 zenith; uniform vec3 horizon; uniform vec3 sun; uniform float time;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
        return v;
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 col = mix(horizon, zenith, pow(h, 0.55));
        float s = max(dot(d, sun), 0.0);
        col += vec3(1.0, 0.92, 0.75) * (pow(s, 900.0) * 3.0 + pow(s, 12.0) * 0.22);
        // Clouds on a plane high above: thin near the horizon, drifting slowly.
        if (d.y > 0.02) {
          vec2 uv = d.xz / (d.y + 0.08) * 0.9 + vec2(time * 0.004, time * 0.0015);
          float c = smoothstep(0.52, 0.8, fbm(uv));
          float fade = smoothstep(0.02, 0.25, d.y);
          vec3 cloud = mix(vec3(0.83, 0.85, 0.88), vec3(1.0), pow(s, 3.0) * 0.6 + 0.3);
          col = mix(col, cloud, c * fade * 0.85);
        }
        col = mix(col, horizon * 0.96, smoothstep(0.02, -0.08, d.y));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), material);
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  return mesh;
}

const inner = 1500,
  outer = 16000,
  rings = 40,
  segments = 128;

/**
 * Terrain from beyond the detailed tiles out to the horizon: ridges in every direction that
 * move correctly as the road turns. Its inner edge sinks below the tiles it overlaps.
 */
export class FarRing {
  readonly mesh: THREE.Mesh;
  private center = new THREE.Vector2(Infinity, Infinity);
  constructor(
    private ground: Ground,
    material: THREE.Material,
  ) {
    const geometry = new THREE.BufferGeometry();
    const count = (rings + 1) * (segments + 1);
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    const indices: number[] = [];
    for (let r = 0; r < rings; r++)
      for (let a = 0; a < segments; a++) {
        const i = r * (segments + 1) + a;
        indices.push(i, i + 1, i + segments + 1, i + 1, i + segments + 2, i + segments + 1);
      }
    geometry.setIndex(indices);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
  }
  update(x: number, z: number) {
    if (this.center.distanceTo(new THREE.Vector2(x, z)) < 700) return;
    this.center.set(x, z);
    const g = this.mesh.geometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute,
      col = g.getAttribute('color') as THREE.BufferAttribute,
      uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const rgb = [0, 0, 0];
    for (let r = 0; r <= rings; r++) {
      // Rings get sparser with distance.
      const radius = inner * (outer / inner) ** (r / rings);
      for (let a = 0; a <= segments; a++) {
        const angle = (a / segments) * Math.PI * 2;
        const px = x + Math.cos(angle) * radius,
          pz = z + Math.sin(angle) * radius;
        const sink = 14 * (1 - smoothstep(inner, inner * 1.35, radius));
        const y = this.ground.natural(px, pz) - sink;
        const i = r * (segments + 1) + a;
        pos.setXYZ(i, px, y, pz);
        groundColor(px, pz, y, this.ground.floor(px, pz), 0.2, 1e4, rgb);
        col.setXYZ(i, rgb[0], rgb[1], rgb[2]);
        uv.setXY(i, px / 7, pz / 7);
      }
    }
    pos.needsUpdate = col.needsUpdate = uv.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingSphere();
  }
  dispose() {
    this.mesh.geometry.dispose();
  }
}
