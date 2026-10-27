import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
// @ts-expect-error O runtime do Vite fornece Node; os tipos não são necessários no bundle do app.
import process from 'node:process';
import { distributedPackages } from './.github/compliance/vite-distributed-packages.js';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [sveltekit({
    adapter: adapter({ fallback: 'index.html' }),
    preprocess: vitePreprocess(),
  }), distributedPackages()],
  clearScreen: false,
  server: {
    port: 1422,
    strictPort: true,
    host: host || '127.0.0.1',
    hmr: host ? { protocol: 'ws', host, port: 1423 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
});
