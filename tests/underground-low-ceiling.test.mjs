import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { undergroundLayout, undergroundCeilingSections } from '../src/underground-geometry.ts';
import { undergroundDetailGeometry } from '../src/underground-details.ts';
import { undergroundCameraInside, undergroundVolume } from '../src/underground-mesh.ts';
import { pointOnStairTread } from '../src/structure-geometry.ts';

const campus = JSON.parse(fs.readFileSync(new URL('../public/data/campus.json', import.meta.url)));
const layout = undergroundLayout(campus.features), area = layout.areas.get('local/underground-corridor');
const sections = undergroundCeilingSections(area.feature, area.footprints, area.openings, area.connections);
const material = () => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const mesh = geometry => { const object = new THREE.Mesh(geometry, material()); object.updateMatrixWorld(); return object; };
const floor = area.feature.height, [from, turn, hallEnd] = area.feature.points;
const along = (a, b) => { const length = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / length, (b[1] - a[1]) / length]; };
const at = (a, b, t, offset = 0) => { const axis = along(a, b); return [a[0] + (b[0] - a[0]) * t - axis[1] * offset, a[1] + (b[1] - a[1]) * t + axis[0] * offset]; };
const polygons = shapes => shapes.map(shape => [shape.outer, ...shape.holes]);
const ray = (point, y, direction, length, objects) => new THREE.Raycaster(new THREE.Vector3(point[0], y, point[1]), direction, 0, length).intersectObjects(objects);

test('only the marked right corridor leg has a door-height roof, with the original full-height floor plan retained', () => {
  assert.deepEqual(area.feature.ceilingSegments, [{ edge: 1, height: 2.82 }]);
  assert.deepEqual(sections.map(section => section.height).sort(), [2.82, 3.2, 3.84, 6.4]);
  assert.deepEqual(polygonClipping.union(...sections.flatMap((a,i)=>sections.slice(i+1).map(b=>polygonClipping.intersection(polygons(a.footprints),polygons(b.footprints))))), []);
  assert.deepEqual(polygonClipping.xor(polygons(area.footprints), polygonClipping.union(...sections.map(section => polygons(section.footprints)))), []);
  const low = sections.find(section => section.height === 2.82);
  assert.ok(low.footprints.some(shape => pointOnStairTread(at(turn, hallEnd, .5), shape.outer)));
  assert.ok(!low.footprints.some(shape => pointOnStairTread(at(from, turn, .5), shape.outer)), 'The bottom long leg keeps its original height');
  assert.ok(!low.footprints.some(shape => pointOnStairTread(at(...area.feature.branches[0], .5), shape.outer)), 'The left side branch keeps its original height');
});

test('actual ceiling and sidewalls are lowered all the way to the badminton door while the other legs stay at full height', () => {
  const model = undergroundDetailGeometry(area.feature, area.footprints, area.openings, area.connections), roof = mesh(model.ceiling), walls = mesh(model.walls);
  try {
    for (const t of [.1, .25, .5, .75, .98]) for (const offset of [-1.5, 0, 1.5]) {
      const point = at(turn, hallEnd, t, offset), hits = ray(point, floor + 1.6, new THREE.Vector3(0, 1, 0), 8, [roof]);
      assert.ok(hits.length, 'The marked leg has a real opaque roof');
      assert.ok(Math.abs(hits[0].point.y - floor - 2.7) < 1e-5, 'Its lower ceiling face aligns with the original 2.7 m door');
    }
    for (const route of [[from, turn], area.feature.branches[0]]) for (const t of [.25, .5, .75]) {
      const hits = ray(at(...route, t), floor + 1.6, new THREE.Vector3(0, 1, 0), 8, [roof]);
      assert.ok(hits.length);
      assert.ok(Math.abs(hits[0].point.y - floor - (area.feature.wallHeight - .12)) < 1e-5);
    }
    const axis = along(turn, hallEnd), normal = new THREE.Vector3(-axis[1], 0, axis[0]), point = at(turn, hallEnd, .5);
    for (const sign of [-1, 1]) {
      assert.ok(ray(point, floor + 1.6, normal.clone().multiplyScalar(sign), 3, [walls]).length, 'Both lowered sidewalls still enclose the passage');
      assert.equal(ray(point, floor + 3, normal.clone().multiplyScalar(sign), 3, [walls]).length, 0, 'The low leg no longer has a tall wall above its ceiling');
    }
  } finally { Object.values(model).forEach(geometry => geometry.dispose()); roof.material.dispose(); walls.material.dispose(); }
});

