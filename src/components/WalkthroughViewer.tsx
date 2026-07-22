import { useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { RoomFaces, RoomDimensions } from '../types';

interface WalkthroughViewerProps {
  faces: RoomFaces;
  /** Relative room proportions from the analysis step; defaults to a cube. */
  dimensions?: RoomDimensions;
}

const clampDim = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(3, Math.max(0.5, v)) : 1;

function makeTexture(loader: THREE.TextureLoader, dataUrl: string | null, color: string): THREE.Texture {
  let texture: THREE.Texture;
  if (!dataUrl) {
    // Blank colored texture for a missing face
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 512, 512);
    }
    texture = new THREE.CanvasTexture(canvas);
  } else {
    texture = loader.load(dataUrl);
  }
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function WalkthroughViewer({ faces, dimensions }: WalkthroughViewerProps) {
  const [textures, setTextures] = useState<THREE.Texture[] | null>(null);

  // Mirror on X at the GEOMETRY level so the box renders from inside with
  // unmirrored textures. (An object-level scale of -1 doesn't work: the
  // renderer detects the negative determinant and flips winding compensation,
  // which culls every face when the camera is inside the box.)
  // The box is proportioned from the analyzed room dimensions — an elongated
  // room renders as an elongated box, not a cube.
  const geometry = useMemo(() => {
    const w = clampDim(dimensions?.width);
    const d = clampDim(dimensions?.depth);
    const h = clampDim(dimensions?.height);
    const scale = 10 / Math.max(w, d, h);
    const g = new THREE.BoxGeometry(w * scale, h * scale, d * scale);
    g.scale(-1, 1, 1);
    return g;
  }, [dimensions]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useEffect(() => {
    const loader = new THREE.TextureLoader();

    // Three.js BoxGeometry material order: px, nx, py, ny, pz, nz.
    // The geometry is mirrored on X — hence left/right are swapped here.
    const next = [
      makeTexture(loader, faces.left, '#ccffcc'),   // px -> appears left
      makeTexture(loader, faces.right, '#ffcccc'),  // nx -> appears right
      makeTexture(loader, faces.top, '#ccccff'),    // py (ceiling)
      makeTexture(loader, faces.bottom, '#ffffcc'), // ny (floor)
      makeTexture(loader, faces.back, '#ccffff'),   // pz (back)
      makeTexture(loader, faces.front, '#ffccff'),  // nz (front)
    ];
    setTextures(next);

    return () => next.forEach((t) => t.dispose());
  }, [faces]);

  return (
    <div className="absolute inset-0 bg-black rounded-xl overflow-hidden shadow-2xl border border-gray-800">
      <Canvas camera={{ position: [0, 0, 0.1], fov: 75 }} gl={{ preserveDrawingBuffer: true }}>
        <ambientLight intensity={1} />
        {textures && (
          <mesh geometry={geometry}>
            {textures.map((tex, i) => (
              <meshBasicMaterial
                key={i}
                attach={`material-${i}`}
                map={tex}
                side={THREE.FrontSide}
                toneMapped={false}
              />
            ))}
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
