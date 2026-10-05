import * as THREE from 'three';
import type { Photo } from './types';
import { directionVector, photoFieldOfView } from './photo-view.ts';
import { photoFrameSize } from './photo-perspective.ts';
import { FULL_MAP_VIEWPORT, viewportProjectionOffset, type MapViewport } from './map-card-viewport.ts';

export type CameraPose = { position: THREE.Vector3; quaternion: THREE.Quaternion; target: THREE.Vector3; fov: number; near: number; projectionOffset?: { x: number; y: number } };
const easing = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);


export function photoCameraPose(photo: Photo, height: number, canvasAspect: number, viewport = FULL_MAP_VIEWPORT): CameraPose {
  const position = new THREE.Vector3(photo.position.x, height, photo.position.z);
  const aspect = photo.width > 0 && photo.height > 0 ? photo.width / photo.height : 1.5;
  const frame = photoFrameSize(aspect, Math.max(.01, canvasAspect * viewport.width / viewport.height));
  const view = photoFieldOfView(photo);
  // Keep the original image's composition inside its frame, even in a narrow map panel.
  const fov = 2 * Math.atan(Math.tan((view?.vertical ?? 43) * Math.PI / 360) / (frame.height * viewport.height)) * 180 / Math.PI;
  return { position, target: position.clone().add(new THREE.Vector3(...directionVector(photo.heading, photo.pitch)).multiplyScalar(20)),
    quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(photo.pitch * Math.PI / 180, -photo.heading * Math.PI / 180, 0, 'YXZ')),
    fov, near: .08, projectionOffset: viewportProjectionOffset(viewport) };
}

export function readCameraPose(camera: THREE.PerspectiveCamera, target: THREE.Vector3): CameraPose {
  return { position: camera.position.clone(), quaternion: camera.quaternion.clone(), target: target.clone(), fov: camera.fov, near: camera.near,
    projectionOffset: camera.view?.enabled ? { x: camera.view.offsetX / camera.view.fullWidth, y: camera.view.offsetY / camera.view.fullHeight } : { x: 0, y: 0 } };
}

function applyProjectionOffset(camera: THREE.PerspectiveCamera, offset?: { x: number; y: number }) {
  if (offset && (Math.abs(offset.x) > 1e-9 || Math.abs(offset.y) > 1e-9)) camera.setViewOffset(camera.aspect, 1, offset.x * camera.aspect, offset.y, camera.aspect, 1);
  else if (camera.view?.enabled) camera.clearViewOffset();
}

export class PhotoCameraTransition {
  private animation: { from: CameraPose; to: CameraPose; elapsed: number; duration: number; firstFrame: boolean } | null = null;
  private returnPose: CameraPose | null = null;
  private photoView = false;
  get moving() { return this.animation !== null; }
  get inPhotoView() { return this.photoView; }
  get photoTransition() { return this.returnPose !== null; }

  focus(camera: THREE.PerspectiveCamera, target: THREE.Vector3, pose: CameraPose, reducedMotion = false, duration = .7) {
    if (!this.photoView && !this.returnPose) this.move(camera, target, pose, reducedMotion, duration);
  }
  cancelFocus() {
    if (!this.animation || this.photoView || this.returnPose) return false;
    this.animation = null;
    return true;
  }

  enter(camera: THREE.PerspectiveCamera, target: THREE.Vector3, pose: CameraPose, reducedMotion = false) {
    this.returnPose ??= readCameraPose(camera, target);
    this.photoView = true;
    this.move(camera, target, pose, reducedMotion);
  }
  leave(camera: THREE.PerspectiveCamera, target: THREE.Vector3, reducedMotion = false) {
    if (!this.photoView || !this.returnPose) return;
    const pose = this.returnPose;
    this.photoView = false;
    this.move(camera, target, pose, reducedMotion);
  }
  reframe(camera: THREE.PerspectiveCamera, pose: CameraPose) {
    if (!this.photoView) return;
    if (this.animation) {
      const t = this.animation.duration ? Math.min(1, this.animation.elapsed / this.animation.duration) : 1;
      const ease = easing(t);
      // Resize changes framing, not the position path or its remaining time.
      if (ease < 1) this.animation.from.fov = (camera.fov - ease * pose.fov) / (1 - ease);
      this.animation.to.fov = pose.fov;
      const current = readCameraPose(camera, new THREE.Vector3()).projectionOffset!, next = pose.projectionOffset || { x: 0, y: 0 };
      if (ease < 1) this.animation.from.projectionOffset = { x: (current.x - ease * next.x) / (1 - ease), y: (current.y - ease * next.y) / (1 - ease) };
      this.animation.to.projectionOffset = next;
    } else { camera.fov = pose.fov; applyProjectionOffset(camera, pose.projectionOffset); camera.updateProjectionMatrix(); }
  }
  orient(camera: THREE.PerspectiveCamera, target: THREE.Vector3, heading: number, pitch: number) {
    if (!this.photoView) return;
    // Taking control during entry finishes the move to the shooting position.
    // Subsequent pointer events have no tween, damping or residual momentum.
    if (this.animation) this.apply(camera, target, 1);
    camera.quaternion.setFromEuler(new THREE.Euler(pitch * Math.PI / 180, -heading * Math.PI / 180, 0, 'YXZ'));
    target.copy(camera.position).add(new THREE.Vector3(0, 0, -20).applyQuaternion(camera.quaternion));
    camera.updateMatrixWorld();
  }
  private move(camera: THREE.PerspectiveCamera, target: THREE.Vector3, to: CameraPose, reducedMotion: boolean, duration = .95) {
    this.animation = { from: readCameraPose(camera, target), to, elapsed: 0, duration: reducedMotion ? 0 : duration, firstFrame: true };
    this.tick(camera, target, 0);
  }
  tick(camera: THREE.PerspectiveCamera, target: THREE.Vector3, delta: number) {
    const animation = this.animation;
    if (!animation) return false;
    // Demand rendering can resume after seconds of inactivity. That idle time is
    // not animation time; otherwise its first frame skips straight to the end.
    const step = Math.max(0, delta);
    animation.elapsed += animation.firstFrame ? Math.min(.05, step) : step;
    if (step > 0) animation.firstFrame = false;
    const t = animation.duration ? Math.min(1, animation.elapsed / animation.duration) : 1;
    this.apply(camera, target, t);
    return true;
  }
  private apply(camera: THREE.PerspectiveCamera, target: THREE.Vector3, t: number) {
    const animation = this.animation;
    if (!animation) return;
    const ease = easing(t);
    camera.position.lerpVectors(animation.from.position, animation.to.position, ease);
    camera.quaternion.slerpQuaternions(animation.from.quaternion, animation.to.quaternion, ease);
    target.lerpVectors(animation.from.target, animation.to.target, ease);
    camera.fov = THREE.MathUtils.lerp(animation.from.fov, animation.to.fov, ease);
    const fromOffset = animation.from.projectionOffset || { x: 0, y: 0 }, toOffset = animation.to.projectionOffset || { x: 0, y: 0 };
    applyProjectionOffset(camera, { x: THREE.MathUtils.lerp(fromOffset.x, toOffset.x, ease), y: THREE.MathUtils.lerp(fromOffset.y, toOffset.y, ease) });
    // Reduce clipping immediately on entry; restore the map plane only at the end of the return.
    camera.near = t === 1 ? animation.to.near : Math.min(animation.from.near, animation.to.near);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    if (t === 1) { this.animation = null; if (!this.photoView) this.returnPose = null; }
  }
}
