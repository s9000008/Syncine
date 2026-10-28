import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. 編譯 Content Script 為獨立原生 IIFE 格式（徹底消除外部 import Loader）
const entryFile = path.join(__dirname, 'src/content/index.ts');
const outputFile = path.join(__dirname, 'dist/content.js');
const netflixEntryFile = path.join(__dirname, 'src/content/netflix_bridge.ts');
const netflixOutputFile = path.join(__dirname, 'dist/netflix_bridge.js');
const srcManifestFile = path.join(__dirname, 'src/manifest.json');
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

esbuild.buildSync({
  entryPoints: [netflixEntryFile],
  bundle: true,
  minify: true,
  format: 'iife',
  outfile: netflixOutputFile,
  target: ['chrome100'],
  define: {
    'process.env.NODE_ENV': '"production"'
  }
});

// 2. 更新 dist/manifest.json，動態繼承 src/manifest.json 之完整授權名單並指定原生 bundle
if (fs.existsSync(manifestFile) && fs.existsSync(srcManifestFile)) {
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const srcManifest = JSON.parse(fs.readFileSync(srcManifestFile, 'utf8'));

  manifest.content_scripts = [
    {
      matches: srcManifest.content_scripts[0]?.matches || [],
      js: ['content.js'],
      all_frames: false,
      run_at: 'document_end'
    },
    {
      matches: [
        "https://www.netflix.com/*",
        "https://www.netflix.com/watch*"
      ],
      js: ['netflix_bridge.js'],
      world: 'MAIN',
      run_at: 'document_start'
    }
  ];
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

console.log('✅ Content Script 原生獨立打包完成 (已包含 Isolated Content Script 與 Netflix Main World Bridge)');
