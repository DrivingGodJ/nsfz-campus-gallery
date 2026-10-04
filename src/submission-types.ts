import type { Photo } from './types';
export type Submission = { id:string; filename:string; size:number; annotation:Photo; created_at:number; upload_expires:number; ready:boolean; localPhotoId:string; needsSync:boolean };
export type ReviewConfiguration = {mode:'local'|'cloud';url:string;configured:boolean};
