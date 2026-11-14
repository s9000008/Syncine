import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const sharedDir = path.join(rootDir, 'shared');
const serverSharedDir = path.join(rootDir, 'server', 'src', 'shared');

if (!fs.existsSync(sharedDir)) {
  // 處於獨立容器 (Docker runner / Fly.io) 建置環境時略過同步，直接使用已納入之 server/src/shared
  process.exit(0);
}

fs.mkdirSync(serverSharedDir, { recursive: true });
const files = ['platforms.ts', 'protocol.ts', 'sanitize.ts'];

for (const file of files) {
  const srcPath = path.join(sharedDir, file);
  const destPath = path.join(serverSharedDir, file);
  const content = fs.readFileSync(srcPath, 'utf-8');
  const normalized = content.replace(/\r\n/g, '\n');
  fs.writeFileSync(destPath, normalized, 'utf-8');
}

console.log('✅ 已同步 shared/ 單一真理來源至 server/src/shared/');
