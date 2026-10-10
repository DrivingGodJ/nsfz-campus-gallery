import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GYM_ID, architectureBatch, classroomGlazingGeometry, gymArchitecture, teachingRailGeometry, teachingWindowGeometry } from '../src/architecture-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';
import { cafeteriaLowerProfile, cafeteriaLowerWindowsConfig, cafeteriaUpperWindows } from '../src/facade-geometry.ts';
import { GYM_WALL, gymFrame, gymStairLayout } from '../src/gym-interior.ts';
import { bridgeHeight } from '../src/structure-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
const teaching = campus.buildings.find(b => b.id === 'way/855459420');
const gym = campus.buildings.find(b => b.id === GYM_ID);
const bridge = campus.features.find(f => f.id === 'local/footbridge');
const vector = p => new THREE.Vector3(p[0], 0, p[1]);
const mesh = (geometry, extrusion = false) => {
  const result = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  if (extrusion) { result.rotation.x = -Math.PI / 2; result.position.y = .12; }
  result.updateMatrixWorld(); return result;
};
const dispose = model => Object.values(model).forEach(geometry => geometry.dispose());
const entryLevel = (building, floorHeight) => bridgeHeight(bridge, [building], {
  [building.id]: { name: building.name, floors: 4, floorHeight }
});

test('cafeteria floor cutaways merge real lower windows with empty upper batches without losing geometry or photo masks', () => {
  const cafeteria = campus.buildings.find(building => building.facade?.type === 'cafeteria');
  const original = JSON.stringify([cafeteria, site]), info = buildingLevels(cafeteria, site.buildingOverrides[cafeteria.id]);
  for (const floor of [1, 2, undefined]) for (const reversed of [false, true]) {
    const visibleHeight = floor ? floor * info.floorHeight : info.height, boundary = Math.min(visibleHeight, 2 * info.floorHeight);
    const shape = cafeteriaLowerProfile(cafeteria).shape, config = cafeteriaLowerWindowsConfig(cafeteria, info.floorHeight);
    const lower = teachingWindowGeometry({ ...cafeteria, ...shape, classroomWindows: config }, [{ ...info.sections[0], ...shape, height: boundary }], info.floorHeight);
    const upper = classroomGlazingGeometry(cafeteriaUpperWindows(cafeteria, Math.max(0, visibleHeight - boundary), info.floorHeight), cafeteria.classroomWindows);
    for (const geometry of Object.values(upper)) geometry.translate(0, boundary, 0);
    for (const kind of ['glass', 'frames']) {
      assert.ok(lower[kind].getAttribute('position').count > 0);
      assert.equal(upper[kind].getAttribute('position').count === 0, floor !== undefined, 'The real first- and second-floor paths omit all upper glazing');
      const parts = reversed ? [upper[kind], lower[kind]] : [lower[kind], upper[kind]];
      const occupied = parts.filter(part => part.getAttribute('position').count);
      const positions = occupied.flatMap(part => Array.from(part.getAttribute('position').array));
      const normals = occupied.flatMap(part => Array.from(part.getAttribute('normal').array));
      let disposed = 0;
      parts.forEach(part => part.addEventListener('dispose', () => disposed++));
      const merged = architectureBatch(parts, false);
      try {
        assert.deepEqual(Array.from(merged.getAttribute('position').array), positions, 'Empty batches never remove occupied panes or frames');
        assert.deepEqual(Array.from(merged.getAttribute('normal').array), normals, 'The occupied geometry keeps its lighting normals');
        assert.ok(positions.every(Number.isFinite));
        assert.equal(merged.userData.photoOcclusionMask.length, positions.length / 9);
        assert.ok(merged.userData.photoOcclusionMask.every(value => value === 0));
        assert.equal(disposed, parts.length, 'Both occupied and empty inputs are released');
      } finally { merged.dispose(); }
    }
  }
  const empty = () => new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  const parts = [empty(), empty()];
  let disposed = 0;
  parts.forEach(part => part.addEventListener('dispose', () => disposed++));
  const merged = architectureBatch(parts, false);
  try {
    assert.equal(merged.getAttribute('position').count, 0);
    assert.equal(merged.userData.photoOcclusionMask.length, 0);
    assert.equal(disposed, parts.length);
  } finally { merged.dispose(); }
  assert.equal(JSON.stringify([cafeteria, site]), original, 'Floor selection never alters saved model or photo data');
});

