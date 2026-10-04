import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { localEditorPlugin } from './server/local-editor.mjs';
import { staticContentPlugin } from './server/storage.mjs';
import { localLikesPlugin } from './server/local-likes.mjs';

export default defineConfig(({ command }) => ({
  base: process.env.PAGES_BASE_PATH || './',
  plugins: [react(), ...(command === 'serve' ? [localEditorPlugin(), localLikesPlugin()] : [staticContentPlugin()])],
  publicDir: command === 'serve' ? 'public' : false,
  server: { host: '127.0.0.1', port: 5178, strictPort: true },
  preview: { host: '127.0.0.1', port: 4178, strictPort: true },
  build: { rolldownOptions: { input: { main: 'index.html', submit: 'submit.html' } }, sourcemap: false, chunkSizeWarningLimit: 1100 }
}));
