import React, { useState } from 'react';
import { UploadedPhoto } from '../types';
import { Upload, X, Sparkles, Camera } from 'lucide-react';

const MAX_PHOTOS = 6;
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB
const MAX_DIMENSION = 1536;

/**
 * Reads an image file, downscales it to a sane size and returns a JPEG data URL.
 * Keeps upload payloads small and gives the model consistent input.
 */
function readAndResizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not process the image.'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that file as an image.'));
    };
    img.src = url;
  });
}

interface PhotoUploaderProps {
  photos: UploadedPhoto[];
  setPhotos: React.Dispatch<React.SetStateAction<UploadedPhoto[]>>;
  onBuild: () => void;
}

export function PhotoUploader({ photos, setPhotos, onBuild }: PhotoUploaderProps) {
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const addFiles = async (files: FileList | File[]) => {
    setUploadError(null);
    const incoming = Array.from(files);
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      setUploadError(`You can upload at most ${MAX_PHOTOS} photos.`);
      return;
    }
    for (const file of incoming.slice(0, room)) {
      if (!file.type.startsWith('image/')) {
        setUploadError('Please choose image files (JPEG, PNG, WebP...).');
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        setUploadError('Images must be under 20MB.');
        continue;
      }
      try {
        const dataUrl = await readAndResizeImage(file);
        setPhotos((prev) =>
          prev.length >= MAX_PHOTOS
            ? prev
            : [...prev, { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, dataUrl }],
        );
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : 'Could not read that image.');
      }
    }
    if (incoming.length > room) {
      setUploadError(`Only the first ${room} photo${room > 1 ? 's were' : ' was'} added — max ${MAX_PHOTOS} total.`);
    }
  };

  const removePhoto = (id: string) => {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <div className="w-full max-w-2xl flex flex-col items-center space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-medium text-white tracking-tight">Photograph your room</h2>
        <p className="text-gray-400 text-sm max-w-md mx-auto">
          Upload up to {MAX_PHOTOS} photos of your room — walls, floor, ceiling, any angle. The AI
          works out the layout and fills in whatever you didn't capture.
        </p>
      </div>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
        }}
        className={`w-full cursor-pointer border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center text-gray-400 transition-colors ${
          dragOver ? 'border-blue-500 bg-blue-500/5 text-blue-400' : 'border-gray-700 hover:border-blue-500 hover:text-blue-400 bg-gray-900/50'
        }`}
      >
        <Upload size={28} className="mb-3" />
        <span className="text-sm font-medium">Drop photos here or click to browse</span>
        <span className="text-xs font-mono mt-1 text-gray-500">
          {photos.length}/{MAX_PHOTOS} added
        </span>
        <input
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          aria-label="Upload room photos"
          onChange={(e) => {
            if (e.target.files?.length) void addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </label>

      {photos.length > 0 && (
        <div className="grid grid-cols-6 gap-3 w-full">
          {photos.map((photo, i) => (
            <div key={photo.id} className="relative group aspect-square rounded-lg overflow-hidden border border-gray-700 bg-gray-900">
              <img src={photo.dataUrl} alt={`Room photo ${i + 1}`} className="w-full h-full object-cover" />
              <button
                onClick={() => removePhoto(photo.id)}
                aria-label={`Remove photo ${i + 1}`}
                className="absolute top-1 right-1 p-1 bg-black/70 rounded-full hover:bg-red-500 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {uploadError && (
        <p role="alert" className="text-red-400 text-sm font-mono">{uploadError}</p>
      )}

      <div className="h-16 flex flex-col items-center justify-center">
        <button
          onClick={onBuild}
          disabled={photos.length === 0}
          className="flex items-center px-8 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium rounded-full shadow-lg shadow-blue-500/20 transition-all font-mono text-sm tracking-tight"
        >
          <Sparkles size={16} className="mr-2" />
          BUILD 3D WALKTHROUGH
        </button>
        {photos.length === 0 && (
          <p className="text-gray-500 text-xs font-mono mt-2 flex items-center">
            <Camera size={12} className="mr-1.5" />
            Add at least one photo to start
          </p>
        )}
      </div>
    </div>
  );
}