test('walkway guard rails follow both courtyard rings, respect floor cutaways, and never hide photos', () => {
  const info = buildingLevels(teaching, site.buildingOverrides[teaching.id]);
  for (const floor of [undefined, 1, 3]) {
    const geometry = teachingRailGeometry(teaching, info.sections, info.floorHeight, floor && floor * info.floorHeight);
    const vertices = geometry.getAttribute('position');
    assert.equal(geometry.userData.photoOcclusionMask.length, vertices.count / 3);
    assert.ok(geometry.userData.photoOcclusionMask.every(value => value === 0));
    if (floor === 1) assert.equal(vertices.count, 0, 'No floating upper-floor rails remain when only the ground floor is shown');
    else {
      geometry.computeBoundingBox();
      assert.ok(geometry.boundingBox.max.y < (floor || 6) * info.floorHeight, 'Rails stay below the selected ceiling');
      for (const section of info.sections) {
        const ring = section.holes[0], middle = ring.slice(0, -1).reduce((s, p) => s.add(vector(p)), new THREE.Vector3()).divideScalar(ring.length - 1);
        for (let edge = 0; edge < ring.length - 1; edge++) {
          const target = vector(ring[edge]).lerp(vector(ring[edge + 1]), .4), direction = target.clone().sub(middle).normalize();
          const start = target.clone().addScaledVector(direction, -1); start.y = .12 + info.floorHeight + .25 + 1.05;
          const hit = new THREE.Raycaster(start, direction, 0, 1.5).intersectObject(mesh(geometry))[0];
          assert.ok(hit, 'Every side of both atriums has an upper-floor guard rail');
          assert.equal(geometry.userData.photoOcclusionMask[hit.faceIndex], 0);
        }
      }
      const corridor = teaching.floorCorridors.find(c => c.partId === 'main' && c.edge === 19);
      assert.equal(corridor.railEdges[0].length, 3, 'The unchanged long guard turns along the exposed east return');
      const [a, b] = corridor.railEdges[0], along = vector(b).sub(vector(a)).normalize();
      const normal = new THREE.Vector3(-along.z, 0, along.x), guard = mesh(geometry);
      const storeys = Math.min(info.sections.find(s => s.id === 'main').floors, floor || Infinity);
      for (let level = 0; level < storeys; level++) for (const t of [.2, .5, .8]) {
        const origin = vector(a).lerp(vector(b), t).addScaledVector(normal, -.4);
        origin.y = .12 + level * info.floorHeight + .25 + 1.05;
        assert.equal(new THREE.Raycaster(origin, normal, 0, .8).intersectObject(guard).length > 0, level > 0,
          'The side return is guarded on every upper floor and stays open at ground level');
      }
      guard.material.dispose();
    }
    assert.ok(vertices.count / 3 < 14000, 'Rail detail stays modest even with every floor visible');
    geometry.dispose();
  }
});

test('gym roof has a higher symmetric arch while floor and eave levels remain calibrated', () => {
  for (const override of [site.buildingOverrides[gym.id], { floors: 5, floorHeight: 4.2 }]) {
    const info = buildingLevels(gym, override), model = gymArchitecture(gym, info.height, info.floorHeight, bridge);
    const roof = mesh(model.roof), [a, b] = [gym.outer[0], gym.outer[3]], across = vector(gym.outer[1]).sub(vector(a)).multiplyScalar(.5);
    const heights = [.04, .25, .5, .75, .96].map(t => {
      const point = vector(a).lerp(vector(b), t).add(across); point.y = 100;
      const hit = new THREE.Raycaster(point, new THREE.Vector3(0, -1, 0)).intersectObject(roof)[0];
      assert.ok(hit, 'Roof faces are outward-facing and cover the hall'); return hit.point.y;
    });
    assert.ok(heights[0] < heights[1] && heights[1] < heights[2]);
    assert.ok(Math.abs(heights[0] - heights[4]) < 1e-4 && Math.abs(heights[1] - heights[3]) < 1e-4);
    assert.ok(Math.abs(heights[2] - (info.height + 1.2 + .12)) < 1e-4, 'Only the arch rises by 1.2 metres above the calibrated building height');
    const point = vector(a).lerp(vector(b), .5).add(across); point.y = 2;
    assert.ok(new THREE.Raycaster(point, new THREE.Vector3(0, 1, 0)).intersectObject(roof).length, 'Underside is visible from inside');
    assert.ok(Object.values(model).reduce((n, g) => n + g.getAttribute('position').count / 3, 0) < 11000, 'Facade, court, viewing gallery and repeated stairs remain a modest merged model');
    dispose(model);
  }
});

