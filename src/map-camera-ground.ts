import { Vector3, type Camera } from 'three';

// Eye-level clearance also keeps the normal map near plane above its surface.
export const MAP_CAMERA_GROUND_HEIGHT = 1.6;

export function aboveGroundMovement(position: Vector3, movement: Vector3, groundHeight = 0) {
  movement.y = Math.max(movement.y, groundHeight + MAP_CAMERA_GROUND_HEIGHT - position.y);
  return movement;
}

export function keepMapCameraAboveGround(camera: Camera, target: Vector3, photoViewOrTransition = false, groundHeight = 0) {
  const minimum = groundHeight + MAP_CAMERA_GROUND_HEIGHT;
  if (photoViewOrTransition || camera.position.y >= minimum) return false;
  const lift = minimum - camera.position.y;
  camera.position.y = minimum;
  target.y += lift;
  camera.updateMatrixWorld();
  return true;
}

// Move the map's reference surface without changing its gaze, lens or position
// along the campus. Fixed photo perspectives never participate in this move.
export function shiftMapCameraGround(camera: Camera, target: Vector3, previousGround: number, nextGround: number, photoViewOrTransition = false) {
  const shift = nextGround - previousGround;
  if (photoViewOrTransition || !Number.isFinite(shift) || !shift) return false;
  camera.position.y += shift;
  target.y += shift;
  camera.updateMatrixWorld();
  return true;
}
