import { isAerialPhoto } from './locations.ts';
import type { Photo } from './types';

const ground = { point: '#46634e', direction: '#3e6951', border: '#faf9f4', selected: '#42634c', stem: '#989b83' };
const aerial = { point: '#367cac', direction: '#367cac', border: '#367cac', selected: '#245b85', stem: '#7ba6bd' };

// Use the same capture-type detection for old EXIF imports and new annotations.
export const photoMarkerColors = (photo: Photo) => isAerialPhoto(photo) ? aerial : ground;
