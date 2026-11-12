import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. 編譯 Content Script 為獨立原生 IIFE 格式（徹底消除外部 import Loader，並於正式建置剝除一般 console.log 避免外露非必要資訊）
const entryFile = path.join(__dirname, 'src/content/index.ts');
const outputFile = path.join(__dirname, 'dist/content.js');
const netflixEntryFile = path.join(__dirname, 'src/content/netflix_bridge.ts');
const netflixOutputFile = path.join(__dirname, 'dist/netflix_bridge.js');
const youtubeEntryFile = path.join(__dirname, 'src/content/youtube_bridge.ts');
const youtubeOutputFile = path.join(__dirname, 'dist/youtube_bridge.js');
const srcManifestFile = path.join(__dirname, 'src/manifest.json');
const manifestFile = path.join(__dirname, 'dist/manifest.json');

esbuild.buildSync({
  entryPoints: [entryFile],
  bundle: true,
  minify: true,
  format: 'iife',
  outfile: outputFile,
  target: ['chrome100'],
  pure: ['console.log', 'console.debug'],
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
  pure: ['console.log', 'console.debug'],
  define: {
    'process.env.NODE_ENV': '"production"'
  }
});

esbuild.buildSync({
  entryPoints: [youtubeEntryFile],
  bundle: true,
  minify: true,
  format: 'iife',
  outfile: youtubeOutputFile,
  target: ['chrome100'],
  pure: ['console.log', 'console.debug'],
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
      matches: srcManifest.content_scripts[1]?.matches || [
        'https://www.netflix.com/*',
        'https://netflix.com/*',
        'https://www.netflix.com/watch*'
      ],
      js: ['netflix_bridge.js'],
      world: 'MAIN',
      run_at: 'document_start'
    },
    {
      matches: srcManifest.content_scripts[2]?.matches || [
        'https://www.youtube.com/*',
        'https://youtube.com/*',
        'https://m.youtube.com/*',
        'https://youtu.be/*'
      ],
      js: ['youtube_bridge.js'],
      world: 'MAIN',
      run_at: 'document_start'
    },
    {
      matches: srcManifest.content_scripts[3]?.matches || [
        'https://static.crunchyroll.com/*'
      ],
      js: ['content.js'],
      all_frames: true,
      run_at: 'document_end'
    }
  ];
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  console.log('✅ Content Script、Netflix 與 YouTube MAIN Bridge 原生 IIFE 封裝完成！');
}
