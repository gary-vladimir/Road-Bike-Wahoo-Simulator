import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
export type TreePlacement = { position: THREE.Vector3; size: number; rotation: number };
/** Photographic vegetation cards keep fine foliage at a small geometry cost. */
export default function Vegetation({
  texture,
  trees,
}: {
  texture: THREE.Texture;
  trees: TreePlacement[];
}) {
  const invalidate = useThree((s) => s.invalidate);
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), []);
  const material = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({
      map: texture,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    return m;
  }, [texture]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useEffect(() => {
    const object = new THREE.Object3D();
    trees.forEach((tree, i) => {
      object.position.copy(tree.position);
      object.scale.set((tree.size * texture.image.width) / texture.image.height, tree.size, 1);
      object.rotation.set(0, tree.rotation, 0);
      object.updateMatrix();
      ref.current!.setMatrixAt(i, object.matrix);
    });
    ref.current!.instanceMatrix.needsUpdate = true;
    ref.current!.computeBoundingSphere();
    invalidate();
  }, [trees, invalidate]);
  return <instancedMesh ref={ref} args={[geometry, material, trees.length]} />;
}
