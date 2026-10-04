declare module '*photo-package.mjs' {
  import type { Photo, Campus } from './types';
  export const SUBMISSION_EMAIL: string;
  export const MAX_PHOTO_BYTES: number;
  export const MAX_PACKAGE_BYTES: number;
  export type PhotoPackage = { bytes: Uint8Array<ArrayBuffer>; filename: string; manifest: {
    schemaVersion: number; kind: string; id: string; createdAt: string;
    original: { path: string; filename: string; size: number; type: string; sha256: string };
    annotation: Partial<Photo>;
  } };
  export function createPhotoPackage(file: File, photo: Photo, campus?: Campus): Promise<PhotoPackage>;
  export function submissionMailto(manifest: PhotoPackage['manifest'], filename: string): string;
}
