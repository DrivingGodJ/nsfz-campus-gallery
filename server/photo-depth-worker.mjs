import path from 'node:path';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const root = process.argv[2];
let estimator;
process.on('disconnect', () => process.exit(0));
process.on('message', async ({ id, source }) => {
  try {
    if (!estimator) {
      const runtime = path.join(root, '.local/depth-tools/node_modules/@huggingface/transformers/dist/transformers.node.mjs');
      const modelRoot = path.join(root, '.local/models/');
      try { await fs.access(runtime); await fs.access(path.join(modelRoot, 'onnx-community/depth-anything-v2-small/onnx/model.onnx')); }
      catch { throw new Error('本机尚未准备深度生成组件。照片已保留，可以手动添加深度图，或安装生成组件后重试。'); }
      const { pipeline, env } = await import(pathToFileURL(runtime).href);
      env.localModelPath = modelRoot + path.sep;
      env.allowRemoteModels = false; env.useFSCache = false;
      estimator = await pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', { dtype: 'fp32', session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 } });
    }
    const { depth } = await estimator(source);
    if (depth.data.length !== depth.width * depth.height) throw new Error('深度生成结果格式不正确，请重试。');
    // Depth Anything returns inverse depth (bright = near); our transition uses
    // black = near, white = far, including for hand-supplied maps.
    const values = Uint8Array.from(depth.data, value => 255 - value);
    const bytes = await sharp(values, { raw: { width: depth.width, height: depth.height, channels: 1 } }).png().toBuffer();
    process.send({ id, bytes });
  } catch (error) { process.send({ id, error: error.message }); }
});
