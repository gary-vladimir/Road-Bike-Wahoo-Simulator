import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import {
  Component,
  type MutableRefObject,
  type ReactNode,
  memo,
  useLayoutEffect,
  useRef,
} from 'react';
import * as THREE from 'three';
import type { Course } from '../ride/course';
import { proceduralGround, type Ground } from './ground';
import { TerrainTiles } from './tiles';
import { RoadChunks } from './road';
import { PropLayers } from './props';
import { FarRing, skyColors, skyDome, sunDirection } from './sky';

/** Latest engine state. The ride writes it on every tick; the scene reads it every frame. */
export type RideMotion = { distance: number; speed: number; at: number };
/** Extrapolate from the last engine tick so motion stays continuous between ticks. */
export function predictDistance(motion: RideMotion, now: number) {
  const ahead = THREE.MathUtils.clamp((now - motion.at) / 1000, 0, 0.25);
  return motion.distance + (motion.speed / 3.6) * ahead;
}

const lane = 1.75,
  eyeHeight = 1.55,
  lookAhead = 24;

function groundMaterial(map: THREE.Texture) {
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const material = new THREE.MeshStandardMaterial({
    map,
    color: '#f3eee0',
    vertexColors: true,
    roughness: 1,
  });
  // Two world-anchored scales break up visible repetition of the soil texture.
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        vec4 detail = texture2D(map, vMapUv);
        vec2 broadUv = mat2(0.8, -0.6, 0.6, 0.8) * vMapUv * 0.23 + vec2(0.31, 0.67);
        vec4 broad = texture2D(map, broadUv);
        diffuseColor *= mix(detail, broad, 0.5) * 1.08;
      #endif`,
    );
  };
  material.customProgramCacheKey = () => 'bikesim-ground-v2';
  return material;
}

function createWorld(
  course: Course,
  providedGround: Ground | undefined,
  groundMap: THREE.Texture,
  treeMap: THREE.Texture,
  meters: number,
  low: boolean,
) {
  course.ensure(meters + 2600);
  const ground = providedGround ?? proceduralGround(course);
  const material = groundMaterial(groundMap);
  // Untextured far terrain: darken to match the average of the textured near ground.
  const farMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    color: '#a49c86',
  });
  const tiles = new TerrainTiles(course, ground, material, low);
  const roads = new RoadChunks(course);
  const props = new PropLayers(treeMap);
  const far = new FarRing(ground, farMaterial);
  const sky = skyDome();
  // Build everything around the start before the first frame: no half-drawn world.
  const start = course.offset(meters, lane);
  tiles.update(start.x, start.z, Infinity);
  roads.update(meters, 1900, Infinity);
  far.update(start.x, start.z);
  props.fill([...tiles.props(), ...roads.props()]);
  const group = new THREE.Group();
  group.add(tiles.group, roads.group, props.group, far.mesh, sky);
  return {
    ground,
    tiles,
    roads,
    props,
    far,
    sky,
    group,
    dispose() {
      tiles.dispose();
      roads.dispose();
      props.dispose();
      far.dispose();
      sky.geometry.dispose();
      (sky.material as THREE.Material).dispose();
      material.dispose();
      farMaterial.dispose();
    },
  };
}

