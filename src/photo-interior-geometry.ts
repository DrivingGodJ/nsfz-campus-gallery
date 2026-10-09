import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { cafeteriaLowerProfile, dormitoryProfile, dormitoryObservatory } from './facade-geometry.ts';
import { laboratoryLayout } from './laboratory-geometry.ts';
import { buildingGeometry, passageShape, snapFootprint } from './building-geometry.ts';
import { pointOnStairTread } from './structure-geometry.ts';
import type { Building, Point, Shape } from './types';

export const PHOTO_INTERIOR_IDS = ['way/1233313431', 'way/1233313434', 'way/855459411', 'local/theatre'];
export const PHOTO_INTERIOR_COLORS = {
  stone: '#dedbd0', wood: '#aa7c52', green: '#aac8a3', orange: '#c3814a', metal: '#aeb8b4', dark: '#354b4b', blue: '#548b9c', purple: '#8a7795', red: '#aa5145', lights: '#ede7ca',
};
type Kind = keyof typeof PHOTO_INTERIOR_COLORS;
type Vector = [number, number, number];
type Frame = { origin: Point; along: Point; across: Point; at: (u: number, v: number) => Point };
export type InteriorPlacement = { id: string; floor: number; source: string; shape: Shape; kind: string; center: Point; axis: Point; length: number; width: number; top: number };

// These are calibrated model anchors, not reactive camera coordinates. Changing
// a photo's heading or position never moves its photographed furniture.
export const PHOTO_INTERIOR_EVIDENCE = [
  { photoId: '719592c1-5539-42c7-b21a-7d9492d273b0', buildingId: PHOTO_INTERIOR_IDS[0], floor: 2, observed: 'green tables, wood legs, green/white/orange chairs and round columns' },
  { photoId: 'a4661989-e16c-4399-8edb-6c5a8a2223fe', buildingId: PHOTO_INTERIOR_IDS[1], floor: 6, observed: 'tilted open-truss reflector telescope, white fork mount and side table' },
  { photoId: '88338113-b195-4d6d-a689-628603b6fc3f', buildingId: PHOTO_INTERIOR_IDS[2], floor: 6, observed: 'wood slat ceiling and zigzag strip lighting on the balcony approach' },
  { photoId: '8904ca53-186b-44ac-b32b-6603b313e39b', buildingId: PHOTO_INTERIOR_IDS[2], floor: 6, observed: 'wood balcony decking, steel space frame and folded black umbrellas' },
  { photoId: '15ce2084-cd0d-4410-8f6d-112dae3e127a', buildingId: PHOTO_INTERIOR_IDS[2], floor: 1, observed: 'art wall, leaning canvas boards, paint pots and red ceiling pipe' },
  { photoId: 'dc98c0fb-fd4a-4158-81cd-5e4926f9d9a9', buildingId: PHOTO_INTERIOR_IDS[2], floor: 1, observed: 'four blue-backed barrel seats beside the existing gallery rail' },
  { photoId: '49036e82-ea4a-4195-a5b4-f571794f438b', buildingId: PHOTO_INTERIOR_IDS[3], floor: 5, observed: 'three shallow white window steps, orange bench and red fire case' },
  { photoId: 'f07686c3-cedb-4632-9441-80413ab4b9bf', buildingId: PHOTO_INTERIOR_IDS[3], floor: 5, observed: 'wall exhibition frames and ceiling spotlights along the window gallery' },
];
const frame = (origin: Point, axis: Point = [1, 0]): Frame => {
  const length = Math.hypot(...axis), along: Point = [axis[0] / length, axis[1] / length], across: Point = [-along[1], along[0]];
  return { origin, along, across, at: (u, v) => [origin[0] + along[0] * u + across[0] * v, origin[1] + along[1] * u + across[1] * v] };
};
const rectangle = (f: Frame, length: number, width: number): Shape => {
  const outer = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v]) => f.at(u * length / 2, v * width / 2));
  return { outer: [...outer, outer[0]], holes: [] };
};
const inside = (point: Point, shape: Shape) => pointOnStairTread(point, shape.outer) && !shape.holes.some(hole => pointOnStairTread(point, hole));
const samples = (shape: Shape) => shape.outer.slice(0,-1).flatMap((a,i) => [a, [(a[0]+shape.outer[i+1][0])/2,(a[1]+shape.outer[i+1][1])/2] as Point]);
const fits = (shape: Shape, rooms: Shape[], exclusions: Shape[]) => rooms.some(room => samples(shape).every(p => inside(p, room))) && exclusions.every(exclusion => !samples(shape).some(p => inside(p, exclusion)) && !samples(exclusion).some(p => inside(p, shape)));

