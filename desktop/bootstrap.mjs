import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2] || '');
let server, starting, shutdown, stopping = false;
function stop(exitCode = 0) {
  if (shutdown) return shutdown;
  stopping = true;
  shutdown = (async () => {
    // A quit during startup must close the server as soon as creation finishes.
    try { await starting; } catch { /* reported by startup below */ }
    try { await server?.close(); }
    catch (error) { console.error(error); exitCode = 1; }
    process.exit(exitCode);
  })();
  return shutdown;
}
process.on('SIGTERM', () => stop());
process.on('SIGINT', () => stop());
if (process.env.CAMPUS_DESKTOP_APP === '1') {
  // The parent keeps the write end open. EOF means the application has ended,
  // including a crash or Force Quit; closing just its window keeps this intact.
  process.stdin.once('end', () => stop());
  process.stdin.resume();
}
starting = (async () => {
  const port = Number(process.env.CAMPUS_REVIEW_PORT ?? 5188);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('审核器端口无效。');
  await fs.access(path.join(root, 'server/local-editor.mjs'));
  const { createServer } = await import(pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')).href);
  server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), server: { host: '127.0.0.1', port, strictPort: true }, clearScreen: false });
  if (stopping) return;
  await server.listen();
  if (stopping) return;
  const address = server.httpServer.address();
  console.log('REVIEW_APP_READY ' + JSON.stringify({ url: `http://127.0.0.1:${address.port}/editor.html?desktop=1` }));
})();
try { await starting; }
catch (error) { console.error(error); await stop(1); }