function World({
  course,
  ground: providedGround,
  motion,
  speed,
  quality,
  onReady,
}: {
  course: Course;
  ground?: Ground;
  motion?: MutableRefObject<RideMotion>;
  speed: number;
  quality: string;
  onReady?: () => void;
}) {
  const { scene, camera } = useThree();
  const [groundMap, treeMap] = useLoader(THREE.TextureLoader, [
    '/assets/valley-ground.jpg',
    '/assets/oaxaca-tree.webp',
  ]);
  const low = quality === 'low';
  const travel = useRef(motion?.current.distance ?? 0);
  const lean = useRef(0);
  const versions = useRef('');
  const ready = useRef(false);
  const worldRef = useRef<ReturnType<typeof createWorld> | null>(null);
  // Created and disposed together in one layout effect: React may run effects twice (Strict
  // Mode), and a world must never outlive its own disposal. Runs before the first frame.
  useLayoutEffect(() => {
    const world = createWorld(course, providedGround, groundMap, treeMap, travel.current, low);
    scene.add(world.group);
    scene.fog = new THREE.FogExp2(skyColors.haze, 0.00011);
    scene.background = skyColors.horizon;
    worldRef.current = world;
    versions.current = '';
    // Development-only handle for inspecting streaming and frame cost from the console.
    if (import.meta.env.DEV)
      Object.assign(window, { __bikesimScene: { ...world, course, camera } });
    return () => {
      worldRef.current = null;
      scene.remove(world.group);
      scene.fog = null;
      world.dispose();
    };
  }, [course, providedGround, groundMap, treeMap, scene, camera, low]);
  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    if (motion) {
      // Engine ticks arrive at ~10 Hz. Chasing each tick's distance makes the camera surge
      // and stall ten times per second; follow the extrapolated position instead.
      const target = predictDistance(motion.current, performance.now());
      const error = target - travel.current;
      travel.current =
        Math.abs(error) > 25 ? target : travel.current + error * (1 - Math.exp(-dt * 12));
    } else travel.current += (speed / 3.6) * dt;
    const s = Math.min(travel.current, course.length);
    course.ensure(s + 2600);
    const eye = course.offset(s, lane);
    const at = course.offset(s + lookAhead, lane);
    camera.position.set(eye.x, eye.y + eyeHeight, eye.z);
    camera.lookAt(at.x, at.y + eyeHeight * 0.45, at.z);
    // Lean gently into bends, a fraction of what a real bike would.
    const v = (motion?.current.speed ?? speed) / 3.6;
    const want = THREE.MathUtils.clamp(
      -Math.atan((v * v * course.curvature(s + 8)) / 9.81) * 0.35,
      -0.1,
      0.1,
    );
    lean.current += (want - lean.current) * (1 - Math.exp(-dt * 2.5));
    camera.rotateZ(lean.current);
    const world = worldRef.current;
    if (!world) return;
    const { tiles, roads, props, far, sky } = world;
    tiles.update(eye.x, eye.z, low ? 3 : 5);
    roads.update(s, 1900, 2);
    const version = `${tiles.propsVersion}:${roads.propsVersion}`;
    if (version !== versions.current) {
      versions.current = version;
      props.fill([...tiles.props(), ...roads.props()]);
    }
    far.update(eye.x, eye.z);
    sky.position.copy(camera.position);
    (sky.material as THREE.ShaderMaterial).uniforms.time.value = state.clock.elapsedTime;
    if (!ready.current) {
      ready.current = true;
      setTimeout(() => onReady?.(), 0);
    }
  }, -1);
  return (
    <>
      <hemisphereLight args={['#dfe9f0', '#9c8b67', 1.35]} />
      <directionalLight
        position={sunDirection.clone().multiplyScalar(100)}
        color="#fff0d8"
        intensity={2.3}
      />
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
      <div className="scene-fallback">3D is unavailable. Your ride metrics still work.</div>
    ) : (
      this.props.children
    );
  }
}

type SceneProps = {
  course: Course;
  /** Terrain model for real roads; procedural hills otherwise. */
  ground?: Ground;
  motion?: MutableRefObject<RideMotion>;
  /** Constant preview speed in km/h when no ride motion is supplied. */
  speed?: number;
  quality?: string;
  /** Whether the view is moving; idle scenes render only on demand. */
  moving?: boolean;
  onReady?: () => void;
};
function RoadScene({
  course,
  ground,
  motion,
  speed = 0,
  quality = 'high',
  moving = speed > 0,
  onReady,
}: SceneProps) {
  return (
    <SceneBoundary onReady={onReady}>
      <Canvas
        // Display-synced frames while moving; idle scenes render on demand.
        frameloop={moving ? 'always' : 'demand'}
        dpr={quality === 'low' ? 1 : [1, 1.5]}
        camera={{ fov: 62, near: 0.1, far: 30000 }}
        gl={{
          antialias: quality !== 'low',
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.02,
        }}
      >
        <World
          course={course}
          ground={ground}
          motion={motion}
          speed={speed}
          quality={quality}
          onReady={onReady}
        />
      </Canvas>
    </SceneBoundary>
  );
}
export default memo(RoadScene);
