import { Euler, Quaternion, Vector3 } from 'three';
import type { CameraPose } from './photo-camera.ts';
import { MAP_CAMERA_GROUND_HEIGHT } from './map-camera-ground.ts';

// Fractions of the unchanged map canvas that remain beside/above a card.
export type MapViewport = { left: number; top: number; width: number; height: number };
export const FULL_MAP_VIEWPORT: MapViewport = { left: 0, top: 0, width: 1, height: 1 };
export const MAP_PHOTO_FOCUS_DISTANCE = 40;

function viewportRay(fov: number, aspect: number, viewport: MapViewport) {
  const x = 2 * (viewport.left + viewport.width / 2) - 1;
  const y = 1 - 2 * (viewport.top + viewport.height / 2);
  const lens = Math.tan(fov * Math.PI / 360);
  return new Vector3(x * lens * aspect, y * lens, -1).normalize();
}

// Every selection starts with a level 45-degree downward view, matching photos.
// Place the camera behind the exposed centre ray rather than underneath the object.
export function photoMapFocusPose(pose: CameraPose, object: Vector3, aspect: number, viewport: MapViewport, groundHeight = 0): CameraPose {
  const yaw = new Euler().setFromQuaternion(pose.quaternion, 'YXZ').y;
  const quaternion = new Quaternion().setFromEuler(new Euler(-Math.PI / 4, yaw, 0, 'YXZ'));
  const direction = viewportRay(pose.fov, aspect, viewport).applyQuaternion(quaternion);
  // Only a point too far underground to frame at 40 m needs extra clearance.
  const distance = Math.max(MAP_PHOTO_FOCUS_DISTANCE, (groundHeight + MAP_CAMERA_GROUND_HEIGHT - object.y) / -direction.y);
  const position = object.clone().addScaledVector(direction, -distance);
  return { ...pose, position, quaternion, target: position.clone().add(new Vector3(0, 0, -distance).applyQuaternion(quaternion)) };
}

export function viewportProjectionOffset(viewport: MapViewport) {
  return { x: .5 - viewport.left - viewport.width / 2, y: .5 - viewport.top - viewport.height / 2 };
}

// Frame the visible area's centre without changing distance or lens size.
export function frameMapTarget(pose: CameraPose, object: Vector3, aspect: number, viewport: MapViewport): CameraPose {
  const distance = Math.max(.01, pose.position.distanceTo(object));
  const screenRay = viewportRay(pose.fov, aspect, viewport);
  const direction = object.clone().sub(pose.position).normalize();
  const verticalRange = Math.hypot(screenRay.y, screenRay.z);
  const requestedPitch = Math.asin(Math.max(-1, Math.min(1, direction.y / verticalRange))) - Math.atan2(screenRay.y, -screenRay.z);
  const pitchLimit = Math.PI / 2 - .01;
  const pitch = Math.max(-pitchLimit, Math.min(pitchLimit, requestedPitch));
  const reposition = Math.abs(direction.y) > verticalRange || pitch !== requestedPitch;
  const rayZ = screenRay.y * Math.sin(pitch) + screenRay.z * Math.cos(pitch);
  const yaw = reposition ? new Euler().setFromQuaternion(pose.quaternion, 'YXZ').y
    : Math.atan2(screenRay.x, -rayZ) - Math.atan2(direction.x, -direction.z);
  // Keep the horizon level so OrbitControls can resume without removing roll.
  const quaternion = new Quaternion().setFromEuler(new Euler(pitch, yaw, 0, 'YXZ'));
  // Near a vertical view, an off-axis card centre may be unreachable by a
  // level turn alone. Move around the object at the same distance instead of
  // crossing the pole and letting OrbitControls flip the view after animation.
  const position = reposition ? object.clone().addScaledVector(screenRay.applyQuaternion(quaternion), -distance) : pose.position;
  return { ...pose, position, quaternion, target: position.clone().add(new Vector3(0, 0, -distance).applyQuaternion(quaternion)) };
}
