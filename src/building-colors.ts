import * as THREE from 'three';
import type { Building, Shape } from './types';

export type BuildingColors = {
  body: string; trim?: string; roof?: string; frame?: string; glass?: string; rail?: string; brick?: string; metal?: string; base?: string;
  tierBlue?: string; tierRed?: string; tierGreen?: string; skylightFrame?: string; roofGlass?: string; court?: string; drum?: string; canopyUnderside?: string;
  annexGlass?: string; annexFrame?: string; canopyGlass?: string;
};

// Each entry belongs to an identified building with a photo reference. Missing
// materials keep their existing finish rather than borrowing a category color.
export const BUILDING_COLOR_PROFILES: Readonly<Record<string, BuildingColors>> = {
  // Photos f5acf721-c782-4eb7-a3b2-5e1d17e7dafd, eeeb7f00-9aab-4dc1-bb0f-db42fa067465.
  'way/855459420': { body: '#e2ded3', trim: '#e2ded3', frame: '#c4c7bf', rail: '#168bbc', glass: '#95b8b9', roofGlass: '#95b8b9', skylightFrame: '#bfc3bf' },
  // Photos 252d968f-08a5-4ec9-9d27-c52017da3348, fbff44f9-92aa-4a4f-b4c4-d4401e30ff3c; brick only on the western curve.
  'way/1233313430': { body: '#e1ded4', trim: '#e1ded4', brick: '#a77962', frame: '#354b50', glass: '#94b9be' },
  // Photos 6deb58ad-debc-4321-bdfb-d21c2d83fb97, 446107a7-73ac-4415-b8b1-41ad81f04330; 34868811-15fa-4147-ac2e-f4e1278dc2f4 confirms green annex glass and the entry canopy.
  'way/855459419': { body: '#b66d56', base: '#9b9c96', brick: '#b66d56', frame: '#e2e3da', trim: '#e0e0d7', metal: '#c5cbc5', glass: '#aec2c0', annexGlass: '#183d32', annexFrame: '#354b43', canopyGlass: '#b1c8bf' },
  // Photos af300476-2620-4026-a4b0-72f82d827f63, b3a57e0f-5806-43b8-b4ee-38336837f18d; roof excludes the pale observatory dome.
  'way/1233313434': { body: '#8a8e88', trim: '#d3d4c8', brick: '#b87c65', frame: '#263f3b', roof: '#4b5358', glass: '#849c94', rail: '#646d66', metal: '#adb7ae' },
  // Photos 622e02bd-0ee1-4841-98c7-6683a600f42e, 5fab16c1-c9f2-41fb-8609-74bd75117734.
  'way/1233313431': { body: '#a0a196', trim: '#d5d4c7', brick: '#bb8969', frame: '#384543', roof: '#5d6662', glass: '#8aa9aa', rail: '#5c6c63' },
  // Photos 88c65cc9-1f8f-4383-8ffb-f446bdc663dd, 5b3b44fb-616c-492c-82d0-4a2368792e7b (court/metal).
  'local/gymnasium': { body: '#d3b5a4', trim: '#e1d4c7', roof: '#b3b7b4', frame: '#414c50', glass: '#5d8893', rail: '#939b9d', metal: '#b5bbb6', court: '#ba954e' },
  // Photos 69774c0e-73b0-47e6-ad38-b6bac69d6f5f, 96ec0f44-3cbd-4ea6-9f6e-161bfd40650a.
  'way/855459409': { body: '#e6e2dc', trim: '#dfded5', frame: '#8e9698', glass: '#748487', roof: '#c7c6c1', rail: '#939b9d', tierBlue: '#4280ae', tierRed: '#b24c36', tierGreen: '#617957', canopyUnderside: '#977b69' },
  // Photos 2fd556c9-9281-475e-ac98-18775ad99aba (striped upper drum), c4980ac9-8ff8-485b-9564-20c48356c2c4.
  'local/theatre': { body: '#dfded6', trim: '#d9dcd5', glass: '#829996', frame: '#aab5b2', rail: '#90999b', roof: '#bfc7c4', drum: '#47525e' },
  // Photo 8904ca53-186b-44ac-b32b-6603b313e39b confirms the top wall/canopy; continuing the grey finish below is an estimate.
  'way/855459411': { body: '#9b9d96', trim: '#d6d7ce', frame: '#4b5554', glass: '#b4cdcf', rail: '#8c9794', roofGlass: '#b4cdcf', skylightFrame: '#a4b6b8' },
  // Photos ff6b8d02-73d4-4a82-9e78-049c5e53c456, 2669769a-31d5-4200-a7e2-9a441c66e533.
  'way/1277841229': { body: '#e0d9c6', roof: '#558398', trim: '#e8e4d4', frame: '#bdc3ba', glass: '#91aaa6' },
  // Photo b1cead6f-c073-41d3-94ea-2ff1b2513b8e.
  'local/print-room': { body: '#8b8478', roof: '#a66147', trim: '#c6bfb0' },
  // Photos a0e17620-7437-42cf-92f2-1d7d23e20842, 3ec87b74-432c-47c8-b2a8-0dbe917e10de; snowy roof keeps existing red tile estimate.
  'way/855459421': { body: '#83898b', roof: '#a05d46', trim: '#c2c5c0', frame: '#394448' },
  // Photo 8cf1e176-fe09-4c3b-9e04-a84286f36f4e.
  'local/boundary-house': { body: '#85857e', roof: '#454846', trim: '#c1c0b5' },
  // Photos 525b0ee9-3c28-4aba-a858-a252576ed315, c5b1d50b-f8f9-4412-b537-3a98be44bcea.
  'way/1233313451': { body: '#bcb7ad', trim: '#c8cbc3', frame: '#adb9b4', glass: '#87aaa5', roofGlass: '#87aaa5', roof: '#777d7d' },
};

