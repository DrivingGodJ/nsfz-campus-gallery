import { Box3, Euler, Frustum, Matrix4, PerspectiveCamera, Raycaster, Vector2, Vector3, type Camera } from 'three';
import type { Point } from './types';
import { FULL_MAP_VIEWPORT, type MapViewport } from './map-card-viewport.ts';

export type MapObjectBounds = { min: [number, number, number]; max: [number, number, number] };

export function mapObjectInView(camera: Camera, point: Vector3, bounds?: MapObjectBounds | null, viewport = FULL_MAP_VIEWPORT) {
  camera.updateMatrixWorld();
  const x = 2 * (viewport.left + viewport.width / 2) - 1, y = 1 - 2 * (viewport.top + viewport.height / 2);
  // Crop the frustum to the exposed rectangle, retaining near/far clipping.
  const crop = new Matrix4().set(1 / viewport.width, 0, 0, -x / viewport.width,
    0, 1 / viewport.height, 0, -y / viewport.height, 0, 0, 1, 0, 0, 0, 0, 1);
  const frustum = new Frustum().setFromProjectionMatrix(crop.multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse));
  // A building can still be visible with its centre outside the frame.
  return bounds ? frustum.intersectsBox(new Box3(new Vector3(...bounds.min), new Vector3(...bounds.max))) : frustum.containsPoint(point);
}

function withinBoundary(point: Vector3, boundary: Point[]) {
  let inside = false;
  for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
    const [ax, az] = boundary[j], [bx, bz] = boundary[i];
    const dx = bx - ax, dz = bz - az, lengthSquared = dx * dx + dz * dz;
    if (lengthSquared > 0) {
      const t = Math.max(0, Math.min(1, ((point.x - ax) * dx + (point.z - az) * dz) / lengthSquared));
      if (Math.hypot(point.x - ax - t * dx, point.z - az - t * dz) < 1e-6) return true;
    }
    if ((az > point.z) !== (bz > point.z) && point.x < ax + (point.z - az) * dx / dz) inside = !inside;
  }
  return inside;
}

// Only the forward centre ray counts. A point behind the camera or outside
// campus must not turn a look gesture into a distant orbit.
export function mapGroundOrbitTarget(camera: Camera, boundary: Point[], viewport: MapViewport = FULL_MAP_VIEWPORT) {
  if (boundary.length < 3) return null;
  camera.updateMatrixWorld();
  const raycaster = new Raycaster();
  raycaster.setFromCamera(new Vector2(2 * (viewport.left + viewport.width / 2) - 1, 1 - 2 * (viewport.top + viewport.height / 2)), camera);
  const { origin, direction } = raycaster.ray;
  if (Math.abs(direction.y) < 1e-6) return null;
  const distance = -origin.y / direction.y;
  if (!Number.isFinite(distance) || distance < .01) return null;
  const target = origin.clone().addScaledVector(direction, distance);
  target.y = 0;
  return withinBoundary(target, boundary) ? target : null;
}

// Grab the scenery without translating the camera. Keep a target on the new
// gaze so OrbitControls can resume without changing the view on the next frame.
export function turnMapView(camera: Camera, target: Vector3, dx: number, dy: number, viewportHeight: number) {
  const lens = camera instanceof PerspectiveCamera ? 2 * Math.tan(camera.fov * Math.PI / 360) : 1;
  const radiansPerPixel = lens / Math.max(1, viewportHeight);
  const orientation = new Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  orientation.y += dx * radiansPerPixel;
  orientation.x = Math.max(-Math.PI / 2 + .01, Math.min(Math.PI / 2 - .01, orientation.x + dy * radiansPerPixel));
  orientation.z = 0;
  const distance = Math.max(1, camera.position.distanceTo(target));
  camera.quaternion.setFromEuler(orientation);
  target.copy(camera.position).addScaledVector(camera.getWorldDirection(new Vector3()), distance);
  camera.updateMatrixWorld();
}

// A selected object stays the pivot even after panning or travelling past it.
// Rotate the camera's position and orientation together, preserving any
// off-centre composition instead of snapping the gaze when the finger lands.
export function orbitMapObject(camera: Camera, target: Vector3, pivot: Vector3, dx: number, dy: number, viewportHeight: number) {
  camera.updateMatrixWorld();
  const radius = camera.position.distanceTo(pivot);
  if (radius < .01) { turnMapView(camera, target, dx, dy, viewportHeight); return; }
  const distance = camera.position.distanceTo(target);
  const direction = pivot.clone().sub(camera.position).normalize();
  const screenRay = direction.clone().applyQuaternion(camera.quaternion.clone().invert());
  const orientation = new Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  const speed = 2 * Math.PI / Math.max(1, viewportHeight);
  // Retain the elevation limit around the pivot, accounting for its off-axis ray.
  const maximumPolar = Math.max(Math.PI * .48, Math.acos(Math.max(-1, Math.min(1, -direction.y))));
  const verticalRange = Math.hypot(screenRay.y, screenRay.z);
  const maximumPitch = Math.max(orientation.x, Math.asin(Math.max(-1, Math.min(1, -Math.cos(maximumPolar) / verticalRange)))
    - Math.atan2(screenRay.y, -screenRay.z));
  orientation.y -= dx * speed;
  orientation.x = Math.max(-Math.PI / 2 + .01, Math.min(Math.PI / 2 - .01, maximumPitch, orientation.x - dy * speed));
  orientation.z = 0;
  // Rotate the gaze and the offset together. Reframing a spherical orbit can
  // cross the camera's vertical pole when a card moves the pivot off-centre;
  // OrbitControls then flips the horizon by 180 degrees. Keeping the original
  // camera-space ray preserves composition without that second correction.
  camera.quaternion.setFromEuler(orientation);
  camera.position.copy(pivot).addScaledVector(screenRay.applyQuaternion(camera.quaternion), -radius);
  target.copy(camera.position).addScaledVector(camera.getWorldDirection(new Vector3()), distance);
  camera.updateMatrixWorld();
}
