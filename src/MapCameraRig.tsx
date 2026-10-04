import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import type { Photo, Point } from './types';
import { PhotoCameraTransition, photoCameraPose, readCameraPose } from './photo-camera';
import { bindPhotoLookControls, type PhotoOrientation } from './photo-look-controls';
import { bindMapTravelControls, mapGroundViewDistance, mapTravelStep, panMapView, travelAlongView } from './map-travel-controls';
import { mapGroundOrbitTarget, mapObjectInView, orbitMapObject, turnMapView, type MapObjectBounds } from './map-orbit';

export type MapPhoto = Photo & { position: { x: number; z: number; height: number } };
export type MapCommand = { type: string; sequence: number; target?: [number, number, number]; distance?: number };
// View into campus from the gate: dormitory and cafeteria fronts face the camera.
export const OVERVIEW_POSITION: [number, number, number] = [-240, 340, -380];
const OVERVIEW_DISTANCE = 560;

function stopOrbitMomentum(camera: THREE.Camera, control: OrbitControlsImpl) {
  const position = camera.position.clone(), quaternion = camera.quaternion.clone(), target = control.target.clone();
  const damping = control.enableDamping;
  // Consume pending drag inertia without moving the current view. Otherwise
  // it resumes after a camera journey and shifts the restored position.
  control.enableDamping = false; control.update(); control.enableDamping = damping;
  camera.position.copy(position); camera.quaternion.copy(quaternion); control.target.copy(target);
  camera.updateMatrixWorld();
}

