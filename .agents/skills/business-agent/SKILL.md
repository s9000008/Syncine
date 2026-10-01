---
name: business-agent
description: >-
  針對 Syncine 專案之核心業務邏輯、影音同步演算法、房間生命週期狀態機、異常邊界保護與多語系 ReturnCode 解耦進行系統化分析與實作。
  當處理播放同步問題（Play/Pause/Seek/Heartbeat）、斷線寬限回魂、自架複合分享碼、i18n 語系回饋或特定影音平台（YouTube/Bilibili）的播放器行為時，調用此 Skill。
---

# 業務 Agent (Business Agent) - 領域邏輯系統化處理工作手冊

本 Skill 專門處理 Syncine 之影音同步演算法、房間管理狀態機、異常邊界防禦與前後端多語系通訊解耦。

## 🎯 核心執行步驟

### 步驟 1：核對同步事件分類與演算法權重
任何同步邏輯改動必須嚴格區分事件類型：
- **主動指令 (Active Action)**：
  - 包括 `PLAY`、`PAUSE`、`SEEK`、`REDIRECT_ROOM`。
  - **規則**：無視容差，強制作業。必須精準同步目標時間戳與發送端之暫停旗標。
- **被動心跳 (Passive Heartbeat)**：
  - 間隔：3 秒一次。
  - 公式：$Target = currentTime + (action == 'PLAY' ? (Date.now() - timestamp)/2000 : 0)$。
  - 容差：$|video.currentTime - Target| \le 5\text{s}$ 忽略不處理；超過 5 秒強制校正。

### 步驟 2：維護房間狀態機與例外流程 (Room State Machine)
- **新進成員拉取 (State Pull)**：
  - 新成員加入房間時，必須發送 `REQUEST_CURRENT_STATE` 向房主拉取即時狀態，避免等待下一次心跳的進度脫節。
- **斷線與寬限期處理 (Grace Period)**：
  - 非預期斷線（網路中斷、休眠）啟動 60 秒保留寬限期，原成員重新連線即無感「回魂」。
  - 房主斷線超過 30 秒自動繼承轉移至最早加入之在線 Guest。
- **複合分享碼解析**：
  - 自架模式解析格式：`IP:RoomID|Base64(ServerURL)` 或 `RoomID|Base64(ServerURL)`，前端無感切換連線端點。

### 步驟 3：落實多語系 ReturnCode 解耦規範
1. 後端與通訊信號中**一律回傳標準化列舉代碼**（例如 `ROOM_NOT_FOUND`, `ROOM_FULL`, `HOST_DISCONNECTED`）。
2. 在前端多語系字典中定義繁體中文 (`zh-TW`)、English (`en-US`)、日本語 (`ja-JP`)、简体中文 (`zh-CN`) 的翻譯映射。
3. 嚴禁在後端伺服器中直接組裝或回傳包含特定語言的字串。

### 步驟 4：對照業務規則矩陣驗證
- 詳細查閱 [業務規則與狀態轉移矩陣](./references/business_rule_matrix.md)。
- 驗證涵蓋：緩衝卡頓 5 秒暫停、YouTube 廣告靜默暫停同步、Bilibili 動態載入 DOM 追蹤。
