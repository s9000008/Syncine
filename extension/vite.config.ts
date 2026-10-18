import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest.json';
import pkg from './package.json';
import { resolve } from 'path';
import fs from 'fs';

// 自動將 package.json 版本號同步至 src/manifest.json，確保單一真理來源
if (manifest.version !== pkg.version) {
  manifest.version = pkg.version;
  fs.writeFileSync(
    resolve(__dirname, 'src/manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf-8'
  );
}

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest: { ...manifest, version: pkg.version } }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        offscreen: resolve(__dirname, 'src/offscreen/index.html')
      }
    }
  }
});
