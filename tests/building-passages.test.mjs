import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { buildingGeometry } from '../src/building-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const building = campus.buildings.find(item => item.id === 'way/855459420');
const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));

function model(override, selectedFloor) {
  const info = buildingLevels(building, override);
  const meshes = info.sections.map(section => {
    const height = selectedFloor ? Math.min(section.height, selectedFloor * info.floorHeight) : section.height;
    const mesh = new THREE.Mesh(buildingGeometry(section, height, info.floorHeight, building.groundPassages, building.floorCorridors?.filter(corridor => corridor.partId === section.id)), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = .12;
    mesh.updateMatrixWorld();
    mesh.geometry.computeBoundingBox();
    assert.ok(Math.abs(mesh.geometry.boundingBox.max.z - height) < 1e-4, 'The full height of each main/secondary section is preserved');
    return mesh;
  });
  const dispose = () => meshes.forEach(mesh => { mesh.geometry.dispose(); mesh.material.dispose(); });
  return { info, meshes, dispose };
}

test('both teaching-building roads remain open, with slabs above and continuous upper connectors', async () => {
  const original = JSON.stringify([building, site]);
  assert.deepEqual(building.groundPassages.map(passage => passage.sourcePathId), ['way/1233313441', 'way/1233313444']);
  const corrections = JSON.parse(await fs.readFile(new URL('../data/campus-corrections.json', import.meta.url)));
  assert.deepEqual(applyCampusCorrections(campus, corrections), campus, 'Road openings survive repeated map refreshes');
  for (const passage of building.groundPassages) {
    const road = campus.features.find(feature => feature.id === passage.sourcePathId);
    assert.deepEqual(passage.points, road.points);
    assert.equal(passage.width, road.width);
  }
  for (const override of [site.buildingOverrides[building.id], { floors: 7, partFloors: { 'sixth-floor-wing': 4 }, floorHeight: 4.2 }]) {
    const { info, meshes, dispose } = model(override);
    for (const mesh of meshes) {
      const edges = new THREE.EdgesGeometry(mesh.geometry, 25), vertices = edges.getAttribute('position');
      for (let i = 0; i < vertices.count; i += 2) {
        if (![i, i + 1].every(j => Math.abs(vertices.getZ(j) - info.floorHeight) < 1e-4)) continue;
        for (const t of [0, .5, 1]) {
          const x = vertices.getX(i) * (1 - t) + vertices.getX(i + 1) * t;
          const z = -vertices.getY(i) * (1 - t) - vertices.getY(i + 1) * t;
          const onCorridor = building.floorCorridors?.some(corridor => {
            if ('passageIndex' in corridor) return false; // Covered by the ground-passage footprint check below.
            if ('edges' in corridor) {
              const ring = building.parts.find(part => part.id === corridor.partId).outer;
              return corridor.edges.some(edge => {
                const from = ring[edge], to = ring[edge + 1], dx = to[0] - from[0], dz = to[1] - from[1];
                const t = Math.max(0, Math.min(1, ((x - from[0]) * dx + (z - from[1]) * dz) / (dx * dx + dz * dz)));
                return Math.hypot(x - from[0] - dx * t, z - from[1] - dz * t) <= corridor.depth * Math.SQRT2 + 1e-4;
              });
            }
            if ('holeIndex' in corridor) {
              const hole = building.parts.find(part => part.id === corridor.partId).holes[corridor.holeIndex];
              return hole.slice(0, -1).some((from, i) => {
                const to = hole[i + 1], dx = to[0] - from[0], dz = to[1] - from[1];
                const t = Math.max(0, Math.min(1, ((x - from[0]) * dx + (z - from[1]) * dz) / (dx * dx + dz * dz)));
                return Math.hypot(x - from[0] - dx * t, z - from[1] - dz * t) <= corridor.depth * Math.SQRT2 + 1e-4;
              });
            }
            const ring = building.parts.find(part => part.id === corridor.partId).outer;
            const from = ring[corridor.edge], to = ring[corridor.edge + 1], dx = to[0] - from[0], dz = to[1] - from[1], length = Math.hypot(dx, dz);
            const along = ((x - from[0]) * dx + (z - from[1]) * dz) / length;
            const inward = (dx * (z - from[1]) - dz * (x - from[0])) / length;
            return along >= -corridor.depth * .05 - 1e-4 && along <= length + corridor.depth * .05 + 1e-4 && inward >= -1e-4 && inward <= corridor.depth + 1e-4;
          });
          assert.ok(onCorridor || building.groundPassages.some(passage => {
            const [from, to] = passage.points, dx = to[0] - from[0], dz = to[1] - from[1], length = Math.hypot(dx, dz);
            const along = ((x - from[0]) * dx + (z - from[1]) * dz) / length;
            return Math.abs((x - from[0]) * dz - (z - from[1]) * dx) / length <= passage.width / 2 + 1e-4
              && along >= -passage.width - 1e-4 && along <= length + passage.width + 1e-4;
          }), 'New horizontal outlines appear only at passage ceilings or corridor slabs, not across the intact facade');
        }
      }
      edges.dispose();
    }
    for (const passage of building.groundPassages) {
      const [from, to] = passage.points, dx = to[0] - from[0], dz = to[1] - from[1], length = Math.hypot(dx, dz);
      const direction = new THREE.Vector3(dx / length, 0, dz / length);
      for (const offset of [-passage.width * .45, 0, passage.width * .45]) {
        const start = new THREE.Vector3(from[0] - direction.x * 2 + direction.z * offset, .12 + info.floorHeight * .5, from[1] - direction.z * 2 - direction.x * offset);
        const ray = new THREE.Raycaster(start, direction, 0, length + 4);
        assert.equal(ray.intersectObjects(meshes, false).length, 0, 'The entire road width is open through both facades and the interior');
        ray.ray.origin.y = .12 + info.floorHeight * 1.5;
        if (Math.abs(offset) < 1.5 || passage.sourcePathId === 'way/1233313444') {
          assert.equal(ray.intersectObjects(meshes, false).length, 0, 'The upper connector also opens through the former end walls');
        }
      }
      const middle = new THREE.Vector3((from[0] + to[0]) / 2, .3, (from[1] + to[1]) / 2);
      const up = new THREE.Raycaster(middle, new THREE.Vector3(0, 1, 0));
      const throughCourtyard = building.holes.some(ring => {
        const polygon = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
        const geometry = new THREE.ShapeGeometry(polygon);
        const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
        mesh.rotation.x = -Math.PI / 2; mesh.position.y = .12 + info.floorHeight; mesh.updateMatrixWorld();
        const inside = up.intersectObject(mesh).length > 0;
        geometry.dispose(); mesh.material.dispose();
        return inside;
      });
      if (throughCourtyard) {
        assert.equal(up.intersectObjects(meshes, false).length, 0, 'The road remains open to the sky where it crosses the courtyard');
      }
      // Check the retained roof strip, rather than the newly opened return seam.
      up.ray.origin.set(from[0] + dx * .85, .3, from[1] + dz * .85);
      const ceiling = up.intersectObjects(meshes, false)[0];
      assert.ok(ceiling, 'The passage has a visible ceiling');
      assert.ok(Math.abs(ceiling.point.y - .12 - info.floorHeight) < 1e-4, 'The opening height follows one floor height');
      assert.ok(ceiling.face.normal.z < -.99, 'The ceiling faces downward into the passage');
    }
    dispose();
  }
  assert.equal(JSON.stringify([building, site]), original, 'Names, floor settings, photos and original building footprints are untouched');
});

test('floor views retain the road openings instead of adding a solid cap at ground level', () => {
  for (const floor of [1, 2]) {
    const { info, meshes, dispose } = model({ floors: 5, partFloors: { 'sixth-floor-wing': 6 }, floorHeight: 3.8 }, floor);
    for (const passage of building.groundPassages) {
      const [from, to] = passage.points, direction = new THREE.Vector3(to[0] - from[0], 0, to[1] - from[1]).normalize();
      const start = new THREE.Vector3(from[0], .12 + info.floorHeight * .5, from[1]).addScaledVector(direction, -2);
      assert.equal(new THREE.Raycaster(start, direction, 0, Math.hypot(to[0] - from[0], to[1] - from[1]) + 4).intersectObjects(meshes, false).length, 0);
    }
    dispose();
  }
});
