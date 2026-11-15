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

6. **分支隔離開發規範 (Feature Branch Workflow)**：
   - 未來在開發任何新功能、性能重構或針對性優化時，**嚴禁直接在 `main` 主分支上進行更動**。
   - 必須自 `main` 建立專屬的獨立工作分支（命名規範如 `feature/<功能名稱>`、`optimize/<優化項目>`、`fix/<問題描述>`）。
   - 於專屬分支上完成針對性開發、編譯與全套自動化測試驗證後，再進行合併或提交 Pull Request，確保主線分支隨時處於穩定可發布狀態。

7. **嚴格禁止遠端程式碼 (No Remotely Hosted Code Policy)**：
   - 依據 Google Chrome Web Store MV3 開發者政策與權限申報規範，擴充套件**絕對禁止引入、下載、動態注入或執行任何遠端託管程式碼（Remotely Hosted Code）**。
   - 包含但不限於：嚴禁使用 `eval()`、`new Function()`、字串型態 `setTimeout`、外部 `<script src="https://...">`、動態建立 script 標籤載入外部 URL、`chrome.scripting.executeScript` 執行任意遠端字串、以及遠端 WebAssembly 下載。
   - 所有外部第三方函式庫（如 React、Socket.IO Client、PeerJS）必須 100% 透過套件管理工具於本機建置階段完成靜態打包編譯（納入 `dist/` 與發布套件包中），確保所有執行代碼均封裝於擴充套件內部，維持 Google 開發者審查之絕對合規。

8. **跨平台播放清單與上下集連播同步架構標準 (Playlist & Episode Navigation Sync Standard)**：
   - **嚴格條件化生效守衛 (Strict Conditional Guard)**：
     - 任何新增支援平台必須實作能力檢測 `isPlaylistOrEpisodeSupported()`。若當前網頁或畫面為獨立單部影片（未提供清單、選集或上下集按鈕），嚴禁觸發房間重導向廣播，保持純播放狀態同步，杜絕無端跳轉。
   - **全生命週期動作捕捉 (Action & Event Capture)**：
     - 必須在捕獲階段 (Capture phase) 監聽各平台「下一部／上一部」、「下一集／上一集」、「劇集／分 P 列表」點擊，呼叫 `markPlaylistActionTriggered()` 登記行為時間戳記。
     - 必須監聽 HTML5 `<video>` 的 `ended` 事件以支援片尾自動連播換集。
   - **房主專利與觀眾隔離 (Host Privilege & Guest Isolation)**：
     - 換集跳轉廣播 (`BG_REDIRECT_ROOM`) 僅限房主身份 (`roomState.isInRoom && roomState.isHost`)，觀眾點擊或換片絕不影響其他成員。
   - **房主本地無重整無縫體驗 (Host Seamless Playback Guard)**：
     - Background 的 `verifyAndRedirect` 必須比對 `getVideoIdentifier(activeTab.url) === getVideoIdentifier(targetUrl)`（`isAlreadyOnVideo`）。若房主已在目標集數，略過 `chrome.tabs.update`，杜絕畫面重整中斷與閃爍，並保證觀眾端能順暢跳轉。
   - **劇集與分 P 唯一識別碼規整 (Multi-Part Identifier & Canonical URL)**：
     - 平台網址正規化必須精確支援分 P（如 Bilibili `?p=2`）與特定集數（如 `ep12345`、Netflix `/watch/81759292`），確保集數切換被精準識別為不同目標。
   - **單元與涵蓋率測試基準 (Automated Testing Baseline)**：
     - 所有新支援平台必須於測試套件補齊：識別碼解析矩陣、純淨標準網址過濾、DOM 選擇器匹配、防重整保護測試，達成 100% 自動化測試覆蓋。



