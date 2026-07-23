import { useEffect, useMemo, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

interface WalkthroughViewerProps {
  /** Equirectangular 360° panorama as a data URL. */
  pano: string | null;
}

/** Applies max anisotropic filtering — critical for sharpness on a sphere,
 *  where most of the texture is viewed at grazing angles. */
function PanoTexture({ pano, onTexture }: { pano: string; onTexture: (t: THREE.Texture | null) => void }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const tex = new THREE.TextureLoader().load(pano, () => {
      tex.anisotropy = gl.capabilities.getMaxAnisotropy();
      tex.needsUpdate = true;
    });
    tex.colorSpace = THREE.SRGBColorSpace;
    onTexture(tex);
    return () => {
      tex.dispose();
      onTexture(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pano, gl]);
  return null;
}

export function WalkthroughViewer({ pano }: WalkthroughViewerProps) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  // Mirror on X at the GEOMETRY level so the sphere renders from inside with
  // unmirrored imagery. (An object-level scale of -1 doesn't work: the
  // renderer detects the negative determinant and flips winding compensation,
  // which culls every face when the camera is inside.)
  const geometry = useMemo(() => {
    const g = new THREE.SphereGeometry(50, 64, 40);
    g.scale(-1, 1, 1);
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <div className="absolute inset-0 bg-black rounded-xl overflow-hidden shadow-2xl border border-gray-800">
      <Canvas camera={{ position: [0, 0, 0.1], fov: 75 }} gl={{ preserveDrawingBuffer: true }}>
        {pano && <PanoTexture pano={pano} onTexture={setTexture} />}
        {texture && (
          <mesh geometry={geometry}>
            <meshBasicMaterial map={texture} side={THREE.FrontSide} toneMapped={false} />
          </mesh>
        )}
        <OrbitControls
          enableZoom={false}
          enablePan={false}
          makeDefault
          rotateSpeed={-0.5} // Invert rotation since we are inside
        />
      </Canvas>
      <div className="absolute bottom-4 left-4 text-white/50 text-xs font-mono pointer-events-none">
        Drag to look around
      </div>
    </div>
  );
}
