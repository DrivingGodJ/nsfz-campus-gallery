import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { campusExteriorGeometry, libraryEntranceLayout, OFFICE_ID, LIBRARY_ID } from '../src/campus-exterior-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';
import { buildingGeometry } from '../src/building-geometry.ts';
import { officeCurvedFacade, officeCurvedWindows, officeWindowLayout } from '../src/office-windows.ts';
import { classroomGlazingGeometry } from '../src/architecture-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));

test('observed office and library details stay attached to their approved faces and respect cut floors', () => {
  for (const id of [OFFICE_ID, LIBRARY_ID]) {
    const building = campus.buildings.find(building => building.id === id), before = JSON.stringify(building), floors = id === LIBRARY_ID ? 5 : 4;
    const area = building.outer.slice(1).reduce((sum, p, i) => sum + building.outer[i][0] * p[1] - p[0] * building.outer[i][1], 0);
    for (const floorHeight of [3.6, 4.2]) for (const selectedFloor of [undefined, 1, 3, 4]) {
      const cutoff = selectedFloor === undefined ? undefined : selectedFloor * floorHeight;
      const model = campusExteriorGeometry(building, floors, floorHeight, cutoff);
      try {
        const curved = id === OFFICE_ID && officeCurvedFacade(building);
        const curvedWindows = curved ? officeCurvedWindows(building, Math.min(floors * floorHeight, cutoff ?? Infinity), floorHeight, floors) : [];
        assert.equal(model.glass.getAttribute('position').count > 0, curvedWindows.length > 0,
          'Only the observed curved office panes belong to this layer; the ordinary panes retain their shared layout');
        assert.equal(model.frame.getAttribute('position').count > 0, id === LIBRARY_ID, 'Library diagonal braces remain without duplicate office strip frames');
        const entrance = id === LIBRARY_ID ? libraryEntranceLayout(building, floorHeight) : undefined;
        for (const [kind, geometry] of Object.entries(model)) {
          const positions = geometry.getAttribute('position');
          for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
            assert.ok(Number.isFinite(x + y + z));
            assert.ok(y <= .12 + Math.min(cutoff ?? Infinity, (id === LIBRARY_ID ? 3 : floors) * floorHeight + (curved && cutoff === undefined ? .9 : 0)) + .001, 'No detail restores a removed storey; only the photographed office end wall rises above its roof');
            if (kind === 'canopyGlass' || kind === 'canopyFrame') {
              assert.ok(entrance, 'Only the library has this photographed entrance canopy');
              const dx = x - entrance.center[0], dz = z - entrance.center[1];
              const station = dx * entrance.along[0] + dz * entrance.along[1], projection = dx * entrance.outward[0] + dz * entrance.outward[1];
              assert.ok(Math.abs(station) <= entrance.width / 2 + .05 && projection >= .015 && projection <= entrance.depth + .05,
                'The canopy projects from its marked doorway rather than relaxing the facade attachment limit');
              assert.ok(y >= entrance.wallHeight - .7, 'Suspended canopy members cannot become ground columns');
              continue;
            }
            let distance = Infinity, outwardOffset = Infinity;
            for (let j = 1; j < building.outer.length; j++) {
              const [ax, az] = building.outer[j - 1], [bx, bz] = building.outer[j], dx = bx - ax, dz = bz - az;
              const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
              const candidate = Math.hypot(x - ax - t * dx, z - az - t * dz);
              if (candidate < distance) {
                distance = candidate;
                outwardOffset = (area > 0 ? 1 : -1) * ((x - ax) * dz - (z - az) * dx) / Math.hypot(dx, dz);
              }
            }
            assert.ok(distance < (curved ? .87 : .31), 'Panels remain on the original facade, including the photographed recessed office glazing');
            assert.ok(outwardOffset >= (curved ? -.84 : .019), 'The office window recess stays below 0.84 m; other panels sit outside their real wall');
          }
          assert.equal(geometry.userData.photoOcclusionMask.some(Boolean), false, 'Details do not add photograph occlusion layers');
        }
      } finally { Object.values(model).forEach(geometry => geometry.dispose()); }
    }
    assert.equal(JSON.stringify(building), before, 'Confirmed footprint and floor data are untouched');
  }
});