export function photoInteriorShapes(building: Building, floor: number): Shape[] {
  if (building.facade?.type === 'laboratory') { const layout = laboratoryLayout(building); return [...layout.rooms, ...layout.walkways]; }
  if (building.facade?.type === 'cafeteria' && floor <= 2) return [cafeteriaLowerProfile(building).shape];
  if (building.facade?.type === 'dormitory') return [dormitoryProfile(building).shape];
  return [building.parts?.find(part => part.id === 'main') ?? building];
}

export function photoInteriorPlacements(building: Building): InteriorPlacement[] {
  const items: InteriorPlacement[] = [];
  const add = (id: string, floor: number, kind: string, center: Point, axis: Point, length: number, width: number, top: number, source: string, exclusions: Shape[] = []) => {
    const shape = rectangle(frame(center, axis), length, width);
    if (fits(shape, photoInteriorShapes(building, floor), exclusions)) items.push({ id, floor, kind, center, axis, length, width, top, source, shape });
  };
  if (building.id === PHOTO_INTERIOR_IDS[0]) {
    const source = PHOTO_INTERIOR_EVIDENCE[0].photoId;
    const columns: Point[] = [[-65,93],[-52,106],[-68,113],[-44.7331,96.6670]];
    // Sparse rows preserve a central 2.6 m aisle and the photographed standing
    // position. All table-and-chair envelopes fit the new curved lower body.
    for (let x = -73; x <= -37; x += 4.5) for (let z = 89; z <= 119; z += 5) {
      if (Math.abs(x + 59.5) < 2 || Math.abs(z - 99) < 2 || (x>-48&&z<104) || Math.hypot(x + 46.1085,z - 98.2272) < 3 || columns.some(p=>Math.hypot(x-p[0],z-p[1])<3)) continue;
      add(`dining-${x}-${z}`, 2, 'dining-set', [x,z], [.78,-.625], 3.5, 3.8, 1.03, source);
    }
    // The photographed east window bay is only about six metres deep. The old
    // oversized grid envelope rejected its near tables and left an empty view.
    // Use the real 2.6 m table-and-chair envelope here, aligned with that bay;
    // its front stays over two metres clear of the unchanged shooting point.
    const bay=frame([-46.1085275,98.2272057],[.973,-.2305]);
    for(const [i,[distance,side]] of [[3.2,-3.1],[3.6,.3],[3.6,3.7]].entries()) add(`dining-window-bay-${i}`,2,'dining-set',bay.at(distance,side),bay.across,2.6,2.65,1.03,source);
    for (const point of columns) add(`dining-column-${point}`,2,'column',point,[1,0],.8,.8,3.3,source);
  }
  if (building.id === PHOTO_INTERIOR_IDS[1]) {
    add('observatory-reflector',6,'telescope',[-5.25,132.5],[.05,-1],1.7,2.25,4.8,PHOTO_INTERIOR_EVIDENCE[1].photoId);
    add('observatory-side-table',6,'side-table',[-2.9,134.7],[1,0],1.15,.65,.78,PHOTO_INTERIOR_EVIDENCE[1].photoId);
  }
  if (building.id === PHOTO_INTERIOR_IDS[2]) {
    const layout = laboratoryLayout(building), a = layout.at(0,0), b = layout.at(1,0), axis: Point = [b[0]-a[0],b[1]-a[1]];
    const walls = [...layout.walls, layout.stair.opening];
    // Thin artworks are on a classroom-side wall, clear of the garage opening.
    const garage = [...(building.groundFloorOpenings || []), ...(building.groundPassages || []).map(passageShape)];
    add('art-wall-panel',1,'art-panel',layout.at(58,3.8),axis,3.6,.1,2.15,PHOTO_INTERIOR_EVIDENCE[4].photoId,garage);
    add('leaning-canvas',1,'canvas',layout.at(60.5,4),axis,1.2,.35,1.6,PHOTO_INTERIOR_EVIDENCE[4].photoId,garage);
    add('paint-pots',1,'paint-pots',layout.at(62,4),axis,1.15,.5,.36,PHOTO_INTERIOR_EVIDENCE[4].photoId,garage);
    add('art-gallery-red-pipe',1,'red-pipe',layout.at(57.8,4),axis,8.7,.12,3.3,PHOTO_INTERIOR_EVIDENCE[4].photoId);
    for (let i=0;i<4;i++) add(`gallery-barrel-seat-${i}`,1,'barrel-seat',layout.at(29.4+i*1.6,14.85),axis,.8,.8,.85,PHOTO_INTERIOR_EVIDENCE[5].photoId,walls);
    add('balcony-approach-ceiling',6,'slat-ceiling',layout.at(57.8,13.2),axis,12,2.35,3.35,PHOTO_INTERIOR_EVIDENCE[2].photoId);
    add('balcony-space-frame',6,'space-frame',layout.at(layout.circleU,23),axis,12.3,5.8,3.3,PHOTO_INTERIOR_EVIDENCE[3].photoId);
    for (const [i,u] of [layout.circleU-5.6,layout.circleU+5.6].entries()) add(`balcony-folded-umbrella-${i}`,6,'umbrella',layout.at(u,23),axis,.5,.5,2.35,PHOTO_INTERIOR_EVIDENCE[3].photoId,walls);
  }
  if (building.id === PHOTO_INTERIOR_IDS[3]) {
    const a: Point = [30.809226250687292,-45.18263028622997], b: Point = [69.18855840366079,-51.27513535610975];
    const f = frame(a,[b[0]-a[0],b[1]-a[1]]), source = PHOTO_INTERIOR_EVIDENCE[6].photoId;
    // Furniture is attached to the outer wall side. The other side of the
    // three-metre gallery stays open; the bench never follows the photo pose.
    add('theatre-window-steps',5,'window-steps',f.at(31.8,-2.25),f.along,4.7,1.05,.54,source);
    add('theatre-orange-bench',5,'bench',f.at(25.55,-2.4),f.along,2.4,.58,.87,source);
    add('theatre-fire-case',5,'fire-case',f.at(24.05,-2.42),f.along,.5,.4,.65,source);
    for (let i=0;i<5;i++) add(`theatre-gallery-exhibit-${i}`,5,'exhibit',f.at(7+i*3.7,-1.9),f.along,1.1,.08,1.85,PHOTO_INTERIOR_EVIDENCE[7].photoId);
    add('theatre-gallery-light-track',5,'light-track',f.at(16,-1.1),f.along,17,.15,3.28,PHOTO_INTERIOR_EVIDENCE[7].photoId);
  }
  return items;
}

