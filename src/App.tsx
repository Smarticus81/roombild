import { useRef, useState } from 'react';
import { PhotoUploader } from './components/PhotoUploader';
import { ReasoningProgress } from './components/ReasoningProgress';
import { WalkthroughViewer } from './components/WalkthroughViewer';
import { RoomFaces, FaceKey, UploadedPhoto, AnalysisResult, Phase, BuildProgress } from './types';
import { Cuboid, RotateCcw, X } from 'lucide-react';

const FACE_KEYS: FaceKey[] = ['front', 'back', 'left', 'right', 'top', 'bottom'];

const EMPTY_FACES: RoomFaces = {
  front: null,
  back: null,
  left: null,
  right: null,
  top: null,
  bottom: null,
};

async function dataURLtoBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

async function postForm<T>(url: string, form: FormData): Promise<T> {
  const res = await fetch(url, { method: 'POST', body: form });
  let data: (T & { success?: boolean; error?: string }) | null = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON response (e.g. proxy error page)
  }
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || `Request failed (HTTP ${res.status}).`);
  }
  return data;
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('upload');
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [faces, setFaces] = useState<RoomFaces>(EMPTY_FACES);
  const [progress, setProgress] = useState<BuildProgress | null>(null);
  const [reasoning, setReasoning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Guards against state updates from a build that was reset mid-flight.
  const buildToken = useRef(0);

  const resetToUpload = () => {
    buildToken.current += 1;
    setPhase('upload');
    setFaces(EMPTY_FACES);
    setProgress(null);
    setReasoning(null);
    setError(null);
  };

  const handleBuild = async () => {
    if (photos.length === 0) return;
    const token = ++buildToken.current;
    const live = () => buildToken.current === token;

    setError(null);
    setReasoning(null);
    setFaces(EMPTY_FACES);
    setPhase('reasoning');
    setProgress({ stage: 'analyzing', current: 0, total: 0, face: null });

    try {
      // Step 2a — LLM reasoning: which photo is which surface, and what does
      // the room look like as a whole?
      const analyzeForm = new FormData();
      for (const [i, photo] of photos.entries()) {
        analyzeForm.append('photos', await dataURLtoBlob(photo.dataUrl), `photo${i}.jpg`);
      }
      const analysis = await postForm<AnalysisResult>('/api/analyze', analyzeForm);
      if (!live()) return;
      setReasoning(analysis.reasoning || null);

      const assigned: RoomFaces = { ...EMPTY_FACES };
      for (const a of analysis.assignments ?? []) {
        const photo = photos[a.photoIndex];
        if (photo && a.face !== 'unknown' && FACE_KEYS.includes(a.face) && !assigned[a.face]) {
          assigned[a.face] = photo.dataUrl;
        }
      }
      if (FACE_KEYS.every((k) => !assigned[k])) {
        throw new Error(
          'The AI could not match any photo to a room surface. Try clearer, straight-on photos of the walls, floor or ceiling.',
        );
      }
      setFaces(assigned);

      // Step 2b — generate each missing face, feeding previously generated
      // faces back in as references so the room stays coherent.
      const missing = FACE_KEYS.filter((k) => !assigned[k]);
      const current: RoomFaces = { ...assigned };
      const failures: string[] = [];
      let lastFailureMessage: string | null = null;

      for (const [i, face] of missing.entries()) {
        if (!live()) return;
        setProgress({ stage: 'generating', current: i + 1, total: missing.length, face });
        try {
          const genForm = new FormData();
          for (const key of FACE_KEYS) {
            const dataUrl = current[key];
            if (dataUrl) {
              genForm.append(key, await dataURLtoBlob(dataUrl), `${key}.jpg`);
            }
          }
          genForm.append('face', face);
          genForm.append('roomDescription', analysis.roomDescription ?? '');
          const result = await postForm<{ face: FaceKey; image: string }>('/api/generate-face', genForm);
          if (!live()) return;
          current[face] = result.image;
          setFaces({ ...current });
        } catch (err) {
          failures.push(face);
          lastFailureMessage = err instanceof Error ? err.message : String(err);
        }
      }

      if (!live()) return;
      if (failures.length > 0) {
        setError(
          `Could not generate ${failures.length} surface${failures.length > 1 ? 's' : ''} (${failures.join(', ')}): ${lastFailureMessage}`,
        );
      }
      setPhase('view');
    } catch (err) {
      if (!live()) return;
      console.error(err);
      setError(err instanceof Error ? err.message : 'Something went wrong while building the room.');
      setPhase('upload');
    } finally {
      if (live()) setProgress(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col font-sans">
      <header className="h-16 border-b border-gray-800 flex items-center justify-between px-6 shrink-0 bg-gray-900/50 backdrop-blur-sm z-10 relative">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <Cuboid size={20} className="text-white" />
          </div>
          <h1 className="text-lg font-medium tracking-tight text-white">SpaceBuilder 3D</h1>
        </div>
        {phase !== 'upload' && (
          <button
            onClick={resetToUpload}
            className="flex items-center px-4 py-1.5 rounded-full text-sm font-medium text-gray-400 hover:text-gray-200 bg-gray-900 border border-gray-800 transition-colors"
          >
            <RotateCcw size={14} className="mr-2" />
            Start over
          </button>
        )}
      </header>

      <main className="flex-1 relative overflow-hidden flex flex-col items-center justify-center p-6">
        {error && (
          <div role="alert" className="absolute top-4 left-1/2 -translate-x-1/2 max-w-xl bg-red-500/10 border border-red-500/50 text-red-400 px-4 py-2 rounded-lg text-sm z-50 flex items-center gap-3">
            <span>{error}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss error" className="hover:text-red-200 shrink-0">
              <X size={14} />
            </button>
          </div>
        )}

        {phase === 'upload' && (
          <PhotoUploader photos={photos} setPhotos={setPhotos} onBuild={handleBuild} />
        )}

        {phase === 'reasoning' && progress && (
          <ReasoningProgress progress={progress} faces={faces} reasoning={reasoning} />
        )}

        {phase === 'view' && (
          <div className="w-full max-w-6xl mx-auto flex-1 min-h-0 self-center flex flex-col gap-3">
            <div className="flex-1 min-h-0 relative">
              <WalkthroughViewer faces={faces} />
            </div>
            {reasoning && (
              <p className="text-gray-500 text-xs font-mono shrink-0 max-w-3xl mx-auto text-center">
                {reasoning}
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
