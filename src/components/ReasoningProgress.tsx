import { UploadedPhoto, BuildProgress } from '../types';
import { BrainCircuit, Loader2 } from 'lucide-react';
import { FunProgressBar } from './FunProgressBar';

interface ReasoningProgressProps {
  progress: BuildProgress;
  photos: UploadedPhoto[];
  reasoning: string | null;
}

export function ReasoningProgress({ progress, photos, reasoning }: ReasoningProgressProps) {
  const analyzing = progress.stage === 'analyzing';
  const headline =
    progress.stage === 'analyzing'
      ? 'Analyzing your photos…'
      : progress.stage === 'generating'
        ? 'Painting your 360° room…'
        : progress.stage === 'reviewing'
          ? 'Reviewing the wrap-around…'
          : 'Reconciling the seam…';
  const subline =
    progress.stage === 'analyzing'
      ? 'The AI is studying your photos to understand the room’s layout, materials and lighting.'
      : progress.stage === 'generating'
        ? 'One seamless 360° panorama is being generated from your photos — this takes about a minute.'
        : progress.stage === 'reviewing'
          ? 'The AI is checking that the room stays continuous where the 360° view reconnects.'
          : 'A discontinuity was found where the panorama wraps — the AI is repairing it and will re-check.';

  return (
    <div className="w-full max-w-2xl flex flex-col items-center space-y-8">
      <div className="flex flex-col items-center space-y-3 text-center">
        <div className="w-12 h-12 rounded-2xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center">
          {analyzing ? (
            <BrainCircuit size={24} className="text-blue-400 animate-pulse" />
          ) : (
            <Loader2 size={24} className="text-blue-400 animate-spin" />
          )}
        </div>
        <h2 className="text-xl font-medium text-white tracking-tight">{headline}</h2>
        <p className="text-gray-400 text-sm max-w-md">{subline}</p>
      </div>

      <FunProgressBar progress={progress} />

      <div className="flex gap-2 justify-center flex-wrap">
        {photos.map((photo) => (
          <img
            key={photo.id}
            src={photo.dataUrl}
            alt="Room reference"
            className={`w-16 h-16 object-cover rounded-lg border ${
              analyzing ? 'border-blue-500/40 animate-pulse' : 'border-gray-800 opacity-70'
            }`}
          />
        ))}
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
