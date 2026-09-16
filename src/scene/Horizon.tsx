import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { panoramaGeometry } from './scenery';

export default function Horizon({ texture }: { texture: THREE.Texture }) {
  const ref = useRef<THREE.Mesh>(null);
  const geometry = useMemo(panoramaGeometry, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  // Follow translation only: distant mountains rotate with the view, not with the camera.
  useFrame(({ camera }) => ref.current?.position.copy(camera.position));
  return (
    <mesh ref={ref} geometry={geometry} renderOrder={-1000} frustumCulled={false}>
      <meshBasicMaterial
        map={texture}
        fog={false}
        toneMapped={false}
        depthWrite={false}
        depthTest={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