test('library entrance glass canopy projects outward above the south doorway without ground columns', () => {
  const building = campus.buildings.find(building => building.id === LIBRARY_ID), before = JSON.stringify(building);
  const a = building.outer[2], b = building.outer[3];
  for (const floorHeight of [3.6, 4.2]) {
    const entrance = libraryEntranceLayout(building, floorHeight);
    assert.ok(entrance.center.every((value, axis) => Math.abs(value - (a[axis] + (b[axis] - a[axis]) * .3)) < 1e-8), 'The canopy follows the revised mark toward the middle of the annex facade');
    for (const cutoff of [undefined, floorHeight, 2 * floorHeight]) {
      const model = campusExteriorGeometry(building, 5, floorHeight, cutoff);
      const glass = new THREE.Mesh(model.canopyGlass, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      glass.updateMatrixWorld();
      try {
        assert.equal(model.canopyGlass.getAttribute('position').count > 0, cutoff !== floorHeight, 'The first-floor cut omits roof glass above its ceiling');
        if (cutoff !== floorHeight) {
          const point = entrance.at(0, entrance.depth / 2, 30);
          const hit = new THREE.Raycaster(point, new THREE.Vector3(0, -1, 0)).intersectObject(glass)[0];
          assert.ok(hit && Math.abs(hit.point.y - (entrance.wallHeight - .1)) < 1e-4, 'The suspended glass roof slopes slightly toward its outer edge');
          const roof = model.canopyGlass.getAttribute('position');
          const outline = Array.from({ length: roof.count }, (_, i) => [roof.getX(i), roof.getZ(i)]);
          // Use the four actual corner positions rather than the six duplicated triangle vertices.
          const corners = [outline[0], outline[1], outline[2], outline[5], outline[0]];
          assert.deepEqual(polygonClipping.intersection([corners], [building.outer]), [], 'The rain cover extends outside the wall instead of lying over the room');
        }
        for (const geometry of [model.canopyGlass, model.canopyFrame]) {
          const positions = geometry.getAttribute('position');
          for (let i = 0; i < positions.count; i++) {
            assert.ok(positions.getY(i) >= entrance.wallHeight - .7, 'No support descends from the suspended canopy to the ground');
            assert.ok(positions.getY(i) <= .12 + (cutoff ?? Infinity) + .001, 'A floor cut cannot leave canopy members floating above its ceiling');
          }
        }
      } finally { glass.material.dispose(); Object.values(model).forEach(geometry => geometry.dispose()); }
    }
  }
  const other = campusExteriorGeometry(campus.buildings.find(building => building.id === OFFICE_ID), 4, 3.6);
  try { for (const kind of ['canopyGlass', 'canopyFrame']) assert.equal(other[kind].getAttribute('position').count, 0, 'Other buildings do not inherit the library canopy'); }
  finally { Object.values(other).forEach(geometry => geometry.dispose()); }
  assert.equal(JSON.stringify(building), before);
});

test('office curved top glazing and recessed lower band open the real body while retaining brick spandrels and existing front lights', () => {
  const saved = campus.buildings.find(building => building.id === OFFICE_ID), before = JSON.stringify(saved);
  const building = { ...saved, classroomWindows: { ...saved.classroomWindows, facadeLines: [...saved.classroomWindows.facadeLines, saved.outer.slice(0, 6)] } };
  const floorHeight = 3.6, height = 4 * floorHeight, windows = officeWindowLayout(building, height, floorHeight);
  const curved = windows.filter(window => window.curvedOffice), facade = officeCurvedFacade(building);
  assert.equal(curved.length, 10, 'The photo confirms two continuous storeys over five existing curve chords');
  assert.ok(officeWindowLayout(saved, height, floorHeight).filter(window => !window.curvedOffice).every(window =>
    windows.some(candidate => !candidate.curvedOffice && JSON.stringify(candidate) === JSON.stringify(window))), 'Previously calibrated flat faces retain every pane unchanged');
  for (const facadeLines of [[], [building.outer.slice(0, 5)]]) assert.equal(officeCurvedWindows({ ...building, classroomWindows: { ...building.classroomWindows, facadeLines } }, height, floorHeight).length, 0,
    'Partial or absent curve evidence cannot add a ribbon around an unconfirmed face');
  const geometry = buildingGeometry(building, height, floorHeight, [], [], [], building.classroomWindows, [], [], false, windows);
  const body = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  body.rotation.x = -Math.PI / 2; body.position.y = .12; body.updateMatrixWorld();
  const details = campusExteriorGeometry(building, 4, floorHeight), panes = new THREE.Mesh(details.glass, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); panes.updateMatrixWorld();
  const accents = new THREE.Mesh(details.accent, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); accents.updateMatrixWorld();
  const soffits = new THREE.Mesh(details.darkFrame, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); soffits.updateMatrixWorld();
  try {
    for (const [i, face] of facade.faces.entries()) {
      const p = [(face.a[0] + face.b[0]) / 2, (face.a[1] + face.b[1]) / 2];
      const normal = new THREE.Vector3(face.normal[0], 0, face.normal[1]);
      const ray = y => new THREE.Raycaster(new THREE.Vector3(p[0], .12 + y, p[1]).addScaledVector(normal, -.55), normal, 0, 1.5);
      for (const floor of [2, 3]) {
        const window = curved[floor === 2 ? i : 5 + i], y = (window.bottom + window.top) / 2;
        assert.equal(ray(y).intersectObject(body).length, 0, 'The window is hollow through the body, including all 0.72 m of its deep reveal');
        const hits = ray(y).intersectObject(panes);
        assert.ok(hits.length, 'One continuous glazing panel fills the actual opening');
        assert.ok(Math.abs(hits[0].distance - (floor === 2 ? 1.27 : .69)) < .02, 'Lower glazing is recessed while top glazing follows the original wall');
      }
      assert.ok(ray(3 * floorHeight).intersectObject(body).length, 'The projecting brick waist retains its concrete slab and wall');
      assert.ok(ray(3 * floorHeight).intersectObject(accents).length, 'The broad waist has the photographed brick finish');
      const at = new THREE.Vector3(p[0], .12 + curved[i].top - .2, p[1]).addScaledVector(normal, .4);
      assert.ok(new THREE.Raycaster(at, new THREE.Vector3(0, 1, 0), 0, .5).intersectObject(soffits).length, 'A real dark underside spans the recessed lower window');
    }
    assert.equal(details.glass.getAttribute('position').count / 3, curved.length * 2, 'The curve has one thin pane per chord and storey');
  } finally {
    geometry.dispose(); Object.values(details).forEach(detail => detail.dispose()); [body, panes, accents, soffits].forEach(mesh => mesh.material.dispose());
  }
  assert.equal(JSON.stringify(saved), before, 'Rendering never moves the approved footprint or photograph calibration');
});

test('office floor override keeps body apertures and brick bands aligned without relocating glass when cutting lower floors', () => {
  const saved = campus.buildings.find(building => building.id === OFFICE_ID), original = JSON.stringify(saved);
  const building = { ...saved, classroomWindows: { ...saved.classroomWindows, facadeLines: [...saved.classroomWindows.facadeLines, saved.outer.slice(0, 6)] } };
  const info = buildingLevels(building, { floors: 5, floorHeight: 3.6 }), height = info.height, floorHeight = info.floorHeight;
  const full = officeCurvedWindows(building, height, floorHeight, info.floors);
  assert.equal(full.length, 10);
  assert.deepEqual([...new Set(full.map(window => Math.floor(window.bottom / floorHeight) + 1))], [4, 5], 'The override moves both observed bands to the actual top two floors');
  const face = officeCurvedFacade(building).faces[2], normal = new THREE.Vector3(face.normal[0], 0, face.normal[1]);
  const ray = y => new THREE.Raycaster(new THREE.Vector3((face.a[0] + face.b[0]) / 2, .12 + y, (face.a[1] + face.b[1]) / 2).addScaledVector(normal, -.55), normal, 0, 1.5);
  for (const floor of [undefined, 3, 4, 5]) {
    const cutoff = floor === undefined ? undefined : floor * floorHeight, visible = Math.min(height, cutoff ?? Infinity);
    const windows = officeWindowLayout(building, visible, floorHeight, info.floors), curved = windows.filter(window => window.curvedOffice);
    assert.deepEqual(curved, full.filter(window => window.bottom < visible), 'A cut hides higher bands without moving them down to its selected storey');
    const geometry = buildingGeometry(building, visible, floorHeight, [], [], [], building.classroomWindows, [], [], cutoff !== undefined, windows);
    const body = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); body.rotation.x = -Math.PI / 2; body.position.y = .12; body.updateMatrixWorld();
    const details = campusExteriorGeometry(building, info.floors, floorHeight, cutoff), panes = new THREE.Mesh(details.glass, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); panes.updateMatrixWorld();
    const bricks = new THREE.Mesh(details.accent, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); bricks.updateMatrixWorld();
    try {
      assert.equal(details.glass.getAttribute('position').count / 3, curved.length * 2);
      for (const window of curved.filter((_, i) => i % 5 === 2)) {
        const through = ray((window.bottom + window.top) / 2);
        assert.equal(through.intersectObject(body).length, 0, 'Glazing has its corresponding opening after the override');
        assert.ok(through.intersectObject(panes).length, 'The inset pane remains aligned with its actual opening');
      }
      if (visible > 4 * floorHeight) {
        assert.ok(ray(4 * floorHeight).intersectObject(body).length);
        assert.ok(ray(4 * floorHeight).intersectObject(bricks).length, 'The brick waist follows the same overridden upper-floor boundary');
      }
      assert.ok(ray(2 * floorHeight + 1.5).intersectObject(body).length, 'The former third-floor ribbon remains a solid wall after moving the observed bands up');
    } finally { geometry.dispose(); Object.values(details).forEach(detail => detail.dispose()); [body, panes, bricks].forEach(mesh => mesh.material.dispose()); }
  }
  assert.equal(JSON.stringify(saved), original);
});

