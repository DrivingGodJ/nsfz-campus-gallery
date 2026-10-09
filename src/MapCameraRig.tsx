import { useCallback, useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import type { Photo } from './types';
import { PhotoCameraTransition, photoCameraPose, readCameraPose } from './photo-camera';
import { bindPhotoLookControls, type PhotoOrientation, type PhotoViewAdjustment } from './photo-look-controls';
import { bindMapTravelControls, mapGroundViewDistance, mapTravelStep, panMapView, retargetMapPan, travelAlongView } from './map-travel-controls';
import { mapGroundOrbitTarget, mapObjectInView, orbitMapObject, turnMapView, type MapObjectBounds } from './map-orbit';
import { aboveGroundMovement, keepMapCameraAboveGround, shiftMapCameraGround, MAP_CAMERA_GROUND_HEIGHT } from './map-camera-ground';
import { FULL_MAP_VIEWPORT, frameMapTarget, photoMapFocusPose, type MapViewport } from './map-card-viewport';

export type MapPhoto = Photo & { position: { x: number; z: number; height: number }; pointHeight?: number; pointOpacity?: number };
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

export default function MapCameraRig({ command, selectedObjectTarget, selectedObjectBounds, selected, preview, groundHeight = 0, visibleViewport = FULL_MAP_VIEWPORT, canAdjustPhotoView = false, photoHeightRange, smoothPhotoFraming = false, onMoving, onCompact, onAzimuth, onPhotoOrientation, onSelectionOutOfView }: {
  selectedObjectTarget?: [number, number, number] | null;
  selectedObjectBounds?: MapObjectBounds | null;
  command: MapCommand; selected?: MapPhoto | null; preview: MapPhoto | null;
  canAdjustPhotoView?: boolean; smoothPhotoFraming?: boolean;
  groundHeight?: number;
  photoHeightRange?: { min: number; max: number };
  visibleViewport?: MapViewport;
  onMoving: (value: boolean) => void; onCompact: (value: boolean) => void; onAzimuth: (value: number) => void;
  onPhotoOrientation?: (orientation: PhotoViewAdjustment) => void;
  onSelectionOutOfView?: () => void;
}) {
  const controls = useRef<OrbitControlsImpl>(null);
  const motion = useRef(new PhotoCameraTransition());
  const { camera, invalidate, size, gl, get, setEvents } = useThree();
  const look = useRef<(PhotoOrientation & { id: string; sourceHeading: number; sourcePitch: number }) | null>(null);
  const positionChanged = useRef(false);
  const heightChanged = useRef(false);
  const lastPoseKey = useRef('');
  const lastShotKey = useRef('');
  const objectTarget: [number, number, number] | null = selected ? [selected.position.x, selected.position.height, selected.position.z] : selectedObjectTarget ?? null;
  const objectKey = JSON.stringify(objectTarget);
  const gesturePivot = useRef<THREE.Vector3 | null>(null);
  const touchOrbit = useRef<{ rotate: boolean; pan: boolean } | null>(null);
  const objectBounds = selected ? null : selectedObjectBounds;
  const viewportKey = JSON.stringify(visibleViewport);
  const live = useRef({ size, objectTarget, objectBounds, objectKey, selected, visibleViewport, preview, groundHeight, photoHeightRange, onMoving, onPhotoOrientation, onSelectionOutOfView });
  live.current = { size, objectTarget, objectBounds, objectKey, selected, visibleViewport, preview, groundHeight, photoHeightRange, onMoving, onPhotoOrientation, onSelectionOutOfView };
  const lastGround = useRef(0);
  const pendingFocus = useRef(false);
  const dismissedObjectKey = useRef('');
  const lastCompact = useRef(false), lastAzimuth = useRef(NaN), previousFit = useRef(0);
  const fitDistance = OVERVIEW_DISTANCE / Math.min(1, size.width / Math.max(1, size.height));

  const switchGroundReference = useCallback(() => {
    const control = controls.current, current = live.current;
    if (!control || current.preview || motion.current.inPhotoView || motion.current.photoTransition || lastGround.current === current.groundHeight) return;
    motion.current.cancelFocus();
    stopOrbitMomentum(camera, control);
    shiftMapCameraGround(camera, control.target, lastGround.current, current.groundHeight);
    lastGround.current = current.groundHeight;
    gesturePivot.current = null;
    invalidate();
  }, [camera, invalidate]);

  useEffect(() => { switchGroundReference(); }, [groundHeight, switchGroundReference]);

  useEffect(() => {
    const control = controls.current;
    if (!control) return;
    if (!objectTarget && (!preview || !previousFit.current) && !motion.current.moving && !motion.current.inPhotoView) {
      const offset = camera.position.clone().sub(control.target);
      offset.multiplyScalar(previousFit.current ? fitDistance / previousFit.current : fitDistance / offset.length());
      camera.position.copy(control.target).add(offset);
      if (camera instanceof THREE.PerspectiveCamera) {
        const pose = frameMapTarget(readCameraPose(camera, control.target), control.target, camera.aspect, live.current.visibleViewport);
        camera.quaternion.copy(pose.quaternion); control.target.copy(pose.target);
      }
      control.update(); invalidate();
    }
    previousFit.current = fitDistance;
  }, [fitDistance, camera, invalidate]);

  const focusSelectedObject = useCallback(() => {
    const control = controls.current, current = live.current;
    if (!control || !current.objectTarget || current.preview || motion.current.photoTransition || !(camera instanceof THREE.PerspectiveCamera)) return;
    stopOrbitMomentum(camera, control);
    const target = new THREE.Vector3(...current.objectTarget);
    // Photos, buildings and areas share the same fixed approach and exposed centre.
    const pose = photoMapFocusPose(readCameraPose(camera, control.target), target, camera.aspect, current.visibleViewport, current.groundHeight);
    pendingFocus.current = false;
    control.enabled = false;
    motion.current.focus(camera, control.target, pose, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    invalidate();
  }, [camera, invalidate]);

  const activateMapInput = useCallback(() => {
    const control = controls.current;
    if (!control || live.current.preview) return false;
    const returning = camera instanceof THREE.PerspectiveCamera && motion.current.cancelReturn(camera, control.target);
    const focusing = motion.current.cancelFocus();
    if (returning || focusing) {
      pendingFocus.current = false;
      stopOrbitMomentum(camera, control);
      switchGroundReference();
      keepMapCameraAboveGround(camera, control.target, false, live.current.groundHeight);
      // Interpolated targets and orientations can disagree partway through a
      // journey. Resume orbit along the current gaze rather than snapping to it.
      control.target.copy(camera.position).addScaledVector(camera.getWorldDirection(new THREE.Vector3()), Math.max(1, camera.position.distanceTo(control.target)));
      live.current.onMoving(false);
      invalidate();
    }
    // Demand rendering may still have disabled controls from the animation's
    // last frame. Check the current journey rather than losing the next down.
    control.enabled = !motion.current.moving && !motion.current.photoTransition;
    return control.enabled;
  }, [camera, invalidate, switchGroundReference]);

  useEffect(() => {
    const surface = gl.domElement.closest?.('.map-stage') || gl.domElement;
    const interrupt = () => { activateMapInput(); };
    surface.addEventListener('pointerdown', interrupt, true);
    surface.addEventListener('wheel', interrupt, true);
    return () => { surface.removeEventListener('pointerdown', interrupt, true); surface.removeEventListener('wheel', interrupt, true); };
  }, [gl, activateMapInput]);

  useEffect(() => bindMapTravelControls(gl.domElement, {
    enabled: activateMapInput,
    travel: steps => {
      const control = controls.current;
      if (!control) return;
      travelAlongView(camera, control.target, steps * mapTravelStep(camera, live.current.groundHeight), live.current.groundHeight);
      control.update(); invalidate();
    },
    pan: (dx, dy) => {
      const control = controls.current;
      if (!control || !(camera instanceof THREE.PerspectiveCamera)) return;
      panMapView(camera, control.target, dx, dy, live.current.size.height, live.current.groundHeight);
      control.update(); invalidate();
    },
    panStart: () => {
      const control = controls.current;
      if (!control || !(camera instanceof THREE.PerspectiveCamera)) return;
      stopOrbitMomentum(camera, control);
      retargetMapPan(camera, control.target, live.current.visibleViewport, live.current.groundHeight);
    },
    multiTouch: active => {
      const control = controls.current;
      if (!control) return;
      if (active) {
        stopOrbitMomentum(camera, control);
        if (camera instanceof THREE.PerspectiveCamera) retargetMapPan(camera, control.target, live.current.visibleViewport, live.current.groundHeight);
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
        if (gesturePivot.current && !mapObjectInView(camera, gesturePivot.current, live.current.objectBounds, live.current.visibleViewport)) gesturePivot.current = null;
        if (!gesturePivot.current) {
          gesturePivot.current = mapGroundOrbitTarget(camera, live.current.visibleViewport, live.current.groundHeight);
          if (gesturePivot.current) {
            // The exposed centre is off-axis. Retarget along the existing gaze
            // rather than snapping the whole canvas centre onto its ground hit.
            control.target.copy(camera.position).addScaledVector(camera.getWorldDirection(new THREE.Vector3()), camera.position.distanceTo(gesturePivot.current));
          }
        }
        control.enableRotate = false; control.maxPolarAngle = Math.PI - .01;
        return true;
      },
      look: (dx, dy) => {
        const control = controls.current!;
        if (gesturePivot.current) orbitMapObject(camera, control.target, gesturePivot.current, dx, dy, live.current.size.height);
        else turnMapView(camera, control.target, dx, dy, live.current.size.height);
        keepMapCameraAboveGround(camera, control.target, false, live.current.groundHeight);
        control.update(); invalidate();
      },
      finish: () => { gesturePivot.current = null; if (controls.current) controls.current.enableRotate = true; }
    }
  }), [camera, gl, invalidate, activateMapInput]);

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
    if (preview || motion.current.inPhotoView || motion.current.photoTransition) return;
    // A mode change during a photograph waits until its exact return pose has
    // finished. The calibrated photo and its camera journey remain untouched.
    switchGroundReference();
    if (pendingFocus.current) focusSelectedObject();
    if (keepMapCameraAboveGround(camera, control.target, false, live.current.groundHeight)) {
      stopOrbitMomentum(camera, control);
      invalidate();
    }
    const current = live.current;
    if (!motion.current.moving && !pendingFocus.current && current.objectTarget && current.onSelectionOutOfView
      && dismissedObjectKey.current !== current.objectKey && !mapObjectInView(camera, new THREE.Vector3(...current.objectTarget), current.objectBounds, current.visibleViewport)) {
      dismissedObjectKey.current = current.objectKey; gesturePivot.current = null;
      current.onSelectionOutOfView();
    }
    const target = control.target;
    const compact = mapGroundViewDistance(camera, live.current.groundHeight) > 360;
    if (compact !== lastCompact.current) { lastCompact.current = compact; onCompact(compact); }
    const center = target.clone().project(camera), north = target.clone().add(new THREE.Vector3(0, 0, -10)).project(camera);
    const angle = Math.round(Math.atan2((north.x - center.x) * size.width, (north.y - center.y) * size.height) * 180 / Math.PI);
    if (Number.isFinite(angle) && angle !== lastAzimuth.current) { lastAzimuth.current = angle; onAzimuth(angle); }
  });

  useEffect(() => {
    const control = controls.current;
    if (!control || preview || motion.current.photoTransition || !(camera instanceof THREE.PerspectiveCamera) || command.type === 'initial') return;
    stopOrbitMomentum(camera, control);
    let pose = readCameraPose(camera, control.target);
    const offset = camera.position.clone().sub(control.target);
    const surface = live.current.groundHeight;
    if (command.type === 'reset') { pose.target.set(0, surface, 0); pose.position.fromArray(OVERVIEW_POSITION).normalize().multiplyScalar(fitDistance); pose.position.y += surface; }
    if (command.type === 'north') { const length = offset.length(); pose.position.copy(pose.target).add(new THREE.Vector3(0, length * .72, length * .7)); }
    if (command.type === 'top') { pose.target.set(0, surface, 0); pose.position.set(0, fitDistance + surface, .5); }
    if (command.type === 'in' || command.type === 'out') {
      const movement = aboveGroundMovement(camera.position, camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(mapTravelStep(camera, surface) * (command.type === 'in' ? 1 : -1)), surface);
      pose.position.add(movement); pose.target.add(movement);
      // Retarget from the current frame, so repeated or opposite presses stay continuous.
      control.enabled = false;
      motion.current.focus(camera, control.target, pose, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, .35);
      invalidate(); return;
    }
    if (command.type === 'cluster' && command.target) {
      pose = photoMapFocusPose(pose, new THREE.Vector3(...command.target), camera.aspect, live.current.visibleViewport, surface);
    } else {
      pose.position.y = Math.max(surface + MAP_CAMERA_GROUND_HEIGHT, pose.position.y);
      const oriented = camera.clone(); oriented.position.copy(pose.position); oriented.lookAt(pose.target);
      pose.quaternion.copy(oriented.quaternion);
      if (command.type === 'reset') pose = frameMapTarget(pose, pose.target, camera.aspect, live.current.visibleViewport);
    }
    control.enabled = false;
    motion.current.focus(camera, control.target, pose, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
    invalidate();
  }, [command, camera, invalidate]);

  useEffect(() => {
    dismissedObjectKey.current = '';
    pendingFocus.current = !!objectTarget;
    if (!objectTarget) return;
    focusSelectedObject();
  }, [selected?.id, objectKey, viewportKey, size.width, size.height, focusSelectedObject]);

  useEffect(() => {
    const control = controls.current;
    if (!control || !(camera instanceof THREE.PerspectiveCamera)) return;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (preview) {
      const shotKey = JSON.stringify([preview.id, preview.position, preview.heading, preview.pitch, preview.width, preview.height, canAdjustPhotoView,
        preview.metadata?.focalLength35Mm, preview.metadata?.focalLengthMm, preview.view]);
      const poseKey = JSON.stringify([shotKey, size.width, size.height, viewportKey]);
      if (poseKey === lastPoseKey.current) return;
      const samePhoto = look.current?.id === preview.id && motion.current.inPhotoView;
      const resizing = samePhoto && shotKey === lastShotKey.current;
      if (!canAdjustPhotoView || !look.current || look.current.id !== preview.id || look.current.sourceHeading !== preview.heading || look.current.sourcePitch !== preview.pitch) {
        look.current = { id: preview.id, sourceHeading: preview.heading, sourcePitch: preview.pitch, heading: preview.heading, pitch: preview.pitch };
      }
      lastPoseKey.current = poseKey;
      lastShotKey.current = shotKey;
      if (!resizing) { positionChanged.current = false; heightChanged.current = false; }
      if (!motion.current.inPhotoView && !motion.current.moving) {
        // Flush residual orbit momentum before saving the view to return to.
        stopOrbitMomentum(camera, control);
      }
      control.enabled = false;
      const pose = photoCameraPose({ ...preview, ...look.current }, preview.position.height, size.width / Math.max(1, size.height), visibleViewport);
      if (resizing && smoothPhotoFraming) motion.current.enter(camera, control.target, pose, reducedMotion);
      else if (resizing) motion.current.reframe(camera, pose);
      else motion.current.enter(camera, control.target, pose, reducedMotion || (samePhoto && !motion.current.moving));
    } else if (motion.current.inPhotoView) {
      look.current = null; lastPoseKey.current = ''; lastShotKey.current = '';
      control.enabled = false;
      motion.current.leave(camera, control.target, reducedMotion);
    }
    onMoving(motion.current.photoTransition && motion.current.moving); invalidate();
  }, [preview?.id, preview?.position.x, preview?.position.z, preview?.position.height, preview?.heading, preview?.pitch,
    preview?.width, preview?.height, preview?.metadata?.focalLength35Mm, preview?.metadata?.focalLengthMm,
    preview?.view?.focalLength35Mm, preview?.view?.cropFactor, canAdjustPhotoView, smoothPhotoFraming, size.width, size.height, viewportKey, camera, invalidate, onMoving]);

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
      move: (forward, right, up) => {
        const yaw = look.current!.heading * Math.PI / 180;
        const range = live.current.photoHeightRange;
        const vertical = up && range ? THREE.MathUtils.clamp(camera.position.y + up, range.min, range.max) - camera.position.y : 0;
        const movement = new THREE.Vector3(Math.sin(yaw) * forward + Math.cos(yaw) * right, vertical,
          -Math.cos(yaw) * forward + Math.sin(yaw) * right);
        camera.position.add(movement); control.target.add(movement);
        camera.updateMatrixWorld(); positionChanged.current = true; heightChanged.current ||= !!vertical; invalidate();
      },
      commit: orientation => {
        const adjustment: PhotoViewAdjustment = positionChanged.current ? { ...orientation, position: { x: camera.position.x, z: camera.position.z, ...(heightChanged.current ? { height: camera.position.y } : {}) } } : orientation;
        positionChanged.current = false; heightChanged.current = false;
        live.current.onPhotoOrientation?.(adjustment);
      }
    }) : undefined;
    return () => { unbind?.(); setEvents({ enabled: eventsEnabled }); };
  }, [preview?.id, canAdjustPhotoView, camera, gl, get, setEvents, invalidate]);

  // Match the upright pitch limits used by both gestures and automatic framing.
  // A separate, narrower orbit limit would correct the final animation pose.
  return <OrbitControls ref={controls} makeDefault enableZoom={false} enableDamping dampingFactor={.08} minPolarAngle={.01} maxPolarAngle={Math.PI - .01} target={[0, 0, 0]} />;
}
