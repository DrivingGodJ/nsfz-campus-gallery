import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import clip from 'polygon-clipping';
import { bajinStatueGeometry } from '../src/bajin-statue-geometry.ts';
import { roadFootprint } from '../src/road-geometry.ts';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';
import { campusLocations } from '../src/locations.ts';

const read=file=>JSON.parse(fs.readFileSync(new URL('../'+file,import.meta.url)));
const campus=read('public/data/campus.json'),site=read('public/data/site.json');
const feature=campus.features.find(f=>f.id==='local/luxun-garden-portrait');

test('the marked garden portrait faces the arrow and clears the memorial, lake and existing paths',()=>{
  assert.deepEqual(feature.statue.center,[124,24.5]);
  assert.equal(feature.statue.variant,'gardenHead');
  const front=new THREE.Vector3(0,0,1).applyAxisAngle(new THREE.Vector3(0,1,0),Math.atan2(-feature.statue.axis[1],feature.statue.axis[0]));
  assert.ok(front.dot(new THREE.Vector3(-.09996551070484618,0,-.9949909025033044))>1-1e-9,'The actual rendered face points screen-down along the blue arrow');
  const occupied=[feature.outer,...feature.holes];
  for(const shape of [...campus.buildings,...campus.features.filter(f=>f.type==='water'),...campus.features.filter(f=>f.type==='path'&&!f.representedBy).map(roadFootprint)]){
    assert.deepEqual(clip.intersection(occupied,[shape.outer,...(shape.holes||[])]),[]);
  }
  assert.deepEqual(clip.difference(occupied,[campus.boundary]),[]);
  for(const tree of campus.features.flatMap(f=>f.trees||[]))assert.ok(Math.hypot(tree.position[0]-124,tree.position[1]-24.5)>.5+tree.radius*.18,'The small pedestal clears existing trunks');
  assert.ok(!campusLocations(campus,site).some(l=>l.id===feature.id));
  assert.deepEqual(applyCampusCorrections(campus,read('data/campus-corrections.json')),campus);
});

test('the photo reference produces a head and neck on a tall narrow stone column, without a torso or stair podium',()=>{
  const parts=bajinStatueGeometry(feature.statue);
  try{
    const bounds=new THREE.Box3();
    for(const geometry of Object.values(parts)){
      assert.ok([...geometry.attributes.position.array,...geometry.attributes.normal.array].every(Number.isFinite));
      bounds.union(geometry.boundingBox);
    }
    assert.ok(Math.abs(bounds.max.y-feature.statue.totalHeight)<1e-6&&Math.abs(bounds.min.y)<1e-6);
    const size=bounds.getSize(new THREE.Vector3());
    assert.ok(size.x<=.72+1e-6&&size.z<=.64+1e-6);
    assert.equal(parts.steps.attributes.position.count/3,12);
    assert.ok(parts.bust.boundingBox.min.y<parts.pedestal.boundingBox.max.y,'The neck seats on the column cap');
    assert.ok(parts.bust.boundingBox.getSize(new THREE.Vector3()).x<.45,'There are no added jacket shoulders');
    assert.ok(parts.pedestal.boundingBox.max.y>1.8);
  }finally{Object.values(parts).forEach(g=>g.dispose())}
});
