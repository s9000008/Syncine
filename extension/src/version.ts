import pkg from '../package.json';

/**
 * 全域版本號單一真理來源 (Single Source of Truth)
 * 自動從 extension/package.json 讀取，免除多處硬編碼維護
 */
export const RAW_VERSION: string = pkg.version;
export const APP_VERSION: string = `v${pkg.version}`;
