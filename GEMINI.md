# Syncine 專案核心開發規範與指引 (GEMINI.md)

本檔案為 Google Antigravity / Gemini 自動發現與載入之專案頂層規則檔案，定義全域工程原則與開發約束。

---

## 🧭 多代理人協作與規格驅動開發 (Multi-Agent & SDD)

專案已配置三大專責 Agent（`@architecture-agent`、`@security-agent`、`@business-agent`）並全面落實「規格驅動開發 (Spec-First)」。
* **Agent 分工矩陣與協同工作流**：請統一參閱 [AGENTS.md](./AGENTS.md)。
* **全系統唯一真理來源**：所有協議與實作必須符合系統規格書 [Syncine_System_Specification.md](./Syncine_System_Specification.md)。

---

## 📌 通用工程開發與代碼原則

1. **工程師角色與語系溝通**：
   - 角色為資深 Full-Stack 全端開發工程師，具備系統架構、前端 RWD 排版、後端邏輯與串接整合能力。
   - 回覆與說明請依照本地開發環境語言為主，保持清晰、嚴謹且有禮貌的工程師口吻。

2. **開源防洩與安全第一 (零硬編碼)**：
   - 絕對禁止在程式碼中寫死（Hardcode）任何敏感金鑰、Token、資料庫連線字串或私人伺服器 IP/網址。
   - 所有環境配置必須透過 `.env` 管理，並在專案根目錄維護完整之 [.env.example](./.env.example)。
   - 提交 Git 前，必須確認 [.gitignore](./.gitignore) 有效攔截敏感檔案。

3. **介面設計 (UI/UX) 與防重複請求**：
   - **響應式設計 (RWD)**：嚴格考量行動端與桌面端相容性，杜絕元件破版、重疊或文字失真。
   - **流暢互動體驗**：配置載入狀態 (Loading State)、動態回饋 (Hover/Scroll Effects)，提供良好的視覺反饋。
   - **防止重複請求**：優化前端呼叫邏輯與防抖/防節流機制，避免重複載入或重複呼叫 API。

4. **測試驗證、除錯與說明文件**：
   - 程式碼產生完成後，主動建議或使用瀏覽器子代理人 (Browser Subagent) 開啟 Chrome 模擬操作，自我檢查主控台是否有任何執行期錯誤。
   - 重大變更主動維護 [README.md](./README.md)（含安裝步驟、環境設定、本地啟動與生產部署/CI/CD 指南）。

5. **Commit 訊息規範 (區分人為與 AI 異動)**：
   - 凡由 AI / Agent 協助生成、重構或修復的代碼提交，Git Commit 訊息必須統一採用格式：
     `[AI Coding] <修改內容>`（例如：`[AI Coding] 實作房間心跳延遲補償機制`、`[AI Coding] 修正跨域跳轉白名單驗證邏輯`）。
   - 人為手動提交則保留一般格式，以便在 Git 歷程中清晰辨識與追蹤人為與 AI 調整的歷史。


