import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

// Depth Anything V2 Small, converted to ONNX by the Transformers.js team
// (Apache-2.0, both the code and the weights). Chosen because it is an existing,
// actively maintained monocular depth model with ready-made ONNX weights and a
// first-party JavaScript runner, so nothing here reimplements depth estimation.
export const PHOTO_DEPTH_MODEL = 'onnx-community/depth-anything-v2-small';
export const PHOTO_DEPTH_FILE = 'depth.webp';

// The weights are a build-time dependency of the maintainer's machine, never of
// the published site: they live in gitignored .local/models and the script that
// uses them fails loudly when they are missing. Suffixes follow the library's
// DEFAULT_DTYPE_SUFFIX_MAPPING (src/utils/dtypes.js:59).
const DTYPE_FILES = {
  fp32: 'model.onnx', fp16: 'model_fp16.onnx', q8: 'model_quantized.onnx',
  int8: 'model_int8.onnx', uint8: 'model_uint8.onnx', q4: 'model_q4.onnx',
  q4f16: 'model_q4f16.onnx', bnb4: 'model_bnb4.onnx'
};
export const photoDepthModelFile = dtype => DTYPE_FILES[dtype] || DTYPE_FILES.fp32;
export const photoDepthModelRoot = root => path.join(root, '.local', 'models');

// Depth Anything predicts relative *inverse* depth, and the library's
// depth-estimation pipeline min-max normalises that to 0-255 without flipping it
// (src/pipelines/depth-estimation.js:82-90), so the raw result is bright = near.
// The rest of the app is defined the other way round (the model-based capture
// clamps distance/300, i.e. near = black, far = white, and the blue line sweeps
// from the white end). Rather than teach every consumer two conventions, the sign
// is flipped once here, at build time.
export function invertDepth(data) {
  const inverted = new Uint8Array(data.length);
  for (let index = 0; index < data.length; index++) inverted[index] = 255 - data[index];
  return inverted;
}

export async function requirePhotoDepthModel(root, { dtype = 'fp32', model = PHOTO_DEPTH_MODEL } = {}) {
  const directory = path.join(photoDepthModelRoot(root), model);
  const wanted = ['config.json', 'preprocessor_config.json', path.join('onnx', photoDepthModelFile(dtype))];
  for (const file of wanted) {
    try { await fs.access(path.join(directory, file)); }
    catch {
      const base = 'https://huggingface.co/' + model + '/resolve/main';
      throw new Error(
        '缺少深度模型文件 ' + path.join(directory, file) + '。\n' +
        '只需在维护者机器上准备一次（模型不进仓库、也不随站点发布）。国内网络需加代理 -x http://127.0.0.1:7897：\n' +
        ['config.json', 'preprocessor_config.json', path.join('onnx', photoDepthModelFile(dtype))]
          .map(name => 'curl -L -x http://127.0.0.1:7897 --create-dirs -o "' + path.join(directory, name) + '" ' + base + '/' + name.split(path.sep).join('/'))
          .join('\n')
      );
    }
  }
}

// Loading the library is deferred so that the pure helpers above stay importable
// from tests without pulling onnxruntime-node into the test process.
export async function createDepthEstimator({ root, model = PHOTO_DEPTH_MODEL, dtype = 'fp32', log = () => {} } = {}) {
  await requirePhotoDepthModel(root, { dtype, model });
  const { pipeline, env } = await import('@huggingface/transformers');
  env.localModelPath = photoDepthModelRoot(root) + path.sep;
  env.allowRemoteModels = false; // the weights are already on disk: never phone home mid-run
  env.useFSCache = false;
  log('载入 ' + model + '（' + dtype + '）…');
  return pipeline('depth-estimation', model, { dtype });
}

// Writes the app's convention (near = black) as a lossless grayscale WebP at the
// same pixel size as the source, so the depth map shares the photo's aspect ratio
// and lands in the photo frame without any cropping or stretching. Lossless keeps
// the 256 levels the histogram-based front is measured on bit-exact (a q90 encode
// moves them by up to 10 and smears the blue line); libvips always writes WebP as
// 3-channel sRGB, which the browser decodes back to the same gray values.
export async function writePhotoDepth(estimate, source, destination) {
  const { depth } = await estimate(source);
  const buffer = await sharp(invertDepth(depth.data), { raw: { width: depth.width, height: depth.height, channels: 1 } })
    .webp({ lossless: true, effort: 6 }).toBuffer();
  const temp = destination + '.' + Math.random().toString(36).slice(2) + '.tmp';
  try {
    await fs.writeFile(temp, buffer);
    await fs.rename(temp, destination);
  } finally { await fs.rm(temp, { force: true }); }
  return { width: depth.width, height: depth.height, bytes: buffer.length };
}
