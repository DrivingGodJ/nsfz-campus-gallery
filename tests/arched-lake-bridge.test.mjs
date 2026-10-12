import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import clip from 'polygon-clipping';
import * as THREE from 'three';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';
import { passageFootprint } from '../src/underground-geometry.ts';
import { bridgeHeight, bridgeSurfaceHeight, stoneBridgeProfile } from '../src/structure-geometry.ts';
import { bridgeLayout, bridgeRailPosts } from '../src/bridge-geometry.ts';
import { archedBridgeGeometry } from '../src/bridge-mesh.ts';
import { groundSurfaces } from '../src/ground-geometry.ts';
import { photoMapHeight, assignPhotoLocation, campusLocations } from '../src/locations.ts';

const read = async file => JSON.parse(await fs.readFile(new URL('../' + file, import.meta.url)));
const campus = await read('public/data/campus.json'), site = await read('public/data/site.json');
const find = id => campus.features.find(feature => feature.id === id);
const bridge = find('local/arched-lake-bridge'), channel = find('local/lake-water-link');
const polygon = shape => [shape.outer, ...(shape.holes || [])];
const area = polygons => polygons.reduce((sum, [outer, ...holes]) => {
  const ringArea = ring => Math.abs(ring.slice(1).reduce((n, p, i) => n + ring[i][0] * p[1] - p[0] * ring[i][1], 0) / 2);
  return sum + ringArea(outer) - holes.reduce((n, ring) => n + ringArea(ring), 0);
}, 0);

test('the new waterway joins both marked ponds and the original route continues across the arch bridge', async () => {
  const ponds = channel.connectedTo.map(find);
  for (const pond of ponds) assert.ok(area(clip.intersection(polygon(channel), polygon(pond))) > 1, 'Channel reaches into each pond instead of stopping at its bank');
  assert.equal(clip.union(...ponds.map(polygon), polygon(channel)).length, 1, 'The two ponds and channel form one connected water body');
  for (const building of campus.buildings) assert.ok(area(clip.intersection(polygon(channel), polygon(building))) < 1e-7, 'Waterway stays clear of buildings');
  assert.deepEqual(applyCampusCorrections(campus, await read('data/campus-corrections.json')), campus);
  const previous = find('way/1277839759'), source = find('way/1233313450'), approach = find('local/arched-bridge-approach'), departure = find('local/arched-bridge-departure');
  assert.equal(previous.representedBy, bridge.id);
  assert.equal(source.representedBy, bridge.id);
  assert.deepEqual(bridge.sourcePathIds, [previous.id, source.id]);
  assert.deepEqual(approach.points, [previous.points[0], bridge.points[0]]);
  assert.deepEqual(departure.points, [bridge.points[1], ...source.points.slice(1)]);
  assert.equal(bridge.width, source.width);
  const routeParts = [approach.points, bridge.points, departure.points].map(points => polygon(passageFootprint(points, source.width)));
  const complete = clip.union(...routeParts), original = polygon(passageFootprint([...previous.points, ...source.points.slice(1)], source.width));
  // The original adjacent OSM segments have a slight kink; the straight span
  // crosses that junction with less than 0.01 square metre of outline deviation.
  assert.ok(area(clip.difference(original, complete)) < .01);
  assert.ok(area(clip.difference(complete, original)) < .01, 'Bridge and approaches retain both source road segments');
  assert.ok(bridge.points[0][1] < previous.points[1][1] && bridge.points[1][1] > previous.points[1][1], 'The relocated arch straddles the earlier road junction at the marked crossing');
  const layout = groundSurfaces(campus), visible = layout.features.get(channel.id).map(polygon);
  const footprint = bridgeLayout(bridge, bridge.deckHeight).footprint.map(polygon);
  assert.ok(area(clip.intersection(visible, footprint)) > 5, 'Water remains visible below the raised crossing');
});