test('library annex facade follows the effective two-floor editor override', () => {
  const building = campus.buildings.find(building => building.id === LIBRARY_ID);
  for (const floorHeight of [3.6, 4.2]) {
    const info = buildingLevels(building, { floors: 5, floorHeight, partFloors: { 'curved-annex': 2 } });
    const annexFloors = info.sections.find(section => section.id === 'curved-annex').floors;
    for (const selectedFloor of [undefined, 1, 2, 3]) {
      const cutoff = selectedFloor === undefined ? undefined : selectedFloor * floorHeight;
      const model = campusExteriorGeometry(building, info.floors, info.floorHeight, cutoff, annexFloors);
      try {
        assert.equal(model.glass.getAttribute('position').count, 0);
        assert.ok(model.frame.getAttribute('position').count > 0);
        for (const geometry of Object.values(model)) {
          const positions = geometry.getAttribute('position');
          for (let i = 0; i < positions.count; i++) assert.ok(positions.getY(i) <= .12 + Math.min(2 * floorHeight, cutoff ?? Infinity) + .001,
            'Frames, braces and glazing stop at the overridden annex roof even when the main body has more floors');
        }
      } finally { Object.values(model).forEach(geometry => geometry.dispose()); }
    }
  }
});

test('library detail layer never invents fallback glass when window evidence is absent', () => {
  const saved = campus.buildings.find(building => building.id === LIBRARY_ID);
  for (const classroomWindows of [saved.classroomWindows, { ...saved.classroomWindows, facadeLines: [] }, undefined]) {
    const building = { ...saved, classroomWindows }, model = campusExteriorGeometry(building, 5, 3.6);
    try {
      assert.equal(model.glass.getAttribute('position').count, 0, 'Missing, unknown and configured layouts all forbid shallow fallback glass');
      assert.ok(model.frame.getAttribute('position').count > 0, 'White diagonal braces remain on the confirmed entry');
    } finally { Object.values(model).forEach(geometry => geometry.dispose()); }
  }
});

