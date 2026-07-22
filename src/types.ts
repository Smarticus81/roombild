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

export interface FaceAssignment {
  photoIndex: number;
  face: FaceKey | 'unknown';
}

export interface AnalysisResult {
  assignments: FaceAssignment[];
  roomDescription: string;
  reasoning: string;
}

export type Phase = 'upload' | 'reasoning' | 'view';

export interface BuildProgress {
  stage: 'analyzing' | 'generating';
  /** 1-based index of the face being generated (0 while analyzing). */
  current: number;
  total: number;
  face: FaceKey | null;
}