export default function MapCameraRig({ command, boundary, selectedObjectTarget, selectedObjectBounds, selected, preview, canAdjustPhotoView = false, onMoving, onCompact, onAzimuth, onPhotoOrientation }: {
  boundary: Point[];
  selectedObjectTarget?: [number, number, number] | null;
  selectedObjectBounds?: MapObjectBounds | null;
  command: MapCommand; selected?: MapPhoto | null; preview: MapPhoto | null;
  canAdjustPhotoView?: boolean;
  onMoving: (value: boolean) => void; onCompact: (value: boolean) => void; onAzimuth: (value: number) => void;
  onPhotoOrientation?: (orientation: PhotoOrientation) => void;
}) {
  const controls = useRef<OrbitControlsImpl>(null);
  const motion = useRef(new PhotoCameraTransition());
  const { camera, invalidate, size, gl, get, setEvents } = useThree();
  const look = useRef<(PhotoOrientation & { id: string; sourceHeading: number; sourcePitch: number }) | null>(null);
  const lastPoseKey = useRef('');
  const lastShotKey = useRef('');
  const objectTarget: [number, number, number] | null = selected ? [selected.position.x, selected.position.height, selected.position.z] : selectedObjectTarget ?? null;
  const objectKey = JSON.stringify(objectTarget);
  const gesturePivot = useRef<THREE.Vector3 | null>(null);
  const touchOrbit = useRef<{ rotate: boolean; pan: boolean } | null>(null);
  const objectBounds = selected ? null : selectedObjectBounds;
  const live = useRef({ size, boundary, objectTarget, objectBounds, preview, onMoving, onPhotoOrientation });
  live.current = { size, boundary, objectTarget, objectBounds, preview, onMoving, onPhotoOrientation };
  const lastCompact = useRef(false), lastAzimuth = useRef(NaN), previousFit = useRef(0);
  const fitDistance = OVERVIEW_DISTANCE / Math.min(1, size.width / Math.max(1, size.height));

  useEffect(() => {
    const control = controls.current;
    if (!control) return;
    if (!selected && (!preview || !previousFit.current) && !motion.current.moving && !motion.current.inPhotoView) {
      const offset = camera.position.clone().sub(control.target);
      offset.multiplyScalar(previousFit.current ? fitDistance / previousFit.current : fitDistance / offset.length());
      camera.position.copy(control.target).add(offset);
      control.update(); invalidate();
    }
    previousFit.current = fitDistance;
  }, [fitDistance, camera, invalidate]);

  useEffect(() => bindMapTravelControls(gl.domElement, {
    enabled: () => !!controls.current?.enabled && !live.current.preview && !motion.current.photoTransition,
    travel: steps => {
      const control = controls.current;
      if (!control) return;
      travelAlongView(camera, control.target, steps * mapTravelStep(camera));
      control.update(); invalidate();
    },
    pan: (dx, dy) => {
      const control = controls.current;
      if (!control || !(camera instanceof THREE.PerspectiveCamera)) return;
      panMapView(camera, control.target, dx, dy, live.current.size.height);
      control.update(); invalidate();
    },
    multiTouch: active => {
      const control = controls.current;
      if (!control) return;
      if (active) {
        stopOrbitMomentum(camera, control);
        touchOrbit.current = { rotate: control.enableRotate, pan: control.enablePan };
        control.enableRotate = false; control.enablePan = false;
      } else if (touchOrbit.current) {
        control.enableRotate = touchOrbit.current.rotate; control.enablePan = touchOrbit.current.pan;
        touchOrbit.current = null;
      }
      invalidate();
    },
    rotation: {
      start: () => {
        const control = controls.current!;
        stopOrbitMomentum(camera, control);
        gesturePivot.current = live.current.objectTarget ? new THREE.Vector3(...live.current.objectTarget) : null;
        if (gesturePivot.current && !mapObjectInView(camera, gesturePivot.current, live.current.objectBounds)) gesturePivot.current = null;
        if (gesturePivot.current) {
          control.enableRotate = false; control.maxPolarAngle = Math.PI - .01;
          return true;
        }
        const target = mapGroundOrbitTarget(camera, live.current.boundary);
        control.enableRotate = !!target;
        if (target) {
          control.target.copy(target);
          const polar = Math.acos(THREE.MathUtils.clamp((camera.position.y - target.y) / camera.position.distanceTo(target), -1, 1));
          control.maxPolarAngle = Math.max(Math.PI * .48, polar);
          control.update(); invalidate();
        } else {
          // Looking outside campus may include the sky; don't clamp it back
          // toward the ground when the regular controls update next frame.
          control.maxPolarAngle = Math.PI - .01;
        }
        return !target;
      },
      look: (dx, dy) => {
        const control = controls.current!;
        if (gesturePivot.current) orbitMapObject(camera, control.target, gesturePivot.current, dx, dy, live.current.size.height);
        else turnMapView(camera, control.target, dx, dy, live.current.size.height);
        control.update(); invalidate();
      },
      finish: () => { gesturePivot.current = null; if (controls.current) controls.current.enableRotate = true; }
    }
  }), [camera, gl, invalidate]);

  // Runs before Drei's controls update, so orbit damping cannot fight the animation.
  useFrame(() => {
    if (controls.current) controls.current.enabled = !preview && !motion.current.moving;
  }, -2);
  useFrame((_, delta) => {
    const control = controls.current;
    if (!control || !(camera instanceof THREE.PerspectiveCamera)) return;
    if (motion.current.tick(camera, control.target, delta)) {
      if (!motion.current.moving) live.current.onMoving(false);
      invalidate();
    }
    if (preview || motion.current.inPhotoView) return;
    const target = control.target;
    const compact = mapGroundViewDistance(camera) > 360;
    if (compact !== lastCompact.current) { lastCompact.current = compact; onCompact(compact); }
    const center = target.clone().project(camera), north = target.clone().add(new THREE.Vector3(0, 0, -10)).project(camera);
    const angle = Math.round(Math.atan2((north.x - center.x) * size.width, (north.y - center.y) * size.height) * 180 / Math.PI);
    if (Number.isFinite(angle) && angle !== lastAzimuth.current) { lastAzimuth.current = angle; onAzimuth(angle); }
  });

  useEffect(() => {
    const control = controls.current;
    if (!control || preview || motion.current.photoTransition || !(camera instanceof THREE.PerspectiveCamera) || command.type === 'initial') return;
    stopOrbitMomentum(camera, control);
    const pose = readCameraPose(camera, control.target);
    const offset = camera.position.clone().sub(control.target);
    if (command.type === 'reset') { pose.target.set(0, 0, 0); pose.position.fromArray(OVERVIEW_POSITION).normalize().multiplyScalar(fitDistance); }
    if (command.type === 'north') { const length = offset.length(); pose.position.copy(pose.target).add(new THREE.Vector3(0, length * .72, length * .7)); }
    if (command.type === 'top') { pose.target.set(0, 0, 0); pose.position.set(0, fitDistance, .5); }
    if (command.type === 'in' || command.type === 'out') {
      const movement = camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(mapTravelStep(camera) * (command.type === 'in' ? 1 : -1));
      pose.position.add(movement); pose.target.add(movement);
      // Button presses can interrupt an ordinary map journey immediately.
      motion.current.focus(camera, control.target, pose, true);
      control.enabled = true; control.update(); invalidate(); return;
    }
    if (command.type === 'cluster' && command.target && command.distance) {
      pose.target.fromArray(command.target);
      pose.position.copy(pose.target).add(offset.normalize().multiplyScalar(command.distance));
    }
    const oriented = camera.clone(); oriented.position.copy(pose.position); oriented.lookAt(pose.target);
    pose.quaternion.copy(oriented.quaternion);
    control.enabled = false;
    motion.current.focus(camera, control.target, pose, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    invalidate();
  }, [command, camera, invalidate]);

  useEffect(() => {
    const control = controls.current;
    if (!objectTarget || !control || preview || motion.current.photoTransition || !(camera instanceof THREE.PerspectiveCamera)) return;
    stopOrbitMomentum(camera, control);
    const target = new THREE.Vector3(...objectTarget);
    const pose = readCameraPose(camera, control.target);
    pose.position.add(target.clone().sub(control.target)); pose.target.copy(target);
    control.enabled = false;
    motion.current.focus(camera, control.target, pose, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    invalidate();
  }, [selected?.id, objectKey, camera, invalidate]);

  useEffect(() => {
    const control = controls.current;
    if (!control || !(camera instanceof THREE.PerspectiveCamera)) return;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (preview) {
      const shotKey = JSON.stringify([preview.id, preview.position, preview.heading, preview.pitch, preview.width, preview.height, canAdjustPhotoView,
        preview.metadata?.focalLength35Mm, preview.metadata?.focalLengthMm, preview.view]);
      const poseKey = JSON.stringify([shotKey, size.width, size.height]);
      if (poseKey === lastPoseKey.current) return;
      const samePhoto = look.current?.id === preview.id && motion.current.inPhotoView;
      const resizing = samePhoto && shotKey === lastShotKey.current;
      if (!canAdjustPhotoView || !look.current || look.current.id !== preview.id || look.current.sourceHeading !== preview.heading || look.current.sourcePitch !== preview.pitch) {
        look.current = { id: preview.id, sourceHeading: preview.heading, sourcePitch: preview.pitch, heading: preview.heading, pitch: preview.pitch };
      }
      lastPoseKey.current = poseKey;
      lastShotKey.current = shotKey;
      if (!motion.current.inPhotoView && !motion.current.moving) {
        // Flush residual orbit momentum before saving the view to return to.
        stopOrbitMomentum(camera, control);
      }
      control.enabled = false;
      const pose = photoCameraPose({ ...preview, ...look.current }, preview.position.height, size.width / Math.max(1, size.height));
      if (resizing) motion.current.reframe(camera, pose);
      else motion.current.enter(camera, control.target, pose, reducedMotion || (samePhoto && !motion.current.moving));
    } else if (motion.current.inPhotoView) {
      look.current = null; lastPoseKey.current = ''; lastShotKey.current = '';
      control.enabled = false;
      motion.current.leave(camera, control.target, reducedMotion);
    }
    onMoving(motion.current.photoTransition && motion.current.moving); invalidate();
  }, [preview?.id, preview?.position.x, preview?.position.z, preview?.position.height, preview?.heading, preview?.pitch,
    preview?.width, preview?.height, preview?.metadata?.focalLength35Mm, preview?.metadata?.focalLengthMm,
    preview?.view?.focalLength35Mm, preview?.view?.cropFactor, canAdjustPhotoView, size.width, size.height, camera, invalidate, onMoving]);

  useEffect(() => {
    const control = controls.current;
    if (!preview || !control || !(camera instanceof THREE.PerspectiveCamera)) return;
    // Both modes suspend map picking; only the editor accepts camera adjustments.
    const eventsEnabled = get().events.enabled;
    setEvents({ enabled: false });
    const unbind = canAdjustPhotoView ? bindPhotoLookControls(gl.domElement, {
      angles: () => ({ heading: look.current!.heading, pitch: look.current!.pitch }),
      degreesPerPixel: () => 2 * Math.tan(camera.fov * Math.PI / 360) * 180 / Math.PI / Math.max(1, live.current.size.height),
      start: () => {
        motion.current.orient(camera, control.target, look.current!.heading, look.current!.pitch);
        live.current.onMoving(false); invalidate();
      },
      look: orientation => {
        Object.assign(look.current!, orientation);
        motion.current.orient(camera, control.target, orientation.heading, orientation.pitch);
        invalidate();
      },
      commit: orientation => live.current.onPhotoOrientation?.(orientation)
    }) : undefined;
    return () => { unbind?.(); setEvents({ enabled: eventsEnabled }); };
  }, [preview?.id, canAdjustPhotoView, camera, gl, get, setEvents, invalidate]);

  return <OrbitControls ref={controls} makeDefault enableZoom={false} enableDamping dampingFactor={.08} minPolarAngle={.01} maxPolarAngle={Math.PI * .48} target={[0, 0, 0]} />;
}
