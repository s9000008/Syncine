# 業務規則與狀態轉移矩陣 (Business Rule & State Transition Matrix)

本矩陣由 **業務 Agent (@business-agent)** 維護，作為 Syncine 核心領域邏輯的檢驗標準。

---

## 📊 1. 同步事件業務處理矩陣

| 事件名稱 | 發起端 | 容差機制 | 接收端動作 | 邊界條件 / 注意事項 |
| :--- | :--- | :--- | :--- | :--- |
| **`PLAY`** | 房主 / 獲權成員 | **無視容差** | `video.play()` 並校正秒數 | 若正處於廣告中則忽略 |
| **`PAUSE`** | 房主 / 獲權成員 | **無視容差** | `video.pause()` 並對齊秒數 | 同步保存播放位置 |
| **`SEEK`** | 房主 / 獲權成員 | **無視容差** | 強制定製 `currentTime`，對齊 `paused` 狀態 | 避免跳轉後接收端未恢復播放 |
| **`HEARTBEAT`** | 房主 (每 3 秒) | **5 秒容差** | 差值 $> 5$ 秒強制跳轉，$\le 5$ 秒忽略 | 計算 $(Recv - Sent)/2000$ 延遲補償 |
| **`REDIRECT_ROOM`** | 房主 | **白名單過濾** | 驗證 URL 後導向新影片 | 非白名單網址彈出警示並攔截 |
| **`BUFFERING`** | **僅房主** (卡頓 $> 5$s) | - | 全房間暫停 (`PAUSE`) | 避免成員進度落後，房主恢復後重啟；觀眾自身卡頓僅於本機緩衝，絕不暫停全房 |

---

## 🔄 2. 房間生命週期狀態轉移矩陣

| 當前狀態 | 觸發事件 | 下一狀態 | 系統動作 |
| :--- | :--- | :--- | :--- |
| **無房間** | 房主點擊建立房間 | **房間就緒 (Active)** | 伺服器配置 6 碼 ID 與 `resumeToken`，初始化狀態 |
| **無房間** | 觀眾輸入分享碼 | **已加入 (Joined)** | 發送 `REQUEST_INIT_SYNC` / `REQUEST_CURRENT_STATE` 秒級拉取進度 |
| **房間就緒** | 房主異常斷線 | **保留寬限期 (Grace Period)** | 啟動 60 秒計時器，不立即銷毀房間 |
| **保留寬限期** | 房主於 60 秒內重連 | **房間就緒 (Active)** | 驗證 `resumeToken` 取消銷毀計時器，無感回魂 |
| **保留寬限期** | 房主離線超過 30 秒 | **房主遷移 (Host Migrated)** | 提升在線時間最長之 Guest 為新房主並私訊簽發新 `resumeToken` |
| **保留寬限期** | 全員離線超過 60 秒 | **房間已銷毀 (Destroyed)** | 清除記憶體房間資料，釋放資源 |
| **房間就緒** | 房主主動點擊退出 | **房間已銷毀 (Destroyed)** | 立即銷毀房間，通知全員退房 |

---

## 🌍 3. 多語系 ReturnCode 映射規範

所有後端返回或擴充套件通道狀態必須採用標準 ReturnCode：

| 標準 ReturnCode | 繁體中文 (`zh-TW`) | English (`en-US`) | 日本語 (`ja-JP`) | 简体中文 (`zh-CN`) |
| :--- | :--- | :--- | :--- | :--- |
| `ERR_ROOM_NOT_FOUND` | 找不到房間或代碼已失效 | Room not found or expired | 部屋が見つからないか無効です | 未找到房间或代码已失效 |
| `ERR_ROOM_FULL` | 該房間已達人數上限 | Room is full | 部屋の定員に達しました | 该房间已达人数上限 |
| `ERR_ROOM_CLOSED` | 房間已關閉或房主已結束同映 | Room closed or host left | 部屋が閉じられたかホストが退出しました | 房间已关闭或房主已结束同映 |
| `ERR_PERMISSION_DENIED` | 權限不足，僅限房主操作 | Permission denied (Host only) | 権限がありません（ホストのみ） | 权限不足，仅限房主操作 |
| `ERR_INVALID_CODE` | 無效的房間或分享碼格式 | Invalid room or share code format | 無効な部屋・共有コード形式です | 无效的房间或分享码格式 |
| `ERR_UNAUTHORIZED_URL` | 已攔截未授權的外部跳轉網址 | Unauthorized redirect URL blocked | 未承認のリダイレクト URL をブロックしました | 已拦截未授权的外部跳转网址 |
| `ERR_RATE_LIMITED` | 操作過於頻繁，請稍後再試 | Rate limit exceeded, try again later | 操作が多すぎます。しばらくしてから再試行してください | 操作过于频繁，请稍后再试 |
