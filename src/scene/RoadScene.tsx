import { Canvas, useFrame, useThree, useLoader } from '@react-three/fiber';
import { Component, type ReactNode, memo, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import Vegetation, { type TreePlacement } from './Vegetation';
import type { Route } from '../ride/terrain';
import {
  agaveGeometry,
  grassGeometry,
  heading,
  pavementTexture,
  random,
  ribbon,
  roadPoint,
  terrainGeometry,
  terrainPoint,
} from './landscape';

type Placement = {
  position: THREE.Vector3;
  scale: [number, number, number];
  rotation?: number;
  color?: string;
};
function Instances({
  geometry,
  items,
  color,
  vertexColors = false,
}: {
  geometry: THREE.BufferGeometry;
  items: Placement[];
  color: string;
  vertexColors?: boolean;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    if (!ref.current) return;
    const object = new THREE.Object3D();
    items.forEach((p, i) => {
      object.position.copy(p.position);
      object.scale.set(...p.scale);
      object.rotation.set(0, p.rotation ?? 0, 0);
      object.updateMatrix();
      ref.current!.setMatrixAt(i, object.matrix);
      ref.current!.setColorAt(i, new THREE.Color(p.color ?? color));
    });
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
    ref.current.computeBoundingSphere();
    invalidate();
  }, [items, color, invalidate]);
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, items.length]}>
      <meshStandardMaterial
        color="white"
        vertexColors={vertexColors}
        roughness={1}
        side={vertexColors ? THREE.DoubleSide : THREE.FrontSide}
      />
    </instancedMesh>
  );
}
function Landscape({ start, route, low }: { start: number; route?: Route; low: boolean }) {
  const length = 1440;
  const [groundMap, treeMap] = useLoader(THREE.TextureLoader, [
    '/assets/valley-ground.jpg',
    '/assets/oaxaca-tree.webp',
  ]);
  useMemo(() => {
    groundMap.wrapS = groundMap.wrapT = THREE.RepeatWrapping;
    groundMap.colorSpace = THREE.SRGBColorSpace;
    groundMap.anisotropy = 4;
    treeMap.colorSpace = THREE.SRGBColorSpace;
  }, [groundMap, treeMap]);
  const geometries = useMemo(
    () => ({
      ground: terrainGeometry(start, length, route, low),
      shoulder: ribbon(start, length, 9, route, 0.005),
      road: ribbon(start, length, 7.2, route, 0.025),
      rock: new THREE.IcosahedronGeometry(1, 0),
      agave: agaveGeometry(),
      grass: grassGeometry(),
      post: new THREE.BoxGeometry(0.12, 1, 0.12),
      rail: new THREE.BoxGeometry(1, 0.045, 0.045),
    }),
    [start, route, low],
  );
  const texture = useMemo(pavementTexture, []);
  const groundMaterial = useMemo(() => {
    const material = new THREE.MeshStandardMaterial({
      map: groundMap,
      color: '#efead9',
      vertexColors: true,
      roughness: 1,
    });
    // Two world-anchored scales break up obvious repeating rows in the soil texture.
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec4 detail = texture2D(map, vMapUv);
          vec2 broadUv = mat2(0.8, -0.6, 0.6, 0.8) * vMapUv * 0.27 + vec2(0.31, 0.67);
          vec4 broad = texture2D(map, broadUv);
          diffuseColor *= mix(detail, broad, 0.48);
        #endif`,
      );
    };
    material.customProgramCacheKey = () => 'bikesim-ground-two-scales-v1';
    return material;
  }, [groundMap]);
  useEffect(() => () => groundMaterial.dispose(), [groundMaterial]);
  useEffect(
    () => () => {
      Object.values(geometries).forEach((g) => g.dispose());
    },
    [geometries],
  );
  useEffect(() => () => texture.dispose(), [texture]);
  const items = useMemo(() => {
    const trees: TreePlacement[] = [];
    const rocks: Placement[] = [],
      agaves: Placement[] = [],
      grasses: Placement[] = [],
      posts: Placement[] = [],
      rails: Placement[] = [];
    const place = (s: number, lateral: number) => terrainPoint(s, lateral, route);
    const step = low ? 11 : 7;
    for (let s = Math.floor(start / step) * step; s < start + length; s += step) {
      const seed = s + 12000,
        side = random(seed) > 0.5 ? 1 : -1;
      const lateral = side * (7 + random(seed + 4) ** 2 * 95);
      const p = place(s, lateral),
        size = 1 + random(seed + 9) * 2.5;
      if (random(seed + 6) > 0.45) {
        trees.push({ position: p.clone(), size: size * 3.6, rotation: -Math.atan(heading(s)) });
      } else {
        rocks.push({
          position: p.clone().add(new THREE.Vector3(0, size * 0.17, 0)),
          scale: [size * 0.65, size * 0.35, size * 0.5],
          rotation: seed,
          color: random(seed + 3) > 0.5 ? '#aaa18b' : '#8c8976',
        });
      }
      for (let j = 0; j < 3; j++) {
        const pos = place(s + j * 2.1, side * (6.4 + random(seed + j + 44) * 19));
        const scale = 0.5 + random(seed + j + 25) * 0.6;
        agaves.push({ position: pos, scale: [scale, scale, scale], rotation: seed + j });
      }
      for (let j = 0; j < (low ? 4 : 12); j++) {
        const pos = place(
          s + random(seed + j * 12) * step,
          (j % 2 ? 1 : -1) * (4.7 + random(seed + j * 14) * 23),
        );
        const h = 0.2 + random(seed + j) * 0.5;
        grasses.push({
          position: pos,
          scale: [1.5, h, 1.5],
          rotation: seed,
          color: j % 2 ? '#a49d6b' : '#8d9565',
        });
      }
    }
    for (let s = Math.floor(start / 24) * 24; s < start + length; s += 24) {
      for (const side of [-1, 1]) {
        const p = place(s, side * 4.8);
        posts.push({
          position: p.clone().add(new THREE.Vector3(0, 0.48, 0)),
          scale: [1.7, 0.96, 1.7],
          rotation: -Math.atan(heading(s)),
          color: '#e5dfc5',
        });
        posts.push({
          position: p.clone().add(new THREE.Vector3(0, 0.83, 0)),
          scale: [1.8, 0.12, 1.8],
          rotation: -Math.atan(heading(s)),
          color: side > 0 ? '#bc7850' : '#e1bc69',
        });
      }
    }
    for (let s = Math.floor(start / 8) * 8; s < start + length; s += 8) {
      if (Math.floor(s / 240) % 3 !== 0) continue;
      const p = place(s, -11),
        q = place(s + 8, -11);
      posts.push({
        position: p.clone().add(new THREE.Vector3(0, 0.6, 0)),
        scale: [1.1, 1.2, 1.1],
        color: '#857555',
      });
      for (const h of [0.45, 0.95])
        rails.push({
          position: p
            .clone()
            .lerp(q, 0.5)
            .add(new THREE.Vector3(0, h, 0)),
          scale: [p.distanceTo(q), 1, 1],
          rotation: Math.atan2(-(q.z - p.z), q.x - p.x),
        });
    }
    return { trees, rocks, agaves, grasses, posts, rails };
  }, [start, route, low]);
  return (
    <>
      <mesh geometry={geometries.ground} material={groundMaterial} />
      <mesh geometry={geometries.shoulder}>
        <meshStandardMaterial color="#c4b596" roughness={1} />
      </mesh>
      <mesh geometry={geometries.road}>
        <meshStandardMaterial map={texture} roughness={0.96} />
      </mesh>

      <Vegetation texture={treeMap} trees={items.trees} />

      <Instances geometry={geometries.rock} items={items.rocks} color="#a69b83" />
      <Instances geometry={geometries.agave} items={items.agaves} color="#ffffff" vertexColors />
      <Instances geometry={geometries.grass} items={items.grasses} color="#a49d6b" />
      <Instances geometry={geometries.post} items={items.posts} color="#e5dfc5" />
      <Instances geometry={geometries.rail} items={items.rails} color="#8e7d60" />
    </>
  );
}
function World({
  speed,
  distance,
  grade,
  quality,
  route,
  onReady,
}: SceneProps & { speed: number; grade: number; quality: string }) {
  const invalidate = useThree((s) => s.invalidate);
  const horizon = useLoader(THREE.TextureLoader, '/assets/sierra-horizon.jpg');
  horizon.colorSpace = THREE.SRGBColorSpace;
  horizon.repeat.set(1, 0.65);
  const travel = useRef(distance ?? 0),
    ready = useRef(false);
  const [section, setSection] = useState(Math.floor((distance ?? 0) / 240));
  const activeSection = useRef(section);
  useEffect(() => {
    if (speed <= 0) return;
    const timer = setInterval(invalidate, quality === 'low' ? 1000 / 30 : 1000 / 60);
    return () => clearInterval(timer);
  }, [speed > 0, quality, invalidate]);
  useFrame(({ camera }, delta) => {
    if (!ready.current) {
      ready.current = true;
      setTimeout(() => onReady?.(), 0);
    }
    const dt = Math.min(delta, 0.1);
    if (distance !== undefined)
      travel.current =
        speed === 0 ? distance : THREE.MathUtils.damp(travel.current, distance, 20, dt);
    else travel.current += (speed / 3.6) * dt;
    const s = travel.current,
      next = Math.floor(s / 240);
    if (next !== activeSection.current) {
      activeSection.current = next;
      setSection(next);
    }
    const eye = roadPoint(s, 1.65, route, 1.62);
    const look = roadPoint(s + 32, 1.65, route, 1.15);
    if (!route) look.y += grade * 0.24;
    camera.position.copy(eye);
    camera.lookAt(look);
  });
  return (
    <>
      <primitive attach="background" object={horizon} />
      <fog attach="fog" args={['#cbd6c5', 240, 1250]} />

      <hemisphereLight args={['#e1edf0', '#b2a17a', 1.7]} />
      <directionalLight position={[-100, 160, -120]} color="#fff1d1" intensity={1.9} />
      <Landscape start={section * 240 - 160} route={route} low={quality === 'low'} />
    </>
  );
}
class SceneBoundary extends Component<
  { children: ReactNode; onReady?: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onReady?.();
  }
  render() {
    return this.state.failed ? (
      <div className="scene-fallback">
        3D is unavailable. Your workout metrics are still available.
      </div>
    ) : (
      this.props.children
    );
  }
}
type SceneProps = {
  speed?: number;
  distance?: number;
  grade?: number;
  quality?: string;
  route?: Route;
  onReady?: () => void;
};
function RoadScene({
  speed = 0,
  distance,
  grade = 0,
  quality = 'high',
  route,
  onReady,
}: SceneProps) {
  return (
    <SceneBoundary onReady={onReady}>
      <Canvas
        frameloop="demand"
        dpr={quality === 'low' ? 1 : [1, 1.5]}
        camera={{ fov: 66, near: 0.1, far: 3500 }}
        gl={{
          antialias: quality !== 'low',
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
        }}
      >
        <World
          speed={speed}
          distance={distance}
          grade={grade}
          quality={quality}
          route={route}
          onReady={onReady}
        />
      </Canvas>
    </SceneBoundary>
  );
}
export default memo(RoadScene);
