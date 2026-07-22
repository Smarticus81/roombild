import { useEffect, useState } from 'react';
import { BuildProgress, FaceKey } from '../types';
import { Paintbrush } from 'lucide-react';

const ANALYZE_MESSAGES = [
  'Squinting thoughtfully at your photos…',
  'Counting walls (hoping for four)…',
  'Asking the ceiling to identify itself…',
  'Measuring the room with imaginary tape…',
  'Consulting the interior-design cortex…',
  'Politely interrogating the furniture…',
];

const FACE_FLAVOR: Record<FaceKey, string[]> = {
  front: ['Rolling paint onto the front wall…', 'Hanging an imaginary doorway…'],
  back: ['Imagining what’s behind you…', 'Backfilling the back wall…'],
  left: ['Convincing pixels to be the left wall…', 'Leaning into the left wall…'],
  right: ['Plastering the right wall…', 'Getting the right wall just right…'],
  top: ['Painting the ceiling — neck hurts…', 'Installing imaginary light fixtures…'],
  bottom: ['Sweeping sawdust off the new floor…', 'Laying floorboards pixel by pixel…'],
};

const GENERATE_GENERIC = [
  'Wrapping the room around you…',
  'Painting all four walls at once…',
  'Bending light around the corners…',
  'Stitching a seamless 360° view…',
  'Matching the lighting so nobody notices…',
  'Double-checking the vibes…',
];

/** Milestone math: analysis owns 0–22%, generation splits the remaining 78%. */
function bounds(progress: BuildProgress): { floor: number; cap: number } {
  if (progress.stage === 'analyzing' || progress.total === 0) {
    return { floor: 0, cap: 22 };
  }
  const per = 78 / progress.total;
  return {
    floor: 22 + per * (progress.current - 1),
    cap: Math.min(98, 22 + per * progress.current - 1),
  };
}

interface FunProgressBarProps {
  progress: BuildProgress;
}

export function FunProgressBar({ progress }: FunProgressBarProps) {
  const [pct, setPct] = useState(0);
  const [msgIndex, setMsgIndex] = useState(0);

  // Creep toward the current milestone cap; jump quickly when a milestone
  // completes and the floor moves past us.
  useEffect(() => {
    const tick = setInterval(() => {
      setPct((p) => {
        const { floor, cap } = bounds(progress);
        if (p < floor) return Math.min(floor, p + (floor - p) * 0.35 + 0.6);
        return Math.min(cap, p + Math.max(0.06, (cap - p) * 0.025));
      });
    }, 90);
    return () => clearInterval(tick);
  }, [progress]);

  useEffect(() => {
    const rotate = setInterval(() => setMsgIndex((i) => i + 1), 2600);
    return () => clearInterval(rotate);
  }, []);

  const pool =
    progress.stage === 'analyzing'
      ? ANALYZE_MESSAGES
      : [...(progress.face ? FACE_FLAVOR[progress.face] : []), ...GENERATE_GENERIC];
  const message = pool[msgIndex % pool.length];

  return (
    <div className="w-full max-w-xl">
      <div className="relative h-6 rounded-full bg-gray-900 border border-gray-800">
        {/* painted trail */}
        <div
          className="absolute inset-y-0 left-0 rounded-full overflow-hidden transition-[width] duration-150 ease-linear"
          style={{ width: `${pct}%` }}
        >
          <div className="h-full w-full bg-gradient-to-r from-blue-600 via-purple-500 to-pink-500" />
          <div className="absolute inset-0 barber-overlay" />
        </div>

        {/* paint roller head */}
        <div
          className="absolute top-1/2 -translate-y-1/2 z-10 transition-[left] duration-150 ease-linear"
          style={{ left: `calc(${pct}% - 16px)` }}
        >
          <div className="roller-wobble w-8 h-8 rounded-full bg-white text-gray-900 flex items-center justify-center shadow-lg shadow-pink-500/40 border-2 border-pink-400">
            <Paintbrush size={15} />
          </div>
          <span className="sparkle absolute -top-2 -right-1 text-[10px] select-none" aria-hidden>
            ✨
          </span>
          <span
            className="sparkle absolute -top-3 left-0 text-[9px] select-none"
            style={{ animationDelay: '0.45s' }}
            aria-hidden
          >
            ✨
          </span>
          <span
            className="sparkle absolute top-4 -right-2 text-[9px] select-none"
            style={{ animationDelay: '0.9s' }}
            aria-hidden
          >
            ✨
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between mt-2 gap-4">
        <span key={message} className="msg-pop text-xs font-mono text-gray-400 truncate">
          {message}
        </span>
        <span className="text-xs font-mono text-blue-300 tabular-nums shrink-0">
          {Math.round(pct)}%
        </span>
      </div>
    </div>
  );
}
