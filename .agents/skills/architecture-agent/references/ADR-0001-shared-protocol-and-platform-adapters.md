# 架構決策記錄 (Architecture Decision Record - ADR)

## ADR 編號與標題
**ADR-0001: 抽離前後端共用契約層 (`shared/`) 並全面模組化 Extension 單體腳本與適配器**

- **狀態**：已接受 (Accepted)
- **日期**：2026-11-13
- **評估者**：架構 Agent (@architecture-agent)
- **相關模組**：`shared/`, `server/src/`, `extension/src/content/`, `extension/src/background/`, `extension/src/popup/`

---

## 1. 背景與問題陳述 (Context & Problem)
1. **跨端重複定義與規則漂移**：`extension/src/platforms.ts` / `protocol.ts` 與 `server/src/platforms.ts` / `types.ts` 長期以人工複製維護，已產生實際行為差異（如 `isUniversalSupportedUrl` 對 `http:` 的差異）；且 `platforms.ts` 單檔內同時維護 `PLATFORM_REGISTRY`、`HOST_WHITELIST` 與 `isUrlAllowed` 三份冗餘規則。
2. **單體巨型檔案難維護**：`content/index.ts` (1,903 行)、`background/index.ts` (1,541 行)、`Popup.tsx` (1,293 行) 過度耦合；泛用換集 CSS 選擇器缺少網域隔離，存在跨平台誤觸發風險。
3. **部署上下文限制**：`.github/workflows/fly-deploy.yml` 固定於 `server/` 子目錄執行 `flyctl deploy --remote-only` 與獨立 Docker 建置，因此後端容器不能依賴容器編譯階段跨目錄複製 `../shared`。

## 2. 評估方案比較 (Options Considered)

| 評估維度 | 方案 A：`shared/` 為唯一真理來源 + `server` 自含同步檢查（採納） | 方案 B：強制調整 Docker build context 至 Repo Root | 方案 C：維持雙端手動複製 |
| :--- | :--- | :--- | :--- |
| **架構複雜度** | 中（無須改動 npm workspaces 複雜設定） | 高（須更動 Dockerfile/Fly 部署路徑） | 低 |
| **擴充彈性** | 極佳（前後端零漂移，宣告式單表驅動） | 佳 | 差（極易遺漏） |
| **對現有部署衝擊** | 零衝擊（`cd server && docker build` 完全相容） | 高（破壞既有指令習慣） | 無 |
| **一致防漂移保證** | 強（自動化測試比對 `shared/` 與 `server/src/shared/` 位元組一致） | 強 | 無 |

## 3. 最終決策與理由 (Decision & Rationale)
我們選擇 **方案 A**：
1. 在 Repo 根目錄建立 `shared/`（`platforms.ts`、`protocol.ts`、`sanitize.ts`），將平台註冊表整合為單一宣告式資料驅動結構，並內建嚴格執行期驗證函式 `validateSyncData()`。
2. `extension/` 透過薄型 façade (`platforms.ts`, `types/protocol.ts`, `utils/sanitize.ts`) 直接靜態匯入並打包 `shared/`；`server/` 透過 `scripts/sync-shared.mjs` 於本地 `prebuild` / `pretest` 自動將 `shared/*.ts` 鏡像至 `server/src/shared/`（附加禁止手動修改標頭），並在 `server/test_suite.ts` 強制斷言位元組級 100% 一致，兼具 Docker 獨立建置相容性與單一真理來源約束。
3. 依 `VideoPlatformAdapter` 與單一職責模組拆解 `content/`、`background/`、`popup/`，並為所有平台換集點擊選擇器強制綁定網域條件守衛。

## 4. 系統影響與防禦策略 (Consequences & Mitigations)
- **正面效益**：根除前後端網址標準化、SSR 防護、白名單與 Payload 驗證漂移；顯著降低單檔認知負荷與跨站誤觸機率。
- **潛在風險與缺點**：既有測試腳本（`test_frontend_automation.mjs` 等）有部分以 `fs.readFileSync` 檢查單一 `.ts` 原始碼字串，拆檔後需同步更新讀取模組聚合或改採行為斷言。
- **緩解防禦策略**：拆檔同時維持頂層檔案匯出相容性，並更新強化測試矩陣覆蓋 `validateSyncData`、IP 限流、`MAX_ROOMS`、Offscreen 審核佇列與 SW 喚醒還原。

## 5. 相容性驗證清單 (Compatibility Checklist)
- [x] 不破壞現有 MV3 Service Worker 與 Offscreen 訊息轉發。
- [x] 保持 WebSocket 與 P2P DataChannel 通訊協定向下相容。
- [x] 保持 `server/Dockerfile` 與 `fly.toml` 獨立建置部署完全相容。

## 6. 規格驅動開發同步檢核 (SDD Spec-Sync Checklist)
- [x] 系統規格書 `Syncine_System_Specification.md` 已完成第 1.2、2、3、4.2.2、5、6、7.4、8、9、10.1、11.3 節增修。
- [x] 業務規則矩陣 `business_rule_matrix.md` 已對齊 `ERR_*` ReturnCode 與僅房主觸發 `BUFFERING` 規則。
- [x] 零規格漂移：所有實作 100% 依循已更新之規格書條款。
