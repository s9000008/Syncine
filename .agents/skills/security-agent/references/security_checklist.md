# 資安審查檢核清單 (Security & Privacy Checklist)

本檢核清單由 **資安 Agent (@security-agent)** 於代碼審核、合併或開源發布前嚴格執行。

---

## 🔒 1. 開源防洩與隱私保護 (Privacy & Secret Leakage)
- [ ] **無真實私鑰與憑證**：無 `*.pem`, `*.key`, `*.cert`, `*.pfx`, `id_rsa*` 被加入 Git。
- [ ] **無硬編碼金鑰**：代碼中無寫死之 API Key, JWT Secret, Token, Password。
- [ ] **無真實私人 IP 與內部網址**：自架連線設定使用環境變數或複合分享碼，嚴禁將私人測試公網 IP、家庭內網 IP 或私人 NAS 網址硬編碼。
- [ ] **`.env` 嚴格隔離**：真實 `.env` 被 [.gitignore](../../../../.gitignore) 排除，僅維護乾淨之 [.env.example](../../../../.env.example)。
- [ ] **自動化掃描通過**：執行 `node .agents/skills/security-agent/scripts/scan_secrets.js` 結果為 0 錯誤。

---

## 🌐 2. 擴充套件 MV3 安全性 (Chrome Extension Security)
- [ ] **最小主機權限**：`manifest.json` 嚴禁宣告 `<all_urls>`，僅宣告支援的影音網域及後端 API 端點。
- [ ] **Offscreen 隔離執行**：WebRTC 實例與通訊完全收容於 `chrome.offscreen`，避免外部注入。
- [ ] **儲存區個資保護**：`chrome.storage.local` 不存放未加密的使用者隱私或帳密。
- [ ] **安全跳轉防禦**：`chrome.tabs.update` 調用前嚴格經過正則白名單匹配，防範開放式重定向 (Open Redirect)。

---

## 🛡️ 3. 後端伺服器與通訊防禦 (Server & Protocol Security)
- [ ] **未授權指令丟棄**：非 Host 嘗試發送 `SYNC_STATE` 且 `allow_guest_control === false` 時，伺服器必須 Drop 該請求。
- [ ] **Log CRLF 注入防範**：伺服器所有日誌輸出使用 `sanitizeLog` 清除 `\r\n` 與控制字元，防止偽造日誌行。
- [ ] **輸入邊界與長度截斷**：`roomId`, `userId`, `targetUrl` 等欄位具備格式與長度邊界校驗，防止超長 Payload 記憶體攻擊。
- [ ] **CORS 跨域安全**：生產環境 CORS 配置不使用萬用字元 `*`，限制信任來源。