test('the stone bridge has real steps, a flat platform, outside low guards and an open arch across the water', () => {
  const height = bridgeHeight(bridge, campus.buildings, site.buildingOverrides), [start, end] = bridge.points;
  const dx=end[0]-start[0],dz=end[1]-start[1],length=Math.hypot(dx,dz),axis=new THREE.Vector3(dx/length,0,dz/length),normal=new THREE.Vector3(-axis.z,0,axis.x);
  const at=(station,across=0,y=0)=>new THREE.Vector3(start[0],y,start[1]).addScaledVector(axis,station).addScaledVector(normal,across);
  const midpoint = at(length/2), profile=stoneBridgeProfile(bridge,height),peak=height+.72;
  assert.equal(bridge.bridgeStyle,'stone'); assert.equal(bridge.archRise,.72); assert.equal(bridge.width,2);
  assert.deepEqual(profile[0],[0,height]); assert.deepEqual(profile.at(-1),[length,height]);
  let ascending=0,descending=0;
  for(let i=1;i<profile.length;i++){
    const previous=profile[i-1],point=profile[i],run=point[0]-previous[0],rise=point[1]-previous[1];
    assert.ok(run>=-1e-9,'The stair profile advances from one bank to the other');
    if(Math.abs(rise)<1e-9)continue;
    assert.ok(Math.abs(run)<1e-9 && Math.abs(Math.abs(rise)-.18)<1e-9,'Each actual riser is vertical and18cm high');
    if(rise>0)ascending++;else descending++;
  }
  assert.equal(ascending,4);assert.equal(descending,4);
  const flats=profile.slice(1).flatMap((point,i)=>point[0]-profile[i][0]>1e-8?[[profile[i],point]]:[]);
  const platform=flats.find(([a,b])=>Math.abs(a[1]-peak)<1e-9 && Math.abs(b[1]-peak)<1e-9);
  assert.ok(platform);assert.ok(Math.abs(platform[0][0]-1.4)<1e-9 && Math.abs(platform[1][0]-(length-1.4))<1e-9,'Four35cm steps at each end leave one centred flat platform');
  assert.equal(bridgeSurfaceHeight(bridge, height, start), .115);
  assert.equal(bridgeSurfaceHeight(bridge, height, end), .115);
  assert.equal(bridgeSurfaceHeight(bridge, height, [midpoint.x,midpoint.z]),peak);
  const layout = bridgeLayout(bridge, height);
  assert.equal(layout.stairs.length, 0); assert.equal(layout.railChains.length, 2);
  const geometry = archedBridgeGeometry(bridge, height), material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material); mesh.updateMatrixWorld();
  const down=(station,across=0)=>new THREE.Raycaster(at(station,across,5),new THREE.Vector3(0,-1,0)).intersectObject(mesh);
  try {
    assert.ok(Array.from(geometry.attributes.position.array).every(Number.isFinite));
    for(const [a,b]of flats){
      const station=(a[0]+b[0])/2,point=at(station);
      assert.ok(Math.abs(bridgeSurfaceHeight(bridge,height,[point.x,point.z])-a[1])<1e-9,'The photo/camera surface is the exact flat tread, rather than a ramp');
      for(const across of [-.99,0,.99]){
        const hits=down(station,across);assert.ok(hits.length);
        assert.ok(Math.abs(hits[0].point.y-a[1])<1e-4,'The stone geometry keeps the entire two-metre walking surface clear');
      }
      for(const fraction of [.2,.5,.8]){
        const hits=down(a[0]+(b[0]-a[0])*fraction);
        assert.ok(hits.length && Math.abs(hits[0].point.y-a[1])<1e-4,'Each tread and the whole central platform are truly level');
      }
    }
    for(let i=1;i<profile.length;i++)if(profile[i][1]>profile[i-1][1]+1e-9){
      const station=profile[i][0],rise=(profile[i][1]+profile[i-1][1])/2;
      assert.ok(new THREE.Raycaster(at(station-.08,0,rise),axis,0,.16).intersectObject(mesh).length,'Each ascending step has a real vertical stone face');
    }
    for(const side of [-1,1]){
      const hits=down(length/2,side*1.12);assert.ok(hits.length);
      assert.ok(Math.abs(hits[0].point.y-peak-.16)<1e-4,'The24cm low stone guard sits outside the clear walking width');
      assert.equal(down(length/2,side*1.26).length,0,'The low guard does not grow beyond its24cm outer width');
    }
    for(const across of [-.85,0,.85])for(const end of [false,true]){
      const ray=new THREE.Raycaster(at(end?length+.08:-.08,across,height+.06),axis.clone().multiplyScalar(end?-1:1),0,.24);
      assert.equal(ray.intersectObject(mesh).length,0,'Both bank entrances have no transverse guard or immediate raised stone lip');
    }
    const wet=clip.intersection(layout.footprint.map(polygon),polygon(channel)).flat(2).map(p=>(p[0]-start[0])*axis.x+(p[1]-start[1])*axis.z);
    const wetStart=Math.min(...wet),wetEnd=Math.max(...wet);
    for(let i=0;i<=12;i++){
      const station=wetStart+.02+(wetEnd-wetStart-.04)*i/12;
      assert.equal(new THREE.Raycaster(at(station,-1.5,.1),normal,0,3).intersectObject(mesh).length,0,'The actual arch opening passes water through the full wet crossing and both stone cheeks');
    }
    const crown=new THREE.Raycaster(at(length/2,0,.1),new THREE.Vector3(0,1,0),0,1).intersectObject(mesh)[0];
    assert.ok(crown && Math.abs(crown.point.y-(peak-.28))<1e-4,'The arch crown retains28cm of stone below the flat platform');
    const lowerArch=new THREE.Raycaster(at(length/2+1.2,0,.1),new THREE.Vector3(0,1,0),0,1).intersectObject(mesh)[0];
    assert.ok(lowerArch && lowerArch.point.y<crown.point.y-.05,'The central aperture has a real curved arch underside');
  } finally { geometry.dispose(); material.dispose(); }
  assert.ok(campusLocations(campus, site).some(location => location.id === bridge.id && location.name === '拱桥'));
  for(const [a,b]of flats){
    const point=at((a[0]+b[0])/2),photo=assignPhotoLocation({position:{x:point.x,z:point.z},cameraHeight:1.6,buildingId:'',floor:0},bridge.id,campus,site);
    assert.ok(Math.abs(photoMapHeight(photo,campus,site)-a[1]-1.6)<1e-9,'Photos on each step and platform use its actual surface height');
  }
  assert.equal(find('local/lake-bridge').archRise, undefined, 'The earlier flat bridge remains flat');

  const ordinary={...bridge,bridgeStyle:undefined,archRise:1.4},slab=archedBridgeGeometry(ordinary,height),ordinaryMesh=new THREE.Mesh(slab,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));ordinaryMesh.updateMatrixWorld();
  try{
    for(const t of [.1,.25,.5,.75,.9]){
      const point=at(t*length,0,5),expected=height+1.4*4*t*(1-t),hit=new THREE.Raycaster(point,new THREE.Vector3(0,-1,0)).intersectObject(ordinaryMesh)[0];
      assert.ok(Math.abs(bridgeSurfaceHeight(ordinary,height,[point.x,point.z])-expected)<1e-9,'Ordinary bridge profiles keep the original parabolic height');
      assert.ok(hit && Math.abs(hit.point.y-expected)<.002,'The ordinary32-segment arched slab remains intact');
    }
    const chains=bridgeLayout(ordinary,height).railChains;
    assert.equal(chains.length,2);assert.ok(chains.every(c=>c.length===33&&bridgeRailPosts([c],3,true).length<7),'Ordinary arched metal rails retain their original sampling and post spacing');
  }finally{slab.dispose();ordinaryMesh.material.dispose()}
});
