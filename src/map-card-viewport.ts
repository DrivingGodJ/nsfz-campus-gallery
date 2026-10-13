import { Euler, PerspectiveCamera, Quaternion, Vector3, type Camera } from 'three';
import type { CameraPose } from './photo-camera.ts';
import type { MapObjectBounds } from './map-orbit.ts';
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

function objectCenter(bounds: MapObjectBounds) {
  return new Vector3(...bounds.min).add(new Vector3(...bounds.max)).multiplyScalar(.5);
}

function objectFraming(bounds: MapObjectBounds, quaternion: Quaternion, lensX: number, lensY: number, viewport: MapViewport, near: number, offsetX = 0, offsetY = 0) {
  const valid = [viewport.left, viewport.top, viewport.width, viewport.height].every(Number.isFinite) && viewport.width > 0 && viewport.height > 0;
  const frame = valid ? viewport : FULL_MAP_VIEWPORT;
  const x = 2 * (frame.left + frame.width / 2) - 1, y = 1 - 2 * (frame.top + frame.height / 2);
  const ray = new Vector3((x + offsetX) * lensX, (y + offsetY) * lensY, -1).normalize();
  // Solve the four exposed-frame planes for every corner; a bounding sphere
  // wastes most of the view around long wings and flat outdoor destinations.
  const left = (2 * (frame.left + frame.width * .08) - 1 + offsetX) * lensX;
  const right = (2 * (frame.left + frame.width * .92) - 1 + offsetX) * lensX;
  const bottom = (1 - 2 * (frame.top + frame.height * .92) + offsetY) * lensY;
  const top = (1 - 2 * (frame.top + frame.height * .08) + offsetY) * lensY;
  const center = objectCenter(bounds), inverse = quaternion.clone().invert();
  let distance = .01;
  for (const x of [bounds.min[0], bounds.max[0]]) for (const y of [bounds.min[1], bounds.max[1]]) for (const z of [bounds.min[2], bounds.max[2]]) {
    const point = new Vector3(x, y, z).sub(center).applyQuaternion(inverse);
    distance = Math.max(distance,
      (point.x + right * point.z) / (-ray.x - right * ray.z),
      (-point.x - left * point.z) / (ray.x + left * ray.z),
      (point.y + top * point.z) / (-ray.y - top * ray.z),
      (-point.y - bottom * point.z) / (ray.y + bottom * ray.z),
      (near + point.z) / -ray.z);
  }
  return { center, ray: ray.applyQuaternion(quaternion), distance };
}

// Object selections share a level downward approach, but fit their whole
// footprint into the map space actually left beside or above the photo card.
export function mapObjectFocusPose(pose: CameraPose, _object: Vector3, bounds: MapObjectBounds, aspect: number, viewport = FULL_MAP_VIEWPORT, groundHeight = 0): CameraPose {
  const yaw = new Euler().setFromQuaternion(pose.quaternion, 'YXZ').y;
  const quaternion = new Quaternion().setFromEuler(new Euler(-Math.PI / 4, yaw, 0, 'YXZ'));
  const lens = Math.tan(pose.fov * Math.PI / 360);
  const frame = objectFraming(bounds, quaternion, lens * aspect, lens, viewport, pose.near);
  const clearance = groundHeight + MAP_CAMERA_GROUND_HEIGHT - frame.center.y;
  const distance = Math.max(frame.distance, frame.ray.y < -1e-6 ? clearance / -frame.ray.y : 0);
  const position = frame.center.clone().addScaledVector(frame.ray, -distance);
  return { ...pose, position, quaternion, projectionOffset: { x: 0, y: 0 }, target: position.clone().add(new Vector3(0, 0, -distance).applyQuaternion(quaternion)) };
}

// The same fitted size controls manual approach. Centre-ray alignment is the
// priority between destinations; wall distance cannot pick a side-on neighbour.
export function mapObjectApproach(camera: Camera, bounds: MapObjectBounds, viewport = FULL_MAP_VIEWPORT): { distance: number; alignment: number; expanded: boolean } {
  camera.updateMatrixWorld();
  const center = objectCenter(bounds), toward = center.clone().sub(camera.position), distance = toward.length();
  if (!(camera instanceof PerspectiveCamera)) {
    const dot = distance ? camera.getWorldDirection(new Vector3()).dot(toward.normalize()) : 1;
    return { distance, alignment: Math.acos(Math.max(-1, Math.min(1, dot))), expanded: false };
  }
  const projection = camera.projectionMatrix.elements;
  const frame = objectFraming(bounds, camera.quaternion, 1 / projection[0], 1 / projection[5], viewport, camera.near, projection[8], projection[9]);
  const dot = distance ? frame.ray.dot(toward.normalize()) : 1;
  return { distance, alignment: Math.acos(Math.max(-1, Math.min(1, dot))), expanded: dot > 0 && distance <= frame.distance * 1.04 };
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