export function buildingColors(building: Pick<Building, 'id'> | string): BuildingColors | undefined {
  return BUILDING_COLOR_PROFILES[typeof building === 'string' ? building : building.id];
}

export function buildingMaterialColor(building: Pick<Building, 'id'> | string, kind: keyof BuildingColors, fallback: string, mapColor: (color: string) => string) {
  return buildingColors(building)?.[kind] ?? mapColor(fallback);
}

// Material groups leave the approved geometry and triangle order intact,
// including the photo occlusion mask. Only the top cap is a roof finish.
export function buildingRoofMaterials(geometry: THREE.BufferGeometry, roof = true) {
  const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal'), index = geometry.getIndex();
  if (!positions?.count || !normals) return geometry;
  const count = index?.count ?? positions.count;
  let top = -Infinity;
  for (let i = 0; i < positions.count; i++) top = Math.max(top, positions.getZ(i));
  geometry.clearGroups();
  let start = 0, current = -1;
  for (let i = 0; i < count; i += 3) {
    const vertices = [0, 1, 2].map(j => index ? index.getX(i + j) : i + j);
    const material = roof && vertices.every(vertex => positions.getZ(vertex) >= top - .001 && normals.getZ(vertex) > .5) ? 1 : 0;
    if (material !== current) {
      if (current >= 0) geometry.addGroup(start, i - start, current);
      start = i; current = material;
    }
  }
  geometry.addGroup(start, count - start, current);
  return geometry;
}

// Photo 2fd556c9-9281-475e-ac98-18775ad99aba shows ~1/3 dark piers,
// ~2/3 pale panels and an upper dark band ~1/5 of the drum height. The
// 3.3 m repeat is a model estimate, not a measured facade dimension.
export function theatreDrumTexture(body: string, drum: string) {
  const width = 128, height = 64, data = new Uint8Array(width * height * 4);
  const light = new THREE.Color(body).getHex(THREE.SRGBColorSpace), dark = new THREE.Color(drum).getHex(THREE.SRGBColorSpace);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const color = x < 43 || y >= height - 12 ? dark : light, offset = (y * width + x) * 4;
    data.set([color >> 16 & 255, color >> 8 & 255, color & 255, 255], offset);
  }
  const texture = new THREE.DataTexture(data, width, height);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

// Only reassign the existing upper exterior wall triangles. Position, normal,
// triangle order and photo occlusion masks remain unchanged, including cuts.
export function theatreDrumMaterials(geometry: THREE.BufferGeometry, section: Shape & { id: string }, floorHeight: number, building?: Building) {
  if (section.id !== 'main') return geometry;
  const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal'), index = geometry.getIndex();
  if (!positions?.count || !normals) return geometry;
  const bottom = 4 * floorHeight, repeat = 3.3, uv = geometry.getAttribute('uv');
  const coordinates = uv ? Float32Array.from(uv.array) : new Float32Array(positions.count * 2);
  let distance = 0;
  const terrace = building?.parts?.find(part => part.id === 'curved-terrace');
  const arc = terrace ? terrace.outer.slice(terrace.roofTerrace!.railEdges[0].length + 4, -1) : section.outer.slice(9, 20);
  const edges = arc.slice(0, -1).map((from, i) => {
    const to = arc[i + 1], dx = to[0] - from[0], dz = to[1] - from[1], length = Math.hypot(dx, dz), start = distance;
    distance += length;
    return { from, dx, dz, length, start };
  });
  const groups = geometry.groups.slice(), count = index?.count ?? positions.count;
  geometry.clearGroups();
  let start = 0, current = -1, groupIndex = 0;
  for (let i = 0; i < count; i += 3) {
    while (groupIndex + 1 < groups.length && i >= groups[groupIndex].start + groups[groupIndex].count) groupIndex++;
    let material = groups[groupIndex]?.materialIndex ?? 0;
    const vertices = [0, 1, 2].map(j => index ? index.getX(i + j) : i + j);
    const upperWall = vertices.every(v => positions.getZ(v) >= bottom - .001 && Math.abs(normals.getZ(v)) < .1)
      && vertices.some(v => positions.getZ(v) > bottom + .001);
    if (upperWall) {
      const edge = edges.find(edge => vertices.every(v => {
        const dx = positions.getX(v) - edge.from[0], dz = -positions.getY(v) - edge.from[1];
        const along = (dx * edge.dx + dz * edge.dz) / edge.length;
        return along >= -.002 && along <= edge.length + .002 && Math.abs(dx * edge.dz - dz * edge.dx) / edge.length < .002;
      }));
      if (edge) {
        material = 2;
        for (const v of vertices) {
          const along = ((positions.getX(v) - edge.from[0]) * edge.dx + (-positions.getY(v) - edge.from[1]) * edge.dz) / edge.length;
          coordinates[v * 2] = (edge.start + along) / repeat;
          coordinates[v * 2 + 1] = (positions.getZ(v) - bottom) / (2 * floorHeight);
        }
      }
    }
    if (material !== current) {
      if (current >= 0) geometry.addGroup(start, i - start, current);
      start = i; current = material;
    }
  }
  geometry.addGroup(start, count - start, current);
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(coordinates, 2));
  return geometry;
}