test('gym bridge enters a real doorway while the adjacent wall and ground remain intact', () => {
  const info = buildingLevels(gym, site.buildingOverrides[gym.id]), model = gymArchitecture(gym, info.height, info.floorHeight, bridge);
  const body = mesh(model.body, true), connection = bridge.connections.find(c => c.type === 'deck' && c.buildingId === gym.id);
  body.position.y += info.baseElevation; body.updateMatrixWorld();
  const [a, b] = connection.points, direction = vector(b).sub(vector(a)).normalize();
  const start = vector(a); start.y = entryLevel(gym, info.floorHeight) + 1.6;
  const entryY = entryLevel(gym, info.floorHeight);
  for (const eyeHeight of [.3, 1.6, info.floorHeight - .3]) {
    const eye = start.clone(); eye.y = entryY + eyeHeight;
    assert.equal(new THREE.Raycaster(eye, direction, 0, 7).intersectObject(body).length, 0, 'The half-floor doorway is open across the regular floor boundary');
    const glazing = mesh(model.glass); glazing.position.y = info.baseElevation; glazing.material.side = THREE.DoubleSide; glazing.updateMatrixWorld();
    assert.equal(new THREE.Raycaster(eye, direction, 0, 1).intersectObject(glazing).length, 0, 'No glass pane closes the bridge doorway');
  }
  const beside = start.clone().add(new THREE.Vector3(direction.z, 0, -direction.x).multiplyScalar(3));
  assert.ok(new THREE.Raycaster(beside, direction, 0, 7).intersectObject(body).length, 'The entrance does not erase the neighboring facade');
  const center = vector(gym.center); center.y = info.baseElevation + 2;
  assert.ok(new THREE.Raycaster(center, new THREE.Vector3(0, -1, 0)).intersectObject(body).length, 'The hall retains its ground slab');
  dispose(model);
});

test('the half-floor bridge entrance has 2.2 metres of walking headroom below the next half-floor slab', () => {
  const original = JSON.stringify([gym, bridge]), info = buildingLevels(gym, site.buildingOverrides[gym.id]);
  const model = gymArchitecture(gym, info.height, info.floorHeight, bridge), frame = gymFrame(gym);
  const connection = bridge.connections.find(c => c.type === 'deck' && c.buildingId === gym.id);
  const u = frame.local(connection.points[0])[0], base = entryLevel(gym, info.floorHeight) - info.baseElevation;
  const objects = ['body', 'stairs', 'glass', 'frame', 'stairGlass', 'stairRails'].map(key => {
    const object = mesh(model[key], key === 'body'); object.material.side = THREE.DoubleSide; return object;
  });
  try {
    for (const offset of [-.8, 0, .8]) for (const eyeHeight of [.3, 1.6, 1.7, 1.79, 2.2]) {
      const p = frame.at(u + offset, -1);
      const ray = new THREE.Raycaster(new THREE.Vector3(p[0], base + eyeHeight, p[1]), vector(frame.across), 0, 4);
      assert.equal(ray.intersectObjects(objects).length, 0, 'The entrance stays clear throughout 2.2 metres of walking headroom');
    }
    const stairs = objects[1], p = frame.at(u, 3);
    const floor = new THREE.Raycaster(new THREE.Vector3(p[0], base + .5, p[1]), new THREE.Vector3(0, -1, 0), 0, 1).intersectObject(stairs)[0];
    assert.ok(floor && Math.abs(floor.point.y - base) < 1e-4, 'The entrance keeps its half-floor platform at the existing bridge level');
    assert.equal(JSON.stringify([gym, bridge]), original);
  } finally { objects.forEach(object => object.material.dispose()); dispose(model); }
});

