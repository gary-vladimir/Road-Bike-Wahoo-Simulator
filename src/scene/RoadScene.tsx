import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Component, type ReactNode, memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

const curve = (z: number) => 14 * Math.sin(z / 130) + 7 * Math.sin(z / 63);
function Ribbon({
  width,
  offset = 0,
  color,
  layer = 1,
}: {
  width: number;
  offset?: number;
  color: string;
  layer?: number;
}) {
  const geometry = useMemo(() => {
    const positions: number[] = [],
      indices: number[] = [];
    for (let i = 0; i <= 220; i++) {
      const z = -25 + i * 3;
      positions.push(
        curve(z) + offset - width / 2,
        layer * 0.025,
        -z,
        curve(z) + offset + width / 2,
        layer * 0.025,
        -z,
      );
      if (i < 220) {
        const v = i * 2;
        indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }, [width, offset, layer]);
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        color={color}
        side={THREE.DoubleSide}
        polygonOffset
        polygonOffsetFactor={-layer}
        polygonOffsetUnits={-layer}
      />
    </mesh>
  );
}
function World({
  speed,
  grade,
  quality,
  onReady,
}: {
  speed: number;
  grade: number;
  quality: string;
  onReady?: () => void;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const moving = speed > 0;
  useEffect(() => {
    if (!moving) return;
    const timer = setInterval(invalidate, quality === 'low' ? 100 : 1000 / 60);
    return () => clearInterval(timer);
  }, [moving, quality, invalidate]);
  const markings = useRef<THREE.Group>(null);
  const roadside = useRef<THREE.Group>(null);
  const terrain = useRef<THREE.Group>(null);
  const travel = useRef(0);
  const smoothGrade = useRef(0);
  const ready = useRef(false);
  const props = useMemo(
    () =>
      Array.from({ length: 110 }, (_, i) => ({
        z: (i * 23.71) % 530,
        side: i % 2 ? 1 : -1,
        x: 8 + ((i * 17) % 75),
        scale: 0.7 + ((i * 11) % 20) / 10,
      })),
    [],
  );
  useFrame((state, delta) => {
    if (!ready.current) {
      ready.current = true;
      setTimeout(() => onReady?.(), 0);
    }
    const dt = Math.min(delta, 0.1);
    travel.current += (speed / 3.6) * dt;
    smoothGrade.current = THREE.MathUtils.damp(smoothGrade.current, grade, 0.3, dt);
    state.camera.position.set(curve(0) + 1.7, 1.65, 3);
    state.camera.lookAt(curve(50) + 1.7, 1.1 + smoothGrade.current * 0.5, -50);
    if (terrain.current) terrain.current.rotation.x = Math.atan(smoothGrade.current / 100);
    markings.current?.children.forEach((m, i) => {
      const z = i * 10 - (travel.current % 10) - 15;
      m.position.set(curve(z), 0.085, -z);
      m.rotation.y = -Math.atan((curve(z + 1) - curve(z - 1)) / 2);
    });
    roadside.current?.children.forEach((m, i) => {
      const p = props[i];
      const z = ((((p.z - travel.current) % 530) + 530) % 530) - 20;
      m.position.set(curve(z) + p.x * p.side, 0, -z);
    });
  });
  return (
    <>
      <color attach="background" args={['#b9d0cb']} />
      <fog attach="fog" args={['#bdcec3', 100, 480]} />
      <hemisphereLight args={['#e9f1e4', '#6f6246', 2.4]} />
      <directionalLight position={[-50, 65, -90]} color="#ffdd9f" intensity={3} />
      {Array.from({ length: 16 }, (_, i) => (
        <mesh
          key={i}
          position={[(i - 7.5) * 88, 15, -350 - (i % 3) * 75]}
          scale={[80 + (i % 3) * 22, 80 + (i % 4) * 20, 75]}
        >
          <icosahedronGeometry args={[1, 1]} />
          <meshStandardMaterial color={i % 2 ? '#87958a' : '#738b82'} flatShading />
        </mesh>
      ))}
      <group ref={terrain}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, -250]}>
          <planeGeometry args={[1800, 1800]} />
          <meshStandardMaterial color="#aaa275" />
        </mesh>
        <Ribbon width={9} color="#cdc5a5" />
        <Ribbon width={7.2} color="#525853" layer={2} />
        <Ribbon width={0.1} offset={3.35} color="#e7e4cb" layer={3} />
        <Ribbon width={0.1} offset={-3.35} color="#e7e4cb" layer={3} />
        <group ref={markings}>
          {Array.from({ length: 65 }, (_, i) => (
            <mesh key={i} rotation={[-Math.PI / 2, 0, 0]}>
              <boxGeometry args={[0.12, 3.6, 0.012]} />
              <meshStandardMaterial color="#e5d9a2" />
            </mesh>
          ))}
        </group>
        <group ref={roadside}>
          {props.slice(0, quality === 'low' ? 55 : 110).map((p, i) => (
            <group key={i} scale={p.scale}>
              {i % 3 === 0 ? (
                <>
                  <mesh position={[0, 1, 0]}>
                    <cylinderGeometry args={[0.15, 0.22, 2, 5]} />
                    <meshStandardMaterial color="#665947" />
                  </mesh>
                  <mesh position={[0, 2.9, 0]} scale={[1.6, 1.5, 1.4]}>
                    <icosahedronGeometry args={[1, 1]} />
                    <meshStandardMaterial color={i % 2 ? '#697d4d' : '#526e4d'} flatShading />
                  </mesh>
                </>
              ) : i % 3 === 1 ? (
                <mesh position={[0, 0.35, 0]} scale={[1.3, 0.55, 0.9]}>
                  <icosahedronGeometry args={[1, 0]} />
                  <meshStandardMaterial color="#a5987a" flatShading />
                </mesh>
              ) : (
                <group>
                  {Array.from({ length: 6 }, (_, j) => (
                    <mesh
                      key={j}
                      position={[Math.sin(j) * 0.3, 0.45, Math.cos(j) * 0.3]}
                      rotation={[Math.cos(j) * 0.7, j, Math.sin(j) * 0.7]}
                    >
                      <coneGeometry args={[0.17, 1.9, 3]} />
                      <meshStandardMaterial color="#648b75" />
                    </mesh>
                  ))}
                </group>
              )}
            </group>
          ))}
        </group>
      </group>
      <mesh position={[-180, 125, -450]}>
        <sphereGeometry args={[18, 24, 16]} />
        <meshBasicMaterial color="#fff2c3" />
      </mesh>
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
function RoadScene({
  speed = 0,
  grade = 0,
  quality = 'high',
  onReady,
}: {
  speed?: number;
  grade?: number;
  quality?: string;
  onReady?: () => void;
}) {
  return (
    <SceneBoundary onReady={onReady}>
      <Canvas
        frameloop="demand"
        dpr={quality === 'low' ? 0.8 : [1, 1.5]}
        camera={{ fov: 64, near: 0.5, far: 1000 }}
        gl={{ antialias: quality !== 'low', powerPreference: 'high-performance' }}
      >
        <World speed={speed} grade={grade} quality={quality} onReady={onReady} />
      </Canvas>
    </SceneBoundary>
  );
}
export default memo(RoadScene);
