import { Vector3, type Camera } from 'three';

// Eye-level clearance also keeps the normal map near plane above its surface.
export const MAP_CAMERA_GROUND_HEIGHT = 1.6;

export function aboveGroundMovement(position: Vector3, movement: Vector3) {
  movement.y = Math.max(movement.y, MAP_CAMERA_GROUND_HEIGHT - position.y);
  return movement;
}

export function keepMapCameraAboveGround(camera: Camera, target: Vector3, photoViewOrTransition = false) {
  if (photoViewOrTransition || camera.position.y >= MAP_CAMERA_GROUND_HEIGHT) return false;
  const lift = MAP_CAMERA_GROUND_HEIGHT - camera.position.y;
  camera.position.y = MAP_CAMERA_GROUND_HEIGHT;
  target.y += lift;
  camera.updateMatrixWorld();
  return true;
}
