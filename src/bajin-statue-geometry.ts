import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BaJinStatueModel } from './types';

export function bajinStatueGeometry(model: BaJinStatueModel) {
  const yuanLongping = model.variant === 'yuanLongping';
  const steps: THREE.BufferGeometry[] = [], pedestal: THREE.BufferGeometry[] = [], bust: THREE.BufferGeometry[] = [];
  const add = (parts: THREE.BufferGeometry[], source: THREE.BufferGeometry, position: [number, number, number], color?: string) => {
    const geometry = source.index ? source.toNonIndexed() : source;
    if (geometry !== source) source.dispose();
    geometry.translate(...position);
    if (color) {
      const c = new THREE.Color(color), colors = new Float32Array(geometry.getAttribute('position').count * 3);
      for (let i = 0; i < colors.length; i += 3) c.toArray(colors, i);
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    parts.push(geometry);
  };
  const box = (parts: THREE.BufferGeometry[], x: number, y: number, z: number, bottom: number) =>
    add(parts, new THREE.BoxGeometry(x, y, z), [0, bottom + y / 2, 0]);
  const sphere = (position: [number, number, number], scale: [number, number, number], color = '#7d8881', phiStart = 0, phiLength = Math.PI * 2, thetaLength = Math.PI) => {
    const geometry = new THREE.SphereGeometry(1, 12, 8, phiStart, phiLength, 0, thetaLength);
    geometry.scale(...scale); add(bust, geometry, position, color);
  };
  const rod = (from: [number, number, number], to: [number, number, number], radius: number, color: string) => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), direction = b.clone().sub(a);
    const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), 6);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
    add(bust, geometry, a.add(b).multiplyScalar(.5).toArray(), color);
  };
  if (yuanLongping) {
    // This portrait stands on a narrow stone column, without Ba Jin's broad stair podium.
    box(steps, model.width, .025 * model.totalHeight, model.depth, 0);
    box(pedestal, model.width / model.totalHeight * .84, .58, model.depth / model.totalHeight * .84, .025);
    box(pedestal, model.width / model.totalHeight * .90, .045, model.depth / model.totalHeight * .90, .605);
    const shoulder = Math.min(.15, model.width / model.totalHeight * .48);
    const outline = new THREE.Shape();
    outline.moveTo(-shoulder * .7, .645); outline.lineTo(-shoulder, .79);
    outline.lineTo(-shoulder * .80, .837); outline.lineTo(-.047, .863);
    outline.lineTo(-.032, .883); outline.lineTo(.032, .883); outline.lineTo(.047, .863);
    outline.lineTo(shoulder * .80, .837); outline.lineTo(shoulder, .79); outline.lineTo(shoulder * .7, .645);
    outline.closePath();
    add(bust, new THREE.ExtrudeGeometry(outline, { depth: .12, bevelEnabled: false }), [0, 0, -.06], '#46594b');
    rod([0, .851, 0], [0, .909, 0], .032, '#57665a');
    sphere([0, .933, .006], [.052, .067, .051], '#5b695d');
    sphere([0, .892, .024], [.028, .022, .034], '#5b695d');
    // Short hair follows the crown and sides; this portrait has no spectacles.
    sphere([0, .938, .003], [.054, .062, .053], '#34473a', 0, Math.PI * 2, Math.PI * .47);
    for (const side of [-1, 1]) {
      sphere([side * .053, .926, .009], [.009, .019, .013], '#57665a');
      rod([side * .037, .854, .061], [side * .017, .77, .062], .004, '#354c3d');
    }
    sphere([0, .927, .056], [.010, .018, .015], '#57665a');
  } else {
    // The step footprint is independent of the modest bust and pedestal height.
    for (let i = 0; i < 3; i++) box(steps, model.width * (1 - .165 * i), .04 * model.totalHeight,
      model.depth * (1 - .165 * i), .04 * i * model.totalHeight);
    box(pedestal, .33, .025, .30, .12);
    box(pedestal, .27, .43, .255, .145);
    box(pedestal, .37, .15, .33, .575);

    const mount = new THREE.CylinderGeometry(.075 * Math.SQRT2, .135 * Math.SQRT2, .04, 4);
    mount.rotateY(Math.PI / 4); mount.scale(1, 1, .9);
    add(bust, mount, [0, .745, 0], '#89938c');

    // A cropped jacket silhouette keeps the shoulders flat on the square stone cap.
    const outline = new THREE.Shape();
    outline.moveTo(-.13, .75); outline.lineTo(-.15, .80); outline.lineTo(-.12, .84);
    outline.lineTo(-.058, .861); outline.lineTo(-.035, .88); outline.lineTo(.035, .88);
    outline.lineTo(.058, .861); outline.lineTo(.12, .84); outline.lineTo(.15, .80); outline.lineTo(.13, .75);
    outline.closePath();
    add(bust, new THREE.ExtrudeGeometry(outline, { depth: .10, bevelEnabled: false }), [0, 0, -.05], '#718078');
    rod([0, .86, 0], [0, .91, 0], .031, '#849088');
    sphere([0, .933, .008], [.050, .067, .048], '#89938c');
    sphere([0, .892, .017], [.027, .022, .035], '#89938c');
    // Receding hair wraps the back and sides rather than enlarging the head.
    sphere([0, .934, .004], [.053, .066, .051], '#5e6d64', Math.PI, Math.PI, Math.PI * .69);
    for (const side of [-1, 1]) {
      sphere([side * .050, .925, .006], [.009, .019, .012], '#849088');
      const glasses = new THREE.TorusGeometry(.018, .0023, 4, 12);
      glasses.scale(1, .68, 1); add(bust, glasses, [side * .021, .941, .052], '#4c5e53');
      rod([side * .039, .941, .049], [side * .050, .939, .010], .0023, '#4c5e53');
      rod([side * .025, .861, .045], [0, .81, .052], .0034, '#617167');
    }
    rod([-.004, .941, .052], [.004, .941, .052], .0022, '#4c5e53');
    sphere([0, .926, .055], [.009, .018, .014], '#849088');
  }

  const merged = (parts: THREE.BufferGeometry[], scale = 1) => {
    const geometry = mergeGeometries(parts)!;
    parts.forEach(part => part.dispose());
    geometry.scale(scale, scale, scale); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    return geometry;
  };
  return { steps: merged(steps), pedestal: merged(pedestal, model.totalHeight), bust: merged(bust, model.totalHeight) };
}
