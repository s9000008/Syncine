import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. 編譯 Content Script 與 MAIN Bridges 為獨立原生 IIFE 格式
const entryFile = path.join(__dirname, 'src/content/index.ts');
const outputFile = path.join(__dirname, 'dist/content.js');
const netflixEntryFile = path.join(__dirname, 'src/content/netflix_bridge.ts');
const netflixOutputFile = path.join(__dirname, 'dist/netflix_bridge.js');
const youtubeEntryFile = path.join(__dirname, 'src/content/youtube_bridge.ts');
const youtubeOutputFile = path.join(__dirname, 'dist/youtube_bridge.js');
const srcManifestFile = path.join(__dirname, 'src/manifest.json');
const manifestFile = path.join(__dirname, 'dist/manifest.json');

const commonEsbuildOpts = {
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['chrome100'],
  pure: ['console.log', 'console.debug'],
  define: {
    'process.env.NODE_ENV': '"production"'
  }
};

esbuild.buildSync({ ...commonEsbuildOpts, entryPoints: [entryFile], outfile: outputFile });
esbuild.buildSync({ ...commonEsbuildOpts, entryPoints: [netflixEntryFile], outfile: netflixOutputFile });
esbuild.buildSync({ ...commonEsbuildOpts, entryPoints: [youtubeEntryFile], outfile: youtubeOutputFile });

// 2. 更新 dist/manifest.json，繼承 src/manifest.json 並移除 CRXJS 殘留的 content loader / web_accessible_resources
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
        'https://netflix.com/*'
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
      matches: srcManifest.content_scripts[3]?.matches || ['https://static.crunchyroll.com/*'],
      js: ['content.js'],
      all_frames: true,
      run_at: 'document_end'
    }
  ];

  // 移除 CRXJS 為原生 Content Loader 產生的 web_accessible_resources，避免網站端指紋偵測與冗餘資源曝露
  const swLoaderPath = path.join(__dirname, 'dist', 'service-worker-loader.js');
  const swLoaderContent = fs.existsSync(swLoaderPath) ? fs.readFileSync(swLoaderPath, 'utf8') : '';
  const redundantFiles = new Set();

  if (Array.isArray(manifest.web_accessible_resources)) {
    for (const entry of manifest.web_accessible_resources) {
      if (!Array.isArray(entry.resources)) continue;
      for (const resPath of entry.resources) {
        if (/assets\/(index\.ts-|netflix_bridge\.ts-|youtube_bridge\.ts-)/i.test(resPath)) {
          if (!swLoaderContent.includes(path.basename(resPath))) {
            redundantFiles.add(resPath);
          }
        }
      }
    }
    delete manifest.web_accessible_resources;
  }

  // 一併清理 dist/assets 內的 CRXJS content script loader (index.ts-loader-*.js)
  const assetsDir = path.join(__dirname, 'dist', 'assets');
  if (fs.existsSync(assetsDir)) {
    for (const file of fs.readdirSync(assetsDir)) {
      if (
        /^index\.ts-loader-.*\.js$/i.test(file) ||
        /^netflix_bridge\.ts-.*\.js$/i.test(file) ||
        /^youtube_bridge\.ts-.*\.js$/i.test(file)
      ) {
        redundantFiles.add(path.posix.join('assets', file));
      }
    }
  }

  let removedCount = 0;
  for (const rel of redundantFiles) {
    const abs = path.join(__dirname, 'dist', rel);
    if (fs.existsSync(abs)) {
      fs.unlinkSync(abs);
      removedCount++;
    }
  }

  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  console.log(`✅ Content Script 與 Bridges IIFE 封裝完成！（已清理 ${removedCount} 個冗餘 CRXJS Loader 產物）`);
}