export function photoInteriorGeometry(building: Building, height: number, floorHeight: number, cutawayHeight?: number) {
  const vertices = Object.fromEntries(Object.keys(PHOTO_INTERIOR_COLORS).map(kind => [kind, [] as number[]])) as Record<Kind,number[]>;
  const shown = Math.min(height, cutawayHeight ?? height), floorY = (floor: number) => .12 + (floor-1)*floorHeight + .25;
  let limit=.12+shown;
  const ceilingY = (floor: number) => .12 + floor * floorHeight - .25;
  const append = (kind: Kind, geometry: THREE.BufferGeometry, transform?: THREE.Matrix4) => {
    if (transform) geometry.applyMatrix4(transform);
    const p=geometry.getAttribute('position'), index=geometry.index;
    for(let i=0;i<(index?.count??p.count);i++) {const j=index?index.getX(i):i;vertices[kind].push(p.getX(j),Math.min(p.getY(j),limit),p.getZ(j));}
    geometry.dispose();
  };
  for(const item of photoInteriorPlacements(building)) {
    const base=floorY(item.floor), f=frame(item.center,item.axis), floorTop=item.floor*floorHeight;
    if(base>=.12+shown || floorTop>height+.001) continue;
    const observatory=item.kind==='telescope'&&cutawayHeight===undefined?dormitoryObservatory(building,floorHeight):undefined;
    limit=observatory?.radius ? .12+height+observatory.drumRise+floorHeight*.73 : .12+shown;
    const overhead=item.kind==='slat-ceiling'||item.kind==='light-track'||item.kind==='space-frame'||item.kind==='red-pipe';
    if(overhead && cutawayHeight!==undefined && cutawayHeight<=floorTop+.001) continue;
    const matrix=(point: Vector) => new THREE.Matrix4().makeBasis(new THREE.Vector3(f.along[0],0,f.along[1]),new THREE.Vector3(0,1,0),new THREE.Vector3(f.across[0],0,f.across[1])).setPosition(...point);
    const pos=(u:number,v:number,y:number):Vector=>{const p=f.at(u,v);return[p[0],base+y,p[1]];};
    const box=(kind:Kind,u:number,v:number,y:number,length:number,width:number,tall:number)=>{
      const top=Math.min(base+y+tall/2,limit),bottom=base+y-tall/2;if(top<=bottom)return;
      append(kind,new THREE.BoxGeometry(length,top-bottom,width),matrix(pos(u,v,(top+bottom)/2-base)));
    };
    const cylinder=(kind:Kind,u:number,v:number,y:number,radius:number,tall:number,segments=12)=>append(kind,new THREE.CylinderGeometry(radius,radius,tall,segments,1),matrix(pos(u,v,y)));
    const bar=(kind:Kind,a:Vector,b:Vector,radius:number)=>{
      const direction=new THREE.Vector3(...b).sub(new THREE.Vector3(...a)),g=new THREE.CylinderGeometry(radius,radius,direction.length(),6,1);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize()));g.translate(...new THREE.Vector3(...a).add(new THREE.Vector3(...b)).multiplyScalar(.5).toArray());append(kind,g);
    };
    if(item.kind==='dining-set') {
      box('green',0,0,.75,2.5,1.05,.065);
      for(const u of [-.95,.95]) for(const v of [-.35,.35]) box('wood',u,v,.375,.08,.08,.72);
      for(const u of [-.88,0,.88]) for(const v of [-1.05,1.05]) {
        const kind=u<0?'orange':u===0?'stone':'green';
        box(kind,u,v,.44,.46,.47,.065);box(kind,u,v+Math.sign(v)*.205,.72,.46,.065,.46);
        for(const x of [-.18,.18]) for(const z of [-.17,.17]) box('wood',u+x,v+z,.21,.05,.05,.4);
      }
    } else if(item.kind==='column') cylinder('stone',0,0,(ceilingY(item.floor)-base)/2,.39,ceilingY(item.floor)-base);
    else if(item.kind==='telescope') {
      cylinder('stone',0,0,.65,.35,1.3);box('stone',0,0,1.44,1.1,.7,.34);
      for(const u of [-.53,.53]) box('stone',u,0,2.1,.15,.52,1.44);
      // Open reflector tube: two black rings and thin truss struts, not a solid
      // cylinder. The sloping optical axis is estimated from _DSC9853.
      const rear=pos(0,.52,2.12),front=pos(0,-.78,4.28),direction=new THREE.Vector3(...front).sub(new THREE.Vector3(...rear)).normalize();
      const rotation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),direction);
      for(const center of [rear,front]) {const ring=new THREE.TorusGeometry(.37,.055,6,24);ring.applyQuaternion(rotation);ring.translate(...center);append('dark',ring);}
      const mirror=new THREE.CylinderGeometry(.355,.355,.09,24);mirror.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),direction));mirror.translate(...rear);append('dark',mirror);
      const x=new THREE.Vector3(f.along[0],0,f.along[1]),radial=new THREE.Vector3().crossVectors(direction,x).normalize();
      for(let i=0;i<4;i++) {const r=x.clone().multiplyScalar(Math.cos(i*Math.PI/2)*.3).addScaledVector(radial,Math.sin(i*Math.PI/2)*.3);bar('metal',new THREE.Vector3(...rear).add(r).toArray() as Vector,new THREE.Vector3(...front).add(r).toArray() as Vector,.022);}
      box('dark',.33,-.6,4.37,.18,.3,.14);
    } else if(item.kind==='side-table') {
      box('wood',0,0,.73,item.length,item.width,.075);for(const u of [-.45,.45])for(const v of [-.22,.22])box('wood',u,v,.35,.05,.05,.69);
      box('dark',-.25,0,.84,.28,.2,.13);
    } else if(item.kind==='slat-ceiling') {
      const y=ceilingY(item.floor)-base-.12;
      for(let u=-5.8;u<=5.8;u+=.36)box('wood',u,0,y,.15,2.32,.11);
      const points=[[-5.4,-.62],[-2.8,-.62],[-1.1,.5],[1.6,.5],[3.2,-.62],[5.4,-.62]];
      for(let i=1;i<points.length;i++)bar('lights',pos(points[i-1][0],points[i-1][1],y-.1),pos(points[i][0],points[i][1],y-.1),.035);
    } else if(item.kind==='umbrella') {
      box('dark',0,0,.08,.48,.48,.16);cylinder('metal',0,0,1.05,.02,2.1,6);
      const umbrella=new THREE.ConeGeometry(.24,1.4,8);append('dark',umbrella,matrix(pos(0,0,1.6)));
    } else if(item.kind==='space-frame') {
      const y=ceilingY(item.floor)-base-.12;
      for(let u=-6;u<=6;u+=2) {
        bar('metal',pos(u,-2.8,y),pos(u,2.8,y),.042);
        if(u<6) for(const v of [-2.8,0,2.8]) {
          bar('metal',pos(u,v,y),pos(u+2,v,y),.042);
          const hub=pos(u+1,v<2.8?v+1.4:v-1.4,y-.48);
          bar('metal',pos(u,v,y),hub,.032);bar('metal',hub,pos(u+2,v,y),.032);
        }
      }
    } else if(item.kind==='art-panel') {
      box('purple',0,0,1.23,3.6,.08,1.7);
      // Graphic patches indicate the observed painted panel without reproducing
      // the mural or inventing exhibition text.
      for(const [u,y] of [[-1.2,1.5],[-.5,.95],[.2,1.6],[1,1.1]]) box('blue',u,-.045,y,.5,.025,.5);
    } else if(item.kind==='canvas') {
      box('wood',0,0,.76,1.18,.11,1.45);box('stone',0,-.07,.76,1.08,.025,1.35);
      box('purple',-.14,-.09,.83,.48,.02,.75);
    } else if(item.kind==='paint-pots') {
      for(let i=0;i<5;i++) {const u=-.46+i*.23;cylinder(i%2?'blue':'stone',u,0,.13,.09,.25,10);cylinder('dark',u,0,.262,.088,.016,10);}
    } else if(item.kind==='barrel-seat') {
      cylinder('stone',0,0,.22,.38,.44,16);cylinder('blue',0,0,.45,.34,.04,16);
      for(let i=0;i<8;i++) {const t=Math.PI*i/7;box('blue',Math.cos(t)*.33,Math.sin(t)*.33,.66,.12,.09,.42);}
    } else if(item.kind==='window-steps') {
      for(let i=0;i<3;i++)box('stone',0,.35-i*.35,(i+1)*.18/2,item.length,.35,(i+1)*.18);
    } else if(item.kind==='red-pipe') {
      const y=ceilingY(item.floor)-base-.15;
      bar('red',pos(-4.3,0,y),pos(4.3,0,y),.055);
      for(const u of [-3,-1,1,3])box('metal',u,0,y+.085,.04,.12,.14);
    } else if(item.kind==='bench') {
      box('wood',0,0,.2,2.35,.55,.3);box('orange',0,0,.41,2.4,.58,.13);box('orange',0,-.25,.65,2.4,.12,.44);
    } else if(item.kind==='fire-case') {box('red',0,0,.33,.48,.35,.65);box('stone',0,.18,.38,.28,.016,.24);}
    else if(item.kind==='exhibit') {box('wood',0,0,1.3,1.1,.055,1.1);box('stone',0,.036,1.3,1,.018,1);box('blue',0,.05,1.3,.63,.008,.73);}
    else if(item.kind==='light-track') {
      const y=ceilingY(item.floor)-base-.13;box('dark',0,0,y,item.length,.1,.055);
      for(let u=-7;u<=7;u+=2.8){box('dark',u,0,y-.16,.18,.16,.2);box('lights',u,.02,y-.27,.14,.13,.025);}
    }
  }
  // A thin wood finish is clipped to the already modelled balcony slab. It
  // introduces no new floor bridge, room wall, external projection or doorway.
  if(building.id===PHOTO_INTERIOR_IDS[2] && shown>5*floorHeight+.25 && height>=6*floorHeight) {
    const layout=laboratoryLayout(building), a=layout.at(0,0), b=layout.at(1,0), f=frame(layout.at(layout.circleU,23),[b[0]-a[0],b[1]-a[1]]);
    const finish=rectangle(f,12.5,6), polygons=polygonClipping.intersection(snapFootprint([[finish.outer]]),snapFootprint([[layout.walkways[1].outer]]));
    for(const [outer,...holes] of polygons) {const g=buildingGeometry({outer:outer as Point[],holes:holes as Point[][]},.018,floorHeight);g.rotateX(-Math.PI/2);g.translate(0,floorY(6)+.005,0);append('wood',g);}
  }
  return Object.entries(vertices).filter(([,p])=>p.length).map(([kind,p])=>{
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geometry.computeVertexNormals();geometry.computeBoundingSphere();
    geometry.userData.photoOcclusionMask=new Uint8Array(p.length/9);return{kind:kind as Kind,geometry};
  });
}