test('office tall light strip has real shared apertures, retained floor bands and no overlapping ordinary panes', () => {
  const saved = campus.buildings.find(building => building.id === OFFICE_ID), original = JSON.stringify(saved);
  const area = saved.outer.slice(1).reduce((sum, point, i) => sum + saved.outer[i][0] * point[1] - point[0] * saved.outer[i][1], 0), sign = area >= 0 ? 1 : -1;
  for (const floorHeight of [3.6, 4.2]) for (const cutoff of [undefined, floorHeight, 3 * floorHeight]) {
    // Wider ordinary bays deliberately overlap the strip before the helper's
    // exclusion, so this also catches duplicate glass and mullions at the join.
    const building = { ...saved, classroomWindows: { ...saved.classroomWindows, bayWidth: 3, windowWidth: 2.8, pierWidth: .08 } };
    const height = Math.min(4 * floorHeight, cutoff ?? Infinity), windows = officeWindowLayout(building, height, floorHeight);
    const strips = windows.filter(window => Math.abs((window.bottom % floorHeight) - .25) < 1e-7);
    assert.equal(strips.length, Math.round(height / floorHeight));
    assert.ok(windows.filter(window => !strips.includes(window)).every(window => !polygonClipping.intersection(window.cut, strips[0].cut).length),
      'The confirmed tall strip replaces any overlapping ordinary bay rather than duplicating it');
    const geometry = buildingGeometry(building, height, floorHeight, [], [], [], building.classroomWindows, [], [], cutoff !== undefined, windows);
    const body = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    body.rotation.x = -Math.PI / 2; body.position.y = .12; body.updateMatrixWorld();
    const glazing = classroomGlazingGeometry(windows, building.classroomWindows), glass = new THREE.Mesh(glazing.glass, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    glass.updateMatrixWorld();
    const rayAt = (from, to, y) => {
      const along = new THREE.Vector3(to[0] - from[0], 0, to[1] - from[1]).normalize();
      const normal = new THREE.Vector3(-along.z * sign, 0, along.x * sign);
      const point = new THREE.Vector3((from[0] + to[0]) / 2, .12 + y, (from[1] + to[1]) / 2);
      return new THREE.Raycaster(point.addScaledVector(normal, -.55), normal, 0, 1.1);
    };
    try {
      assert.equal(glazing.glass.getAttribute('position').count / 3, windows.length * 2, 'Each aperture has only one thin glazing panel');
      for (const strip of strips) {
        assert.ok(Math.abs(Math.hypot(strip.to[0] - strip.from[0], strip.to[1] - strip.from[1]) - 1.9) < 1e-7);
        const ray = rayAt(strip.from, strip.to, (strip.bottom + strip.top) / 2);
        assert.equal(ray.intersectObject(body).length, 0, 'The tall window is a true hole through the wall');
        assert.ok(ray.intersectObject(glass).length, 'The shared pane fills the hole');
        const band = rayAt(strip.from, strip.to, Math.floor(strip.bottom / floorHeight) * floorHeight + .13);
        assert.ok(band.intersectObject(body).length, 'Concrete floor bands remain between the tall lights');
        assert.equal(band.intersectObject(glass).length, 0);
      }
      const unknown = rayAt(building.outer[7], building.outer[8], floorHeight / 2);
      assert.ok(unknown.intersectObject(body).length, 'An unconfirmed side facade remains solid');
      assert.equal(unknown.intersectObject(glass).length, 0);
    } finally { geometry.dispose(); body.material.dispose(); glass.material.dispose(); glazing.glass.dispose(); glazing.frames.dispose(); }
  }
  assert.equal(JSON.stringify(saved), original, 'The test and helper do not alter approved footprints or window evidence');
});

test('office tall strip requires complete evidence on its own front face', () => {
  const saved = campus.buildings.find(building => building.id === OFFICE_ID);
  const a = saved.outer[13], b = saved.outer[14], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const point = fraction => [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction];
  const strip = windows => windows.filter(window => Math.abs((window.bottom % 3.6) - .25) < 1e-7);
  const layout = facadeLines => officeWindowLayout({ ...saved, classroomWindows: { ...saved.classroomWindows, facadeLines } }, 14.4, 3.6);
  assert.deepEqual(layout([]), [], 'An explicitly unknown building does not acquire special glass');
  assert.equal(strip(layout([[saved.outer[6], saved.outer[7]]])).length, 0, 'Back-face evidence cannot authorize the front strip');
  assert.equal(strip(layout([[point(.48 - .95 / length), point(.48)]])).length, 0, 'Partial evidence does not authorize the remaining half of the strip');
  assert.equal(strip(layout([[a, b]])).length, 4, 'The confirmed front retains the tall strip on its four storeys');
  assert.equal(strip(layout(undefined)).length, 4, 'Legacy explicitly configured glazing retains its original semantics');
});
