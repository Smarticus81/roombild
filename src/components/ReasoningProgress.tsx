import { RoomFaces, FaceKey, BuildProgress } from '../types';
import { BrainCircuit, Loader2, Check } from 'lucide-react';
import { FunProgressBar } from './FunProgressBar';

const FACE_ORDER: { key: FaceKey; label: string }[] = [
  { key: 'top', label: 'CEILING' },
  { key: 'left', label: 'LEFT' },
  { key: 'front', label: 'FRONT' },
  { key: 'right', label: 'RIGHT' },
  { key: 'back', label: 'BACK' },
  { key: 'bottom', label: 'FLOOR' },
];

interface ReasoningProgressProps {
  progress: BuildProgress;
  faces: RoomFaces;
  reasoning: string | null;
}

export function ReasoningProgress({ progress, faces, reasoning }: ReasoningProgressProps) {
  const headline =
    progress.stage === 'analyzing'
      ? 'Analyzing your photos…'
      : `Generating the ${FACE_ORDER.find((f) => f.key === progress.face)?.label.toLowerCase() ?? progress.face} (${progress.current}/${progress.total})…`;

  const subline =
    progress.stage === 'analyzing'
      ? 'The AI is identifying which surface each photo shows and reconstructing the room layout.'
      : 'Missing surfaces are being imagined to match the lighting and style of your photos.';

  return (
    <div className="w-full max-w-2xl flex flex-col items-center space-y-8">
      <div className="flex flex-col items-center space-y-3 text-center">
        <div className="w-12 h-12 rounded-2xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center">
          {progress.stage === 'analyzing' ? (
            <BrainCircuit size={24} className="text-blue-400 animate-pulse" />
          ) : (
            <Loader2 size={24} className="text-blue-400 animate-spin" />
          )}
        </div>
        <h2 className="text-xl font-medium text-white tracking-tight">{headline}</h2>
        <p className="text-gray-400 text-sm max-w-md">{subline}</p>
      </div>

      <FunProgressBar progress={progress} />

      <div className="grid grid-cols-6 gap-3 w-full">
        {FACE_ORDER.map(({ key, label }) => {
          const ready = Boolean(faces[key]);
          const active = progress.stage === 'generating' && progress.face === key;
          return (
            <div
              key={key}
              className={`relative aspect-square rounded-lg overflow-hidden border flex items-center justify-center transition-colors ${
                active
                  ? 'border-blue-500 bg-blue-500/10 animate-pulse'
                  : ready
                    ? 'border-green-500/50 bg-gray-900'
                    : 'border-gray-800 bg-gray-900/50'
              }`}
            >
              {faces[key] ? (
                <>
                  <img src={faces[key] as string} alt={label} className="w-full h-full object-cover" />
                  <div className="absolute top-1 right-1 bg-green-500 rounded-full p-0.5">
                    <Check size={10} className="text-black" />
                  </div>
                </>
              ) : active ? (
                <Loader2 size={16} className="text-blue-400 animate-spin" />
              ) : (
                <span className="text-[10px] font-mono text-gray-600">{label}</span>
              )}
              <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[9px] font-mono text-gray-300 text-center py-0.5">
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {reasoning && (
        <div className="w-full bg-gray-900/70 border border-gray-800 rounded-xl p-4">
          <p className="text-[10px] font-mono text-blue-400 uppercase tracking-widest mb-2">
            What the AI sees
          </p>
          <p className="text-sm text-gray-300 leading-relaxed">{reasoning}</p>
        </div>
      )}
    </div>
  );
}
