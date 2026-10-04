import { Box3, Euler, Frustum, Matrix4, PerspectiveCamera, Quaternion, Spherical, Vector3, type Camera } from 'three';
import type { Point } from './types';

export type MapObjectBounds = { min: [number, number, number]; max: [number, number, number] };

export function mapObjectInView(camera: Camera, point: Vector3, bounds?: MapObjectBounds | null) {
  camera.updateMatrixWorld();
  const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
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
export function mapGroundOrbitTarget(camera: Camera, boundary: Point[]) {
  if (boundary.length < 3) return null;
  const direction = camera.getWorldDirection(new Vector3());
  if (Math.abs(direction.y) < 1e-6) return null;
  const distance = -camera.position.y / direction.y;
  if (!Number.isFinite(distance) || distance < .01) return null;
  const target = camera.position.clone().addScaledVector(direction, distance);
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
  const offset = camera.position.clone().sub(pivot);
  if (offset.length() < .01) { turnMapView(camera, target, dx, dy, viewportHeight); return; }
  const distance = camera.position.distanceTo(target);
  const before = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(camera.position, pivot, camera.up));
  const spherical = new Spherical().setFromVector3(offset), speed = 2 * Math.PI / Math.max(1, viewportHeight);
  const maximumPolar = Math.max(Math.PI * .48, spherical.phi);
  spherical.theta -= dx * speed;
  spherical.phi = Math.max(.01, Math.min(maximumPolar, spherical.phi - dy * speed));
  camera.position.copy(pivot).add(offset.setFromSpherical(spherical));
  const after = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(camera.position, pivot, camera.up));
  camera.quaternion.premultiply(after.multiply(before.invert()));
  target.copy(camera.position).addScaledVector(camera.getWorldDirection(new Vector3()), distance);
  camera.updateMatrixWorld();
}
