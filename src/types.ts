import { buildingLevels } from './building-model';
import { photoLocationText } from './locations';
import { assetURL } from './asset-url';

export type Point = [number, number];
export type Shape = { outer: Point[]; holes: Point[][] };
export type BuildingPart = Shape & { id: string; name: string; floors?: number; roofTerrace?: { railEdges: Point[][] } };
export type GlassPavilion = { type: 'glass-pavilion'; center: Point; radius: number; canopyRadius: number; canopyStartAngle: number; canopySweep: number; rearDepth?: number };
export type GroundPassage = { id: string; sourcePathId: string; points: Point[]; width: number };
export type FloorCorridor = { partId: string; depth: number; startFloor?: number; footprint?: Shape; slabInfill?: Shape; railEdges?: Point[][] } & ({ edge: number } | { edges: number[] } | { holeIndex: number } | { passageIndex: number } | { points: Point[] });
export type ClassroomWindows = { wallThickness: number; bayWidth: number; windowWidth: number; sill: number; top: number; columns: number; transom: number; facadeLines?: Point[][]; pierWidth?: number; startFloor?: number; endFloor?: number; frameColor?: string; transomFractions?: number[]; upperColumns?: number };
export type BuildingSolidCore = Shape & { partId: string; startFloor?: number; classroomWindows?: ClassroomWindows; elevator?: { doorEdge: number } };
export type FacadeAnchor = { edge: number; at: number };
export type BuildingFacade = { type: 'dormitory' | 'cafeteria' | 'laboratory' | 'boundary-house' | 'print-room' | 'luxun-memorial'; connectionWall?: Point[]; upperConnectionWall?: Point[]; entry?: FacadeAnchor; frontCurve?: { start: FacadeAnchor; end: FacadeAnchor }; lowerBay?: { start: FacadeAnchor; end: FacadeAnchor; projection: number } };
export type BuildingSkylight = { partId: string; holeIndex?: number; outline?: 'outer'; opacity?: number; columns?: number; rows?: number };
export type BuildingStairwell = { partId: string; origin: Point; axis: Point; width: number; run: number; landingDepth: number; stepsPerFlight: number; opening: Shape; firstFlight?: 'left' | 'right'; internal?: boolean; entry?: { edge: number; depth: number; steps: number } };
export type Building = Shape & { id: string; osmId: number | null; osmType: string; name: string; category: string; center: Point; floors: number | null; floorHeight?: number; baseElevation?: number; sourceBuildingIds?: string[]; calibrated?: boolean; parts?: BuildingPart[]; appearance?: GlassPavilion; facade?: BuildingFacade; groundPassages?: GroundPassage[]; groundFloorOpenings?: Shape[]; floorCorridors?: FloorCorridor[]; skylights?: BuildingSkylight[]; stairwells?: BuildingStairwell[]; classroomWindows?: ClassroomWindows; solidCores?: BuildingSolidCore[]; cutouts?: (Shape & { partId: string })[] };
export type CurvedStair = { center: Point; radius: number; startAngle: number; sweep: number; width: number; steps: number; topHeight: number; bottomHeight: number };
export type PassageStair = { from: Point; to: Point; width: number; steps: number; topHeight: number; bottomHeight: number; doorHeight: number };
export type BridgeConnection = { id: string; type: 'deck' | 'stairs'; points: Point[]; buildingId?: string; floor?: number; groundHeight?: number; midLanding?: number };
export type RunningTrack = { center: Point; axis: Point; halfStraight: number; innerRadius: number; laneWidth: number; lanes: number; pitchLength: number; pitchWidth: number };
export type BasketballLayout = { center: Point; axis: Point; length: number; width: number; count: number; gap: number };
export type GateLandmark = { kind: 'gate-monument' | 'bell-tower'; center: Point; axis: Point; width: number; depth: number; totalHeight: number };
export type LakePavilion = { center: Point; axis: Point; span: number; roofSpan: number; postHeight: number; roofRise: number };
export type WisteriaPergola = { hub: Point; hubRadius: number; hubAxis?: Point; hubStagger?: number; hubGap?: number; floors: number; floorHeight: number };
export type MottoStoneModel = { center: Point; axis: Point; width: number; depth: number; totalHeight: number; inscription: string };
export type FlagPlatformModel = { center: Point; axis: Point; width: number; depth: number; platformHeight: number; poleHeight: number; steps: number };
export type WaterfallGarden = { center: Point; axis: Point; height: number; width: number; bamboo: Point[] };
export type BaJinStatueModel = { center: Point; axis: Point; width: number; depth: number; totalHeight: number };
export type Feature = Partial<Shape> & { id: string; type: 'path' | 'water' | 'sport' | 'green' | 'forest' | 'plaza' | 'trees' | 'runningTrack' | 'basketballCourts' | 'landmark' | 'mottoStone' | 'flagPlatform' | 'boardwalk' | 'lakePavilion' | 'pergola' | 'bridge' | 'garageEntrance' | 'tunnel' | 'tunnelEntrance' | 'tunnelJunction' | 'undergroundRoom' | 'undergroundCorridor' | 'undergroundTrack'; points?: Point[]; branches?: Point[][]; railEdges?: Point[][]; railHeight?: number; width?: number; height?: number; deckHeight?: number; archRise?: number; wallHeight?: number; name?: string; hideLabel?: boolean; estimated?: boolean; representedBy?: string; sourcePathIds?: string[]; connectedTo?: string[]; ramp?: { topHeight: number; bottomHeight: number }; curvedStair?: CurvedStair; entranceStair?: PassageStair; connections?: BridgeConnection[]; levelAnchor?: { buildingId: string; floor: number }; platform?: Shape; track?: RunningTrack; courts?: BasketballLayout; landmark?: GateLandmark; stone?: MottoStoneModel; flagPlatform?: FlagPlatformModel; pavilion?: LakePavilion; pergola?: WisteriaPergola; waterfall?: WaterfallGarden; statue?: BaJinStatueModel; sideNet?: { facing: Point; height: number }; trees?: { position: Point; radius: number; height: number; kind?: 'plane' | 'columnar' | 'palm' }[] };
export type Campus = {
  schemaVersion: number; name: string; origin: { lat: number; lon: number };
  boundary: Point[]; buildings: Building[]; features: Feature[];
  buildingAliases?: Record<string, string>; calibration?: { updatedAt: string; note: string };
  source: { name: string; url: string; license: string; licenseUrl: string; extractedAt: string; osmTimestamp: string };
};
export type PhotoMetadata = {
  author?: string; copyright?: string;
  recordedAt?: string; utcOffset?: string; cameraMake?: string; cameraModel?: string; lensModel?: string;
  focalLengthMm?: number; focalLength35Mm?: number; aperture?: number; exposureSeconds?: number; iso?: number;
  aerial?: { latitude?: number; longitude?: number; relativeAltitude?: number; absoluteAltitude?: number };
};
export type Photo = {
  author?: string; copyright?: string; uploadedAt?: string; depthUpdatedAt?: string; depthGenerationError?: string;
  id: string; title: string; description: string; capturedAt: string; buildingId: string; locationId?: string; floor: number;
  captureType?: 'ground' | 'aerial';
  altitude?: { meters: number; reference: 'takeoff' | 'seaLevel' };
  cameraHeight?: number; // Meters above the selected floor or ground surface; defaults to 1.6.
  // height is accepted only for old records; new ordinary photos store their floor.
  position: { x: number; z: number; height?: number }; heading: number; pitch: number; placed: boolean;
  width: number; height: number; downloadBytes: number;
  metadata?: PhotoMetadata;
  view?: { focalLength35Mm?: number; cropFactor?: number };
  files: { thumbnail: string; preview?: string; depth?: string; display: string; download: string };
};
export type BuildingOverride = { name: string; floors: number; floorHeight: number; partFloors?: Record<string, number> };
export type Site = { schemaVersion: number; revision: number; photos: Photo[]; buildingOverrides: Record<string, BuildingOverride> };
export type EditorState = { reviewImports?: {id:string;photoId:string;published:boolean;synced?:boolean;rejected?:boolean}[]; site: Site; drafts: Photo[]; map: Campus };
export const asset = (file: string) => assetURL(file, import.meta.env.BASE_URL, import.meta.env.VITE_MEDIA_BASE_URL, import.meta.env.DEV);
export function buildingInfo(building: Building, site: Site, index = 0) {
  const override = site.buildingOverrides[building.id];
  return { ...building, name: override?.name || building.name || '未命名建筑 ' + String(index + 1).padStart(2, '0'),
    ...buildingLevels(building, override) };
}
export function photoLocation(photo: Photo, campus: Campus, site: Site) {
  return photoLocationText(photo, campus, site);
}
export const captureTimeText = (value: string) => value.replaceAll('-', '.').replace('T', ' ');
export function headingText(degrees: number) {
  const words = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  return words[Math.round(degrees / 45) % 8] + ' · ' + Math.round(degrees) + '°';
}
export function sizeText(bytes: number) { return bytes > 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1) + ' MB' : Math.ceil(bytes / 1024) + ' KB'; }
export async function loadContent() {
  const [campus, site] = await Promise.all([fetch(asset('data/campus.json'), { cache: 'no-store' }), fetch(asset('data/site.json'), { cache: 'no-store' })]);
  if (!campus.ok || !site.ok) throw new Error('校园内容加载失败，请检查网络后重试。');
  return { campus: await campus.json() as Campus, site: await site.json() as Site };
}
