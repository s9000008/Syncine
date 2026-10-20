import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. 編譯 Content Script 為獨立原生 IIFE 單檔（徹底消除動態 import Loader）
const entryFile = path.join(__dirname, 'src/content/index.ts');
const outputFile = path.join(__dirname, 'dist/content.js');
const manifestFile = path.join(__dirname, 'dist/manifest.json');

esbuild.buildSync({
  entryPoints: [entryFile],
  bundle: true,
  minify: true,
  format: 'iife',
  outfile: outputFile,
  target: ['chrome100'],
  define: {
    'process.env.NODE_ENV': '"production"'
  }
});

// 2. 更新 dist/manifest.json，讓 Chrome 原生直接加載 content.js
if (fs.existsSync(manifestFile)) {
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (manifest.content_scripts && manifest.content_scripts[0]) {
    manifest.content_scripts[0].js = ['content.js'];
  }
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

console.log('✅ Content Script 原生獨立打包完成 (已替換 CRXJS 動態 import Loader 為原生 content.js)');
