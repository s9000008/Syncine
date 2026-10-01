---
name: security-agent
description: >-
  針對 Syncine 專案進行代碼資安審核、開源隱私防洩檢測、阻絕硬編碼機敏資訊（金鑰/私有IP/憑證）。
  當開發者提交代碼 (Pre-commit/PR)、新增外部相依套件、修改通訊協定、處理環境變數或涉及網路跳轉與權限驗證時，調用此 Skill。
---

# 資安 Agent (Security Agent) - 審查與開源防洩工作手冊

本 Skill 專門提供 Syncine 系統之安全性審查、開源防洩稽核與權限邊界檢驗。

## 🎯 核心執行步驟

### 步驟 1：執行自動化機敏與隱私掃描 (Scan Secrets & Private IPs)
在審查或提交任何代碼前，優先執行專屬掃描腳本：
```bash
node .agents/skills/security-agent/scripts/scan_secrets.js
```
此腳本會檢測：
1. Git 追蹤檔案中是否誤含 `.env` 或私鑰憑證檔案。
2. 原始碼中是否存在硬編碼金鑰、Token、密碼或未授權的真實 IP 位址（如自架測試時的私人家庭公網 IP）。
3. 擴充套件權限宣告是否包含 `<all_urls>` 等危險模式。

### 步驟 2：執行開源防洩核對 (Open-Source Privacy Audit)
- 核對 `git status` 與 `git diff`：
  - 確保無任何個人本機設定或測試金鑰洩漏。
  - 檢查是否有新加入之 `.env` 變數；若有，必須在 [.env.example](../../../.env.example) 中建立佔位說明，不可直接提交含有真實值的 `.env`。
  - 檢查 [.gitignore](../../../.gitignore) 是否包含所有新增之輸出物或敏感檔案。

### 步驟 3：檢驗 Syncine 專屬三大安全機制
1. **網域白名單跳轉防禦**：
   - 檢查 `REDIRECT_ROOM` 處理邏輯，確認觀眾端在 `chrome.tabs.update` 前調用了白名單檢驗，防範惡意跳轉。
2. **雙層權限 Drop 防線**：
   - 當 `allow_guest_control === false` 時，檢查後端 Socket.IO 伺服器是否具備身份判定並直接 Drop 請求，P2P 端是否具備本地防禦。
3. **日誌清毒防注入 (Log Injection)**：
   - 檢查新增的日誌輸出是否經過 `sanitizeLog()` 處理，確保清除 CRLF 換行符。

### 步驟 4：對照資安檢核清單產出稽核報告
- 詳細查閱 [資安審查檢核清單](./references/security_checklist.md)。
- 針對審查結果產出包含「通過項」、「改善建議」及「阻斷性缺陷」之報告。
