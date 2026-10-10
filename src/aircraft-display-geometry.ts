import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AircraftDisplayModel } from './types';

// Local +Z is the nose. The three low wheels touch Y=0.
export function aircraftDisplayGeometry({ length: l, span: s, totalHeight: h }: AircraftDisplayModel) {
  const body: THREE.BufferGeometry[] = [], dark: THREE.BufferGeometry[] = [], gear: THREE.BufferGeometry[] = [];
  const add = (parts: THREE.BufferGeometry[], source: THREE.BufferGeometry, position: [number, number, number] = [0, 0, 0]) => {
    source.translate(...position);
    const geometry = source.index ? source.toNonIndexed() : source;
    if (geometry !== source) source.dispose();
    parts.push(geometry);
  };
  const plate = (points: [number, number][], thickness: number, vertical = false) => {
    const shape = new THREE.Shape();
    points.forEach(([a, b], i) => i ? shape.lineTo(a, b) : shape.moveTo(a, b));
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
    if (vertical) { geometry.rotateY(Math.PI / 2); geometry.translate(-thickness / 2, 0, 0); }
    else { geometry.rotateX(-Math.PI / 2); geometry.translate(0, h * .345 - thickness / 2, 0); }
    return geometry;
  };

  const profile = [[.10 * h, -.47 * l], [.14 * h, -.38 * l], [.15 * h, .05 * l],
    [.125 * h, .23 * l], [.04 * h, .40 * l], [0, .50 * l]].map(([r, z]) => new THREE.Vector2(r, z));
  const fuselage = new THREE.LatheGeometry(profile, 16); fuselage.rotateX(Math.PI / 2);
  add(body, fuselage, [0, h * .36, 0]);

  // A swept delta wing and a smaller tailplane retain the photographed jet silhouette.
  add(body, plate([[0, -.18 * l], [s / 2, .21 * l], [.40 * s, .26 * l], [0, .30 * l],
    [-.40 * s, .26 * l], [-s / 2, .21 * l]], .025 * h));
  const tailplane = plate([[0, .30 * l], [.22 * s, .42 * l], [.16 * s, .50 * l],
    [0, .46 * l], [-.16 * s, .50 * l], [-.22 * s, .42 * l]], .020 * h);
  tailplane.translate(0, h * .06, 0); add(body, tailplane);
  add(body, plate([[.24 * l, .43 * h], [.34 * l, .96 * h], [.42 * l, h], [.47 * l, .45 * h]], .04 * h, true));

  const canopy = new THREE.SphereGeometry(1, 12, 6); canopy.scale(h * .105, h * .07, l * .115);
  add(dark, canopy, [0, h * .51, l * .18]);
  const exhaust = new THREE.CylinderGeometry(h * .085, h * .085, l * .012, 12);
  exhaust.rotateX(Math.PI / 2); add(dark, exhaust, [0, h * .36, -l * .475]);

  for (const [x, z] of [[0, .28 * l], [-.10 * s, -.15 * l], [.10 * s, -.15 * l]]) {
    add(gear, new THREE.CylinderGeometry(h * .014, h * .014, h * .29, 6), [x, h * .205, z]);
    const wheel = new THREE.CylinderGeometry(h * .06, h * .06, h * .065, 12);
    wheel.rotateZ(Math.PI / 2); add(dark, wheel, [x, h * .06, z]);
  }
  const merged = (parts: THREE.BufferGeometry[]) => {
    const geometry = mergeGeometries(parts)!;
    parts.forEach(part => part.dispose());
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    return geometry;
  };
  return { body: merged(body), dark: merged(dark), gear: merged(gear) };
}