test('gym front has two tall glass towers, a high curved window row, and three centered ground entrances', () => {
  const info = buildingLevels(gym, site.buildingOverrides[gym.id]), model = gymArchitecture(gym, info.height, info.floorHeight, bridge);
  const frame = gymFrame(gym), body = mesh(model.body, true), glass = mesh(model.glass);
  glass.material.side = THREE.DoubleSide;
  const outside = (u, height, target) => {
    const p = frame.at(u, -1), direction = vector(frame.across);
    return new THREE.Raycaster(new THREE.Vector3(p[0], .12 + height, p[1]), direction, 0, 1.5).intersectObject(target);
  };
  for (const u of [3, frame.length - 4.5]) for (const height of [6, 9]) {
    assert.equal(outside(u, height, body).length, 0, 'Tall glazing replaces the wall at both front ends');
    assert.ok(outside(u, height, glass).length, 'The opening contains a glass pane');
  }
  for (const height of [6, 9, 11]) assert.ok(outside(frame.length / 2, height, body).length, 'The large middle facade remains solid');
  for (const height of [12, 14.8]) {
    assert.equal(outside(frame.length / 2, height, body).length, 0, 'The high window row is open below the arched roof');
    assert.ok(outside(frame.length / 2, height, glass).length, 'Glazing follows the raised arch');
  }
  for (const offset of [-2.1, 0, 2.1]) {
    assert.equal(outside(frame.length / 2 + offset, 1.6, body).length, 0, 'All three ground doors are open in the shell');
    assert.ok(outside(frame.length / 2 + offset, 1.6, glass).length, 'Doors are recessed glass panels');
  }
  assert.ok(outside(frame.length / 2 + 1.05, 1.6, body).length, 'Concrete piers separate neighboring doors');
  assert.ok(outside(frame.length / 2, 3.15, body).length, 'A solid lintel remains over the entrance');
  dispose(model);
});

test('gym lower-floor cutaways retain lower windows and clip interior detail without mutating source data', () => {
  const original = JSON.stringify([gym, site, bridge]);
  const info = buildingLevels(gym, site.buildingOverrides[gym.id]);
  for (const floor of [1, 2]) {
    const model = gymArchitecture(gym, info.height, info.floorHeight, bridge, floor * info.floorHeight);
    assert.equal(model.roof.getAttribute('position').count, 0);
    for (const key of ['glass', 'frame', 'stairs', 'stairRails', 'stairGlass']) {
      assert.ok(model[key].getAttribute('position').count > 0, `${key} remains below the selected ceiling`);
      model[key].computeBoundingBox();
      assert.ok(model[key].boundingBox.max.y <= .12 + floor * info.floorHeight + 1e-5, `${key} has no floating parts above the selected ceiling`);
    }
    model.body.computeBoundingBox();
    assert.ok(model.body.boundingBox.max.z <= floor * info.floorHeight + 1e-5, 'No upper shell remains above the selected floor');
    dispose(model);
  }
  assert.equal(JSON.stringify([gym, site, bridge]), original);
});

