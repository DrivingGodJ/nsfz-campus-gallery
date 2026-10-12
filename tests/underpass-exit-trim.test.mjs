import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { undergroundLayout, undergroundCeilingSections } from '../src/underground-geometry.ts';
import { undergroundDetailGeometry } from '../src/underground-details.ts';
import { pointOnStairTread } from '../src/structure-geometry.ts';
import { groundSurfaces } from '../src/ground-geometry.ts';

const campus = JSON.parse(fs.readFileSync(new URL('../public/data/campus.json', import.meta.url)));
const area = undergroundLayout(campus.features).areas.get('local/underground-corridor');
const sections = undergroundCeilingSections(area.feature, area.footprints, area.openings, area.connections);
const polygons = shapes => shapes.map(shape => [shape.outer, ...shape.holes]);

test('the circled return stays below ground with a continuous passage into the unchanged high corridor', () => {
  const model = undergroundDetailGeometry(area.feature, area.footprints, area.openings, area.connections);
  const objects = Object.fromEntries(['ceiling', 'walls', 'floor'].map(kind => {
    const mesh = new THREE.Mesh(model[kind], new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.updateMatrixWorld(); return [kind, mesh];
  }));
  const ray = (p, y, direction, far, meshes) => new THREE.Raycaster(new THREE.Vector3(p[0], y, p[1]), direction, 0, far).intersectObjects(meshes);
  try {
    const ground = groundSurfaces(campus);
    const groundShapes = [...ground.campus, ...ground.features.values()].flat();
    const low = sections.find(section => section.height === 3.2);
    assert.ok(low);
    assert.deepEqual(polygonClipping.xor(polygons(area.footprints), polygonClipping.union(...sections.map(section => polygons(section.footprints)))), [], 'No part of the underground walking floor is removed');
    for (const point of [[-64,-42],[-62,-43],[-60,-44],[-59,-46]]) {
      assert.ok(low.footprints.some(shape => pointOnStairTread(point, shape.outer)));
      const roof = ray(point, area.feature.height + 1.6, new THREE.Vector3(0,1,0), 8, [objects.ceiling]);
      assert.ok(roof.length);
      assert.ok(Math.abs(roof[0].point.y + .72) < 1e-5, 'The former raised roof now matches the buried tunnel roof');
      assert.equal(ray(point, 4, new THREE.Vector3(0,-1,0), 4, [objects.ceiling,objects.walls]).length, 0, 'The circled projection has no remaining structure above ground');
      assert.ok(groundShapes.some(shape => pointOnStairTread(point, shape.outer) && !shape.holes.some(hole => pointOnStairTread(point,hole))), 'Real ground now covers the buried return, without a hole exposing its roof');
      assert.ok(ray(point, area.feature.height + .1, new THREE.Vector3(0,-1,0), .2, [objects.floor]).length);
    }
    const seam = low.openings.find(opening => opening.height === 3.08);
    assert.ok(seam, 'The low return has a real connection to the tall corridor');
    const direction = new THREE.Vector3(seam[1][1]-seam[0][1],0,seam[0][0]-seam[1][0]).normalize();
    for (const t of [.15,.5,.85]) for (const rise of [.5,1.6,2.7]) {
      const p=seam[0].map((n,i)=>n+(seam[1][i]-n)*t),from=new THREE.Vector3(p[0],area.feature.height+rise,p[1]).addScaledVector(direction,-.3);
      assert.equal(new THREE.Raycaster(from,direction,0,.6).intersectObjects([objects.walls,objects.ceiling]).length,0,'The return remains open across its full width');
    }
    const point=area.feature.branches[0][0].map((n,i)=>(n+area.feature.branches[0][1][i])/2),highRoof=ray(point,area.feature.height+1.6,new THREE.Vector3(0,1,0),8,[objects.ceiling]);
    assert.ok(highRoof.length && Math.abs(highRoof[0].point.y-2.48)<1e-5,'The original high entrance roof remains in place');
  } finally { Object.values(model).forEach(geometry=>geometry.dispose());Object.values(objects).forEach(mesh=>mesh.material.dispose()); }
});
