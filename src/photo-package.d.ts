declare module '*photo-package.mjs' {
  import type { Photo, Campus } from './types';
  export const SUBMISSION_EMAIL: string;
  export const MAX_DEPTH_BYTES: number;
  export const MAX_PHOTO_BYTES: number;
  export const MAX_PACKAGE_PHOTOS: number;
  export const MAX_PACKAGE_ORIGINAL_BYTES: number;
  export const MAX_PACKAGE_BYTES: number;
  export type PackagePhoto = {
    id: string;
    original: { path: string; filename: string; size: number; type: string; sha256: string };
    depth?: { path: string; filename: string; size: number; type: string; sha256: string };
    annotation: Partial<Photo>;
  };
  export type PhotoPackage = { bytes: Uint8Array<ArrayBuffer>; filename: string; manifest:
    ({ schemaVersion: 1; kind: string; createdAt: string } & PackagePhoto) |
    { schemaVersion: 2; kind: string; id: string; createdAt: string; photos: PackagePhoto[] }
  };
  export function createPhotoPackage(file: File, photo: Photo, campus?: Campus, depthFile?: File): Promise<PhotoPackage>;
  export function createPhotoBatchPackage(entries: { file: File; photo: Photo; depthFile?: File }[], campus?: Campus): Promise<PhotoPackage>;
  export function submissionMailto(manifest: PhotoPackage['manifest'], filename: string): string;
}