test('gym stair bay has real side and end window openings, with solid piers and floor beams', () => {
  const info = buildingLevels(gym, site.buildingOverrides[gym.id]), model = gymArchitecture(gym, info.height, info.floorHeight, bridge);
  const body = mesh(model.body, true), frame = gymFrame(gym);
  const at = (u, v, y) => { const p = frame.at(u, v); return new THREE.Vector3(p[0], y + .12, p[1]); };
  const towardEnd = vector(frame.along), towardSide = vector(frame.across).negate();
  const bayWidth = (frame.width - 1.8 - 1.3) / 3;
  for (const floor of [0, 1, 2]) {
    const height = floor * info.floorHeight;
    for (let bay = 0; bay < 3; bay++) {
      const v = .9 + bay * (bayWidth + .65) + bayWidth / 2;
      assert.equal(new THREE.Raycaster(at(frame.length - 1, v, height + 1.2), towardEnd, 0, 2).intersectObject(body).length, 0, 'Glazing replaces the end wall rather than covering solid concrete');
      assert.ok(new THREE.Raycaster(at(frame.length - 1, v, height + .3), towardEnd, 0, 2).intersectObject(body).length, 'The low sill is solid');
      assert.ok(new THREE.Raycaster(at(frame.length - 1, v, height + info.floorHeight - .2), towardEnd, 0, 2).intersectObject(body).length, 'The floor beam is solid');
    }
    assert.ok(new THREE.Raycaster(at(frame.length - 1, .9 + bayWidth + .325, height + 1.2), towardEnd, 0, 2).intersectObject(body).length, 'Columns remain between wide window bays');
    assert.equal(new THREE.Raycaster(at(frame.length - 4, 1, height + 1.2), towardSide, 0, 2).intersectObject(body).length, 0, 'Adjacent bridge-side glazing opens around the corner');
  }
  const photo = site.photos.find(p => p.id === 'aa553764-213d-4716-b3ad-545c60589bf8');
  const heading = photo.heading * Math.PI / 180, direction = new THREE.Vector3(Math.sin(heading), 0, -Math.cos(heading));
  const eye = new THREE.Vector3(photo.position.x, .12 + 2 * info.floorHeight + 1.55, photo.position.z);
  assert.equal(new THREE.Raycaster(eye, direction, 0, 11).intersectObject(body).length, 0, 'The panorama looks through glazing from its saved position');
  dispose(model);
});

test('gym repeated return stairs rise step by step and meet the half-floor bridge platform', () => {
  const info = buildingLevels(gym, site.buildingOverrides[gym.id]), model = gymArchitecture(gym, info.height, info.floorHeight, bridge);
  const frame = gymFrame(gym), layout = gymStairLayout(frame), middle = (layout.u0 + layout.u1) / 2, stairs = mesh(model.stairs);
  const topAt = (u, v, above) => {
    const p = frame.at(u, v), hit = new THREE.Raycaster(new THREE.Vector3(p[0], .12 + above, p[1]), new THREE.Vector3(0, -1, 0), 0, 2).intersectObject(stairs)[0];
    assert.ok(hit, 'A real upward-facing tread or landing exists'); return hit.point.y - .12;
  };
  const entry = entryLevel(gym, info.floorHeight) - info.baseElevation - .12;
  for (let floor = 0; floor < info.floors - 1; floor++) {
    const bottom = floor ? floor * info.floorHeight : .16, half = floor ? (floor + .5) * info.floorHeight : entry, top = (floor + 1) * info.floorHeight;
    const lowerSteps = floor ? layout.steps : Math.ceil((half - bottom) / .18 - 1e-7);
    const upperSteps = floor ? layout.steps : Math.ceil((top - half) / .18 - 1e-7);
    for (let step = 0; step < lowerSteps; step++) {
      const t = (step + .5) / lowerSteps, y = bottom + (half - bottom) * (step + 1) / lowerSteps;
      assert.ok(Math.abs(topAt((middle + layout.u1) / 2, layout.near + (layout.far - layout.near) * t, y + .1) - y) < 1e-4, 'First flight climbs toward the side windows');
    }
    for (let step = 0; step < upperSteps; step++) {
      const t = (step + .5) / upperSteps, y = half + (top - half) * (step + 1) / upperSteps;
      assert.ok(Math.abs(topAt((layout.u0 + middle) / 2, layout.far + (layout.near - layout.far) * t, y + .1) - y) < 1e-4, 'Adjacent flight returns toward the full-floor landing');
    }
    assert.ok(Math.abs(topAt(middle, 3, half + .1) - half) < 1e-4);
    assert.ok(Math.abs(topAt(frame.length - GYM_WALL - 1, frame.width / 2, top + .1) - top) < 1e-4, 'The window-side landing has a complete floor');
  }
  assert.ok(Math.abs(topAt(middle, 3, entry + .1) - entry) < 1e-4, 'The first half landing meets the actual bridge height');
  for (const key of ['stairs', 'stairRails', 'stairGlass', 'glass', 'frame']) {
    assert.ok(model[key].userData.photoOcclusionMask.every(value => value === 0), `${key} does not hide interior-photo markers`);
  }
  dispose(model);
});
