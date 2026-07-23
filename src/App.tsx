import { useRef, useState } from 'react';
import { PhotoUploader } from './components/PhotoUploader';
import { ReasoningProgress } from './components/ReasoningProgress';
import { WalkthroughViewer } from './components/WalkthroughViewer';
import { UploadedPhoto, AnalysisResult, Phase, BuildProgress } from './types';
import { Cuboid, RotateCcw, X } from 'lucide-react';

async function dataURLtoBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

/**
 * Rolls an equirectangular panorama horizontally by half its width, moving
 * the wrap junction (left/right edge) to the image center. Rolling twice
 * returns the original arrangement, so the same helper both exposes the seam
 * for review/repair and restores orientation afterwards.
 */
async function rollHalf(dataUrl: string): Promise<string> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Could not load the panorama for seam processing.'));
    img.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process the panorama.');
  const half = Math.floor(img.width / 2);
  ctx.drawImage(img, half, 0, img.width - half, img.height, 0, 0, img.width - half, img.height);
  ctx.drawImage(img, 0, 0, half, img.height, img.width - half, 0, half, img.height);
  return canvas.toDataURL('image/jpeg', 0.92);
}

const MAX_SEAM_FIXES = 2;

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
  const [pano, setPano] = useState<string | null>(null);
  const [progress, setProgress] = useState<BuildProgress | null>(null);
  const [reasoning, setReasoning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Guards against state updates from a build that was reset mid-flight.
  const buildToken = useRef(0);

  const resetToUpload = () => {
    buildToken.current += 1;
    setPhase('upload');
    setPano(null);
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
    setPano(null);
    setPhase('reasoning');
    setProgress({ stage: 'analyzing', current: 0, total: 0, face: null });

    try {
      // Step 2a — LLM reasoning over the photos: layout, proportions, and a
      // dense per-surface description of the room.
      const analyzeForm = new FormData();
      for (const [i, photo] of photos.entries()) {
        analyzeForm.append('photos', await dataURLtoBlob(photo.dataUrl), `photo${i}.jpg`);
      }
      const analysis = await postForm<AnalysisResult>('/api/analyze', analyzeForm);
      if (!live()) return;
      setReasoning(analysis.reasoning || null);

      const description =
        (analysis.roomDescription ?? '') +
        (analysis.dimensions
          ? ` Room proportions — width ${analysis.dimensions.width}, depth ${analysis.dimensions.depth}, height ${analysis.dimensions.height}.`
          : '');

      // Step 2b — ONE seamless 360° equirectangular panorama generated from
      // every photo at once. A single globally-consistent image avoids the
      // seams, duplicated furniture and misplaced surfaces that per-face
      // generation produced.
      setProgress({ stage: 'generating', current: 1, total: 1, face: null });
      const genForm = new FormData();
      for (const [i, photo] of photos.entries()) {
        genForm.append('photos', await dataURLtoBlob(photo.dataUrl), `photo${i}.jpg`);
      }
      genForm.append('roomDescription', description);
      const result = await postForm<{ image: string }>('/api/generate-pano', genForm);
      if (!live()) return;

      // Step 2c — review-and-fix loop: roll the panorama so the wrap seam
      // sits at the image center, have the reasoning model judge continuity,
      // and let the image model repair the visible seam until it reconciles.
      let currentPano = result.image;
      for (let attempt = 1; attempt <= MAX_SEAM_FIXES + 1; attempt++) {
        if (!live()) return;
        setProgress({ stage: 'reviewing', current: attempt, total: MAX_SEAM_FIXES + 1, face: null });
        try {
          const rolled = await rollHalf(currentPano);
          const reviewForm = new FormData();
          reviewForm.append('image', await dataURLtoBlob(rolled), 'rolled.jpg');
          const verdict = await postForm<{ seamless: boolean; problems: string }>(
            '/api/review-seam',
            reviewForm,
          );
          if (!live()) return;
          if (verdict.seamless || attempt > MAX_SEAM_FIXES) break;

          setProgress({ stage: 'fixing', current: attempt, total: MAX_SEAM_FIXES, face: null });
          const fixForm = new FormData();
          fixForm.append('image', await dataURLtoBlob(rolled), 'rolled.jpg');
          fixForm.append('problems', verdict.problems ?? '');
          fixForm.append('roomDescription', description);
          const fixed = await postForm<{ image: string }>('/api/fix-seam', fixForm);
          if (!live()) return;
          // The repaired image is still center-rolled — roll back to restore
          // the original orientation.
          currentPano = await rollHalf(fixed.image);
        } catch (err) {
          // Seam polish is best-effort: keep the current panorama on failure.
          console.warn('Seam review/fix skipped:', err);
          break;
        }
      }

      if (!live()) return;
      setPano(currentPano);
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
          <ReasoningProgress progress={progress} photos={photos} reasoning={reasoning} />
        )}

        {phase === 'view' && (
          <div className="w-full max-w-6xl mx-auto flex-1 min-h-0 self-center flex flex-col gap-3">
            <div className="flex-1 min-h-0 relative">
              <WalkthroughViewer pano={pano} />
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
