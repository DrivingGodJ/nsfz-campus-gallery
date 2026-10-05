import * as THREE from 'three';
import type { MapViewport } from './map-card-viewport.ts';
import { photoAspect, photoFrameSize } from './photo-perspective.ts';

// Distances beyond this clamp to white, together with the sky. The campus reads
// well inside 300 m, so the full 8-bit range stays useful from any photo point.
export const DEPTH_MAP_RANGE_METERS = 300;

export type DepthFrame = { x: number; y: number; width: number; height: number };
export type DepthPixels = { pixels: Uint8ClampedArray<ArrayBuffer>; width: number; height: number };

// The same rect the on-screen frame uses, in drawing-buffer pixels. The depth
// pass reuses the live camera, so its projection already matches this crop.
export function depthMapFrameRect(photo: { width: number; height: number }, viewport: MapViewport, width: number, height: number): DepthFrame {
  const sourceWidth = Math.max(1, width), sourceHeight = Math.max(1, height);
  const viewportWidth = Math.max(1, viewport.width * sourceWidth), viewportHeight = Math.max(1, viewport.height * sourceHeight);
  const frame = photoFrameSize(photoAspect(photo), viewportWidth / viewportHeight);
  const frameWidth = Math.max(1, Math.min(Math.round(viewportWidth), Math.round(frame.width * viewportWidth)));
  const frameHeight = Math.max(1, Math.min(Math.round(viewportHeight), Math.round(frame.height * viewportHeight)));
  return { x: Math.max(0, Math.round(viewport.left * sourceWidth + (viewportWidth - frameWidth) / 2)),
    y: Math.max(0, Math.round(viewport.top * sourceHeight + (viewportHeight - frameHeight) / 2)), width: frameWidth, height: frameHeight };
}

// readRenderTargetPixels hands back rows from the bottom, so the crop also flips.
export function cropDepthPixels(source: Uint8ClampedArray, sourceWidth: number, sourceHeight: number, frame: DepthFrame) {
  const x = Math.max(0, Math.min(frame.x, sourceWidth - 1)), y = Math.max(0, Math.min(frame.y, sourceHeight - 1));
  const width = Math.max(1, Math.min(frame.width, sourceWidth - x)), height = Math.max(1, Math.min(frame.height, sourceHeight - y));
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) {
    const sourceRow = sourceHeight - 1 - (y + row);
    if (sourceRow < 0 || sourceRow >= sourceHeight) continue;
    for (let column = 0; column < width; column++) {
      const from = (sourceRow * sourceWidth + x + column) * 4, to = (row * width + column) * 4;
      pixels[to] = source[from]; pixels[to + 1] = source[from + 1]; pixels[to + 2] = source[from + 2]; pixels[to + 3] = 255;
    }
  }
  return { pixels, width, height };
}

export const depthMapFileName = (title: string) =>
  (title.trim().replace(/[\\/:*?"<>|]/g, '_') || '校园') + '-深度图.png';

// Shared by the photo-depth overlay and the transition canvas so a missing
// rendition fails with the same message in both places.
export const loadImageElement = (url: string, message = '图片加载失败。') => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error(message));
  image.src = url;
});

// three encodes the depth attachment with the logarithmic formula whenever the
// renderer enables it: z = log2(1 + distance) / log2(far + 1), which inverts
// exactly. Without it the attachment holds the usual non-linear window depth.
const quadVertexShader = `
  varying vec2 quadUv;
  void main() { quadUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const quadFragmentShader = `
  varying vec2 quadUv;
  uniform sampler2D depthSampler;
  uniform float depthNear, depthFar, depthRange;
  uniform bool logarithmic;
  void main() {
    float z = texture2D(depthSampler, quadUv).x;
    // Sky leaves the attachment cleared at 1.0, so it lands on the far value.
    float distance = logarithmic ? pow(depthFar + 1.0, z) - 1.0
      : (2.0 * depthNear * depthFar) / (depthFar + depthNear - (2.0 * z - 1.0) * (depthFar - depthNear));
    gl_FragColor = vec4(vec3(clamp(distance / depthRange, 0.0, 1.0)), 1.0);
  }
`;

// Renders the model alone into an offscreen depth attachment and reads the
// linear distances back as a top-left grayscale image. Nothing in the scene is
// mutated: the sky dome never writes depth, and the pass only swaps the
// renderer's target, which is restored before returning.
export function renderDepthPixels({ renderer, scene, camera, logarithmic, range = DEPTH_MAP_RANGE_METERS }: {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; logarithmic: boolean; range?: number;
}): DepthPixels {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const width = Math.max(1, Math.floor(size.x)), height = Math.max(1, Math.floor(size.y));
  const target = new THREE.WebGLRenderTarget(width, height);
  const depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedIntType);
  target.depthTexture = depthTexture;
  const output = new THREE.WebGLRenderTarget(width, height);
  const material = new THREE.ShaderMaterial({
    uniforms: { depthSampler: { value: depthTexture }, depthNear: { value: camera.near }, depthFar: { value: camera.far },
      depthRange: { value: Math.max(1, range) }, logarithmic: { value: logarithmic } },
    vertexShader: quadVertexShader, fragmentShader: quadFragmentShader, depthTest: false, depthWrite: false,
  });
  const geometry = new THREE.PlaneGeometry(2, 2);
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene().add(quad);
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const previous = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(output);
    renderer.render(quadScene, quadCamera);
    const pixels = new Uint8ClampedArray(width * height * 4);
    renderer.readRenderTargetPixels(output, 0, 0, width, height, pixels);
    return { pixels, width, height };
  } finally {
    renderer.setRenderTarget(previous);
    output.dispose(); geometry.dispose(); material.dispose();
    target.depthTexture = null; depthTexture.dispose(); target.dispose();
  }
}

export function depthMapBlob(image: DepthPixels, type = 'image/png'): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error('无法创建深度图画布。'));
  context.putImageData(new ImageData(image.pixels, image.width, image.height), 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('无法导出深度图。')), type));
}

export function downloadDepthMap(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.rel = 'noopener';
  document.body.append(link); link.click(); link.remove();
  // Revoke on the next task so the download has started.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
