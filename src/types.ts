export type FaceKey = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

export interface RoomFaces {
  front: string | null;
  back: string | null;
  left: string | null;
  right: string | null;
  top: string | null;
  bottom: string | null;
}

export interface UploadedPhoto {
  id: string;
  dataUrl: string;
}

export type PhotoRole = 'wall' | 'overview' | 'closeup' | 'unknown';

export interface PhotoClassification {
  photoIndex: number;
  /** Only "wall" photos may be textured onto a face; the rest are references. */
  role: PhotoRole;
  face: FaceKey | 'none';
}

export interface RoomDimensions {
  /** Relative proportions (each roughly 1–3): width = front/back wall length,
   *  depth = left/right wall length. */
  width: number;
  depth: number;
  height: number;
}

export interface AnalysisResult {
  photos: PhotoClassification[];
  dimensions: RoomDimensions;
  roomDescription: string;
  reasoning: string;
}

export type Phase = 'upload' | 'reasoning' | 'view';

export interface BuildProgress {
  stage: 'analyzing' | 'generating' | 'reviewing' | 'fixing';
  /** 1-based attempt/step counter for the current stage (0 while analyzing). */
  current: number;
  total: number;
  face: FaceKey | null;
}
