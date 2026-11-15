/**
 * Syncine 後端平台中央註冊表與 SSRF / 白名單防線（對齊 shared/platforms.ts 單一真理來源）
 */
export {
  type PlatformDefinition,
  PLATFORM_REGISTRY,
  HOST_WHITELIST,
  HIGH_RISK_STREAMING_CATALOG,
  getPlatformByDomain,
  getPlatformByUrl,
  getHighRiskPlatform,
  isPrivateOrInternalHost,
  isUniversalSupportedUrl,
  isPlatformActive,
  isPlatformDomainActive,
  isPlatformPermitted,
  isPlatformDomainPermitted,
  getActivePlatforms,
  isUrlAllowed,
  isServerUrlAllowed
} from './shared/platforms';