test('the lower section leaves its original badminton door and the internal turn open below the ceiling', () => {
  const hall = layout.areas.get('local/underground-badminton'), corridorModel = undergroundDetailGeometry(area.feature, area.footprints, area.openings, area.connections), hallModel = undergroundDetailGeometry(hall.feature, hall.footprints, hall.openings);
  const objects = [mesh(corridorModel.walls), mesh(corridorModel.ceiling), mesh(hallModel.walls)];
  const door = hall.openings.toSorted((a, b) => Math.hypot(...a[0].map((n, i) => n - hallEnd[i])) - Math.hypot(...b[0].map((n, i) => n - hallEnd[i])))[0];
  assert.equal(door.height, 2.7);
  const center = door[0].map((n, i) => (n + door[1][i]) / 2), normal = new THREE.Vector3(door[1][1] - door[0][1], 0, door[0][0] - door[1][0]).normalize();
  const volumes = sections.flatMap(section => section.footprints.map(shape => {
    const object = mesh(undergroundVolume(shape, section.height, section.openings, true)); object.rotation.x = -Math.PI / 2; object.position.y = floor; object.updateMatrixWorld(); return object;
  }));
  try {
    for (const height of [1.6, 2.6]) for (const sign of [-1, 1]) {
      const start = new THREE.Vector3(center[0], floor + height, center[1]).addScaledVector(normal, -.15 * sign);
      assert.equal(new THREE.Raycaster(start, normal.clone().multiplyScalar(sign), 0, .3).intersectObjects(objects).length, 0, 'The full original door opening stays clear');
    }
    const low = sections.find(section => section.height === 2.82), seam = low.openings.at(-1), middle = seam[0].map((n, i) => (n + seam[1][i]) / 2);
    const across = new THREE.Vector3(seam[1][1] - seam[0][1], 0, seam[0][0] - seam[1][0]).normalize();
    for (const height of [1.6, 2.6]) {
      const start = new THREE.Vector3(middle[0], floor + height, middle[1]).addScaledVector(across, -.15);
      assert.equal(new THREE.Raycaster(start, across, 0, .3).intersectObjects(volumes).length, 0, 'The physical turn has no internal end cap');
    }
    const spaces = sections.map(section => ({floor,height:section.height,footprints:section.footprints})), point = at(turn, hallEnd, .5);
    assert.ok(undergroundCameraInside({x:point[0],y:floor+1.6,z:point[1]}, {floor,height:6.4,footprints:area.footprints,sections:spaces}));
    assert.equal(undergroundCameraInside({x:point[0],y:floor+3,z:point[1]}, {floor,height:6.4,footprints:area.footprints,sections:spaces}), false, 'The renderer recognizes a camera above the local low roof');
  } finally {
    [...Object.values(corridorModel), ...Object.values(hallModel)].forEach(geometry => geometry.dispose());
    objects.forEach(object => object.material.dispose()); volumes.forEach(object => { object.geometry.dispose(); object.material.dispose(); });
  }
});

test('suspended fittings follow the low roof rather than floating above it, and the remaining sections and stair guard stay unchanged', () => {
  const model = undergroundDetailGeometry(area.feature, area.footprints, area.openings, area.connections), baseline = undergroundDetailGeometry({...area.feature,ceilingSegments:[]}, area.footprints, area.openings, area.connections);
  const low = sections.find(section => section.height === 2.82).footprints[0];
  const boundaryDistance = point => Math.min(...low.outer.slice(1).map((b, i) => {
    const a = low.outer[i], dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dz)/(dx*dx+dz*dz)));
    return Math.hypot(point[0]-a[0]-dx*t,point[1]-a[1]-dz*t);
  }));
  try {
    for (const kind of ['lights','metal','pipes']) {
      const vertices = model[kind].attributes.position;
      for (let i=0;i<vertices.count;i++) {
        const point = [vertices.getX(i),vertices.getZ(i)];
        if (pointOnStairTread(point,low.outer) && boundaryDistance(point) > .2)
          assert.ok(vertices.getY(i) < floor + (kind === 'metal' ? 2.78 : 2.7) + 1e-5, 'Lights and pipes stay below the ceiling; beams remain beneath its upper slab face');
      }
    }
    assert.deepEqual([...model.rails.attributes.position.array], [...baseline.rails.attributes.position.array], 'The metal exit railing and its height are unaffected');
  } finally { [...Object.values(model),...Object.values(baseline)].forEach(geometry => geometry.dispose()); }
});
