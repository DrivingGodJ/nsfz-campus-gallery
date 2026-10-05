import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2] || '');
await fs.access(path.join(root, 'server/local-editor.mjs'));
const { createServer } = await import(pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')).href);
const server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), server: { host: '127.0.0.1', port: 5188, strictPort: true }, clearScreen: false });
await server.listen();
console.log('REVIEW_APP_READY ' + JSON.stringify({ url: 'http://127.0.0.1:5188/editor.html?desktop=1' }));
const stop = async () => { await server.close(); process.exit(0); };
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
