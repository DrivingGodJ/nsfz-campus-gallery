import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cropDepthPixels, depthMapFileName, depthMapFrameRect, renderDepthPixels, DEPTH_MAP_RANGE_METERS } from '../src/depth-map.ts';
import { photoCameraPose } from '../src/photo-camera.ts';
import { photoFieldOfView } from '../src/photo-view.ts';
import { photoFrameSize } from '../src/photo-perspective.ts';
import { FULL_MAP_VIEWPORT } from '../src/map-card-viewport.ts';

const close = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} ~= ${b}`);
const shot = (width, height) => ({ id: 'depth-fixture', title: '校园视角', width, height, heading: 125, pitch: -18, position: { x: 10, z: -25 }, metadata: { focalLength35Mm: 35 } });

test('the exported crop is exactly the field of view the photo camera framed', () => {
  const canvas = { width: 1200, height: 900 };
  const viewports = [FULL_MAP_VIEWPORT, { left: .35, top: 0, width: .65, height: 1 }, { left: 0, top: .2, width: 1, height: .8 }];
  for (const viewport of viewports) for (const photo of [shot(4000, 3000), shot(3000, 4000), shot(2000, 2000), shot(6000, 2000)]) {
    const rect = depthMapFrameRect(photo, viewport, canvas.width, canvas.height);
    close(rect.width / rect.height, photo.width / photo.height, .01);
    // photoCameraPose divides the lens angle by the frame height measured against
    // the whole canvas, so deriving it back from the crop must reproduce its fov.
    const viewportAspect = viewport.width * canvas.width / (viewport.height * canvas.height);
    const fraction = photoFrameSize(photo.width / photo.height, viewportAspect).height * viewport.height;
    const view = photoFieldOfView(photo);
    const expected = 2 * Math.atan(Math.tan(view.vertical * Math.PI / 360) / fraction) * 180 / Math.PI;
    close(photoCameraPose(photo, 1.6, canvas.width / canvas.height, viewport).fov, expected, 1e-9);
    assert.ok(Math.abs(rect.height / canvas.height - fraction) * canvas.height <= .5,
      'the rounded crop keeps the exact framing within one pixel');
    assert.ok(rect.x >= Math.floor(viewport.left * canvas.width) - 1, 'the crop stays inside the exposed map area');
    assert.ok(rect.x + rect.width <= Math.ceil((viewport.left + viewport.width) * canvas.width) + 1);
    assert.ok(rect.y >= Math.floor(viewport.top * canvas.height) - 1);
    assert.ok(rect.y + rect.height <= Math.ceil((viewport.top + viewport.height) * canvas.height) + 1);
  }
});

test('the crop flips the bottom-up readback and clips to the source', () => {
  const source = new Uint8ClampedArray(4 * 3 * 4);
  for (let row = 0; row < 3; row++) for (let column = 0; column < 4; column++) {
    const index = (row * 4 + column) * 4;
    source[index] = source[index + 1] = source[index + 2] = row * 10 + column;
    source[index + 3] = 255;
  }
  const cropped = cropDepthPixels(source, 4, 3, { x: 1, y: 0, width: 2, height: 2 });
  assert.equal(cropped.width, 2); assert.equal(cropped.height, 2);
  assert.deepEqual([...cropped.pixels], [21, 21, 21, 255, 22, 22, 22, 255, 11, 11, 11, 255, 12, 12, 12, 255]);
  const clipped = cropDepthPixels(source, 4, 3, { x: 3, y: 1, width: 9, height: 9 });
  assert.equal(clipped.width, 1); assert.equal(clipped.height, 2);
  assert.deepEqual([...clipped.pixels], [13, 13, 13, 255, 3, 3, 3, 255]);
});

test('the depth file name follows the photo and survives missing or unsafe titles', () => {
  assert.equal(depthMapFileName('DSC06870'), 'DSC06870-深度图.png');
  assert.equal(depthMapFileName('  东区四楼  '), '东区四楼-深度图.png');
  assert.equal(depthMapFileName('a/b:c*d?'), 'a_b_c_d_-深度图.png');
  assert.equal(depthMapFileName('   '), '校园-深度图.png');
});

test('the depth pass reuses the live renderer, leaves the scene untouched and restores the target', () => {
  const calls = [];
  const renderer = {
    capabilities: { logarithmicDepthBuffer: true },
    getDrawingBufferSize: target => target.set(8, 4),
    getRenderTarget: () => 'map-target',
    setRenderTarget: target => calls.push(['setRenderTarget', target,
      target?.depthTexture ? { isDepth: target.depthTexture.isDepthTexture, width: target.depthTexture.image.width } : null]),
    render: (scene, camera) => calls.push(['render', scene, camera]),
    readRenderTargetPixels: (target, x, y, width, height, buffer) => { calls.push(['read', target, width, height]); buffer.fill(128); },
  };
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(43, 2, .08, 4000);
  camera.position.set(10, 1.6, -25);
  const before = { near: camera.near, far: camera.far, position: camera.position.clone(), children: scene.children.length, override: scene.overrideMaterial };
  const rendered = renderDepthPixels({ renderer, scene, camera, logarithmic: true });
  assert.equal(rendered.width, 8); assert.equal(rendered.height, 4);
  assert.equal(rendered.pixels.length, 8 * 4 * 4); assert.equal(rendered.pixels[0], 128);
  assert.equal(calls.length, 6, 'two passes, one readback and the restored target');
  const [first, second, third, fourth, fifth, sixth] = calls;
  assert.equal(first[0], 'setRenderTarget'); assert.ok(first[1] instanceof THREE.WebGLRenderTarget);
  assert.deepEqual(first[2], { isDepth: true, width: 8 }, 'the depth pass renders into a depth attachment');
  assert.deepEqual([second[0], second[1], second[2]], ['render', scene, camera]);
  assert.equal(third[2], null, 'the quad pass renders into a plain colour target');
  assert.equal(fourth[0], 'render'); assert.equal(fourth[2].isOrthographicCamera, true);
  assert.deepEqual([fifth[0], fifth[2], fifth[3]], ['read', 8, 4]); assert.equal(fifth[1], third[1]);
  assert.deepEqual([sixth[0], sixth[1]], ['setRenderTarget', 'map-target'], 'the previous target comes back');
  assert.equal(scene.overrideMaterial, before.override); assert.equal(scene.children.length, before.children);
  assert.equal(camera.near, before.near); assert.equal(camera.far, before.far); assert.ok(camera.position.equals(before.position));
  assert.equal(DEPTH_MAP_RANGE_METERS, 300);
});

test('the quad shader decodes both the logarithmic and the plain depth attachment', () => {
  const materials = [], renderer = {
    getDrawingBufferSize: target => target.set(2, 2),
    getRenderTarget: () => null,
    setRenderTarget() {}, readRenderTargetPixels() {},
    render: scene => { const mesh = scene.children[0]; if (mesh?.isMesh) materials.push(mesh.material); },
  };
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(43, 2, .08, 4000);
  renderDepthPixels({ renderer, scene, camera, logarithmic: true, range: 120 });
  renderDepthPixels({ renderer, scene, camera, logarithmic: false });
  assert.equal(materials[0].uniforms.logarithmic.value, true);
  assert.equal(materials[0].uniforms.depthRange.value, 120);
  assert.equal(materials[0].uniforms.depthNear.value, camera.near);
  assert.equal(materials[0].uniforms.depthFar.value, camera.far);
  assert.equal(materials[1].uniforms.logarithmic.value, false);
  assert.equal(materials[1].uniforms.depthRange.value, DEPTH_MAP_RANGE_METERS);
  assert.match(materials[0].fragmentShader, /pow\(depthFar \+ 1\.0, z\) - 1\.0/);
  assert.match(materials[0].fragmentShader, /clamp\(distance \/ depthRange, 0\.0, 1\.0\)/);
});
