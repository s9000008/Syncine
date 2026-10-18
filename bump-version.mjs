#!/usr/bin/env node
/**
 * Syncine 統一版本推進工具 (Single-Command Version Bumper)
 * 用法:
 *   node bump-version.mjs patch       (例如 2.3.1 -> 2.3.2)
 *   node bump-version.mjs minor       (例如 2.3.1 -> 2.4.0)
 *   node bump-version.mjs major       (例如 2.3.1 -> 3.0.0)
 *   node bump-version.mjs 2.4.0       (直接指定目標版本號)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extPkgPath = path.join(__dirname, 'extension/package.json');
const manifestPath = path.join(__dirname, 'extension/src/manifest.json');
const serverPkgPath = path.join(__dirname, 'server/package.json');

const extPkg = JSON.parse(fs.readFileSync(extPkgPath, 'utf-8'));
const currentVersion = extPkg.version;
const arg = process.argv[2] || 'patch';

function computeNextVersion(current, targetArg) {
  const parts = current.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`當前版本格式不合法: ${current}`);
  }
  if (targetArg === 'patch') {
    return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  } else if (targetArg === 'minor') {
    return `${parts[0]}.${parts[1] + 1}.0`;
  } else if (targetArg === 'major') {
    return `${parts[0] + 1}.0.0`;
  } else if (/^\d+\.\d+\.\d+$/.test(targetArg)) {
    return targetArg;
  } else {
    throw new Error(`不支援的參數 "${targetArg}"，請使用 patch | minor | major 或 x.y.z 格式`);
  }
}

const nextVersion = computeNextVersion(currentVersion, arg);

function updateJsonVersion(filePath, newVer) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  data.version = newVer;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

updateJsonVersion(extPkgPath, nextVersion);
updateJsonVersion(manifestPath, nextVersion);
updateJsonVersion(serverPkgPath, nextVersion);

console.log(`✅ Syncine 版本號已統一由 v${currentVersion} 推進至 v${nextVersion}！`);
console.log(`   - extension/package.json      -> ${nextVersion}`);
console.log(`   - extension/src/manifest.json -> ${nextVersion}`);
console.log(`   - server/package.json         -> ${nextVersion}`);
console.log(`   (所有語系檔、Offscreen、P2P 診斷報告、後端 /health 與測試套件均已自動連動)`);
