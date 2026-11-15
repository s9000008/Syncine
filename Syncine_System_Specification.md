# Syncine (同映) - 跨平台網頁影片同步播放系統完整開發規格書 (v2.10.0)

> **環境與用途說明**：本文件專為 **Google Antigravity** 及 AI 開發助理設計。內含三模彈性連線架構（預設官方中繼 / 自架 IP 模式 / WebRTC P2P 直連）、核心同步演算法、MV3 Offscreen 載體、保活防禦、邊界條件、WebSocket 通訊協定（Type Definitions）以及未來預期功能規劃。請嚴格依據此規格書進行前後端程式碼生成與維護。

---

## 1. 專案概述與核心範疇

### 1.1 系統目標
本專案旨在開發一款瀏覽器擴充套件（Chrome Extension V3），配合彈性連線機制（預設中繼、自架伺服器、WebRTC P2P 直連），實現跨地理位置、跨網頁、低延遲的網頁影片「即時同步播放」服務。

### 1.2 支援目標網站（當前版本正式支援 18 大正版影音串流平台）
1. **YouTube**：標準網頁版影片播放頁（處理 SPA 網頁架構、廣告過濾，並以 MV3 `world: "MAIN"` 橋接調用原生 `#movie_player` API 進行安全 Seek/Play/Pause/Rate 控制，搭配 `video.seeking` 互斥防線杜絕進度條拖曳偽暫停與 DASH/MSE 分片卡頓）。
2. **Bilibili (嗶哩嗶哩)**：標準網頁版影片與番劇播放頁（處理動態載入 DOM、分 P 與番劇 ep/ss）。
3. **Niconico (ニコニコ動画)**：`nicovideo.jp/watch/*` 播放頁（處理多重 `<video>` 篩選、廣告容器隔離與 SPA 導航）。
4. **CATCHPLAY+**：`catchplay.com/watch/*`、`catchplay.com/*/watch/*` 等正版隨選串流播放頁（處理 SPA 選集導航與連播偵測）。
5. **Netflix**：`netflix.com/watch/*` 播放頁（處理 SPA 路由導航、專屬播放容器 `.watch-video video` 選擇器、影片唯一識別碼 `netflix:<numericId>` 提取，並以 MV3 `world: "MAIN"` 橋接調用 Cadmium VideoPlayer API 進行安全 Seek/Play/Pause，防範直接修改 `currentTime` 觸發 DRM/播放器崩潰）。
6. **Vimeo**：標準影片與 Showcase 展示集、頻道播放頁（處理 `.vp-video-wrapper video`、播放清單與 Next video）。
7. **巴哈姆特動畫瘋**：`ani.gamer.com.tw/animeVideo.php?sn=*`（處理 Video.js 播放器與選集季別切換）。
8. **Twitch**：VOD 隨選影片、Clips 剪輯與直播頻道頁。
9. **Disney+**：`disneyplus.com/video/*`、`/play/*`、`/series/*`（處理專屬 BTM 播放器與 Next Episode 連播）。
10. **Prime Video / Amazon**：`primevideo.com/detail/*` 與 `amazon.com/gp/video/*`。
11. **MyVideo**：`myvideo.net.tw/details/*` 與 `/player/*` 繁中優質串流。
12. **LINE TV**：`linetv.tw/drama/*` 台灣與亞洲戲劇/綜藝/動漫串流。
13. **KKTV**：`kktv.me/play/*` 日劇動漫第一品牌串流。
14. **Crunchyroll**：`crunchyroll.com/watch/*` 全球動漫旗艦平台（含嵌入式播放器來源 `static.crunchyroll.com`）。
15. **遠傳 friDay 影音**：`video.friday.tw/(drama|movie|anime|show)/detail/*` 台灣院線與日韓獨家平台。
16. **Max (HBO Max)**：`play.max.com/video/watch/*` 全球頂級影集電影平台。
17. **愛奇藝 (iQIYI)**：`iq.com/play/*` 與 `iqiyi.com/v_*.html` 亞洲頂級華語與動漫串流。
18. **Apple TV+**：`tv.apple.com/...` 全球頂級原創影集電影串流平台。

> [!NOTE]
> **功能範疇與非官方站台隔離說明**：
> 1. **WebRTC P2P 點對點直連架構**：採用 Chrome MV3 官方推薦之 `chrome.offscreen` Document 承載 PeerJS 與原生 `RTCPeerConnection` / `RTCDataChannel`，以統一 6 碼邀請碼 (`P2P:<RoomID>`) 搭配房主入房審核佇列實現星狀拓撲加密直連。
> 2. **18 大正式開放平台與預授權解耦架構**：現行版本正式實裝上述 18 大正版串流平台專屬適配器（`VideoPlatformAdapter`）與選集連播同步，並透過統一之 `shared/platforms.ts` 中央登錄表實現「Manifest 權限預授權」與「實際開放支援名單」完全解耦（詳見第 5.4 節）。
> 3. **非官方／高風險站台隔離**：`Anime1.me` 等未授權影視網站已完全移出 `manifest.json` 靜態授權與正式支援清單，僅收錄於 `HIGH_RISK_STREAMING_CATALOG` 作為開發測試彩蛋解鎖後之 `activeTab` 非正式支援示範（預設鎖定狀態下不予支援）。

---

## 2. 系統架構與技術棧 (Tech Stack)

### 2.1 整體系統拓撲架構
系統支援兩大傳輸架構：
1. **伺服器中繼架構 (Default Relay & Self-Hosted IP)**：
   `[影片 DOM] <--> [Content Script] <--> [Background SW] <--> [WebSocket Server] <--> [其餘成員 Background SW]`
2. **WebRTC P2P 端對端直連架構 (DataChannel Mode)**：
   `[影片 DOM] <--> [Content Script] <--> [Background SW] <--> [Offscreen Document (WebRTC)] === [DataChannel 直連] === [其餘成員 Offscreen]`

### 2.2 前端套件 (Chrome Extension V3)
* **核心框架**: React 18 + TypeScript + Vite
* **模組化結構**: 共用契約層 `shared/`、平台適配器 `content/adapters/`、背景服務模組 `background/modules/` 與介面子元件 `popup/components/`
* **編譯工具**: `@crxjs/vite-plugin` + `esbuild` 靜態打包管線（產出 100% 本地 IIFE Content/Bridge 腳本並清理冗餘未引用 chunk）
* **樣式庫**: Tailwind CSS
* **通訊客戶端**: `socket.io-client`（WebSocket 傳輸）與 PeerJS / `RTCDataChannel`（位於 Offscreen Document）
* **載體架構**: `chrome.offscreen` API（解決 MV3 Background Service Worker 不支援 WebRTC 原生 API 之限制）

### 2.3 後端伺服器 (Official & Self-Hosted Server)
* **執行環境**: Node.js 22+ (官方容器鏡像基準 `node:26-alpine`，`engines.node >= 22.22.0`) / TypeScript
* **預設監聽埠**: `PORT=8080`（對齊線上 Fly.io `fly.toml` `internal_port = 8080`，開發環境可透過 `.env` 覆寫）
* **核心框架**: Express + Socket.IO
* **核心功能**:
  1. **房間狀態中繼 (Room Relay)**：管理房間生命週期、單房人數上限（100 人）與全域房間數上限（`MAX_ROOMS`），進行心跳與播放指令廣播。
  2. **二重安全驗證與邊界過濾**: 房主權限控制（未經授權之 Guest 指令與 Guest 偽造之 `HEARTBEAT` 直接 Drop）、Strict Payload Schema 校驗與來源 IP + Socket 雙維度頻率限制。
* **狀態儲存**: 記憶體儲存 (Memory Object)，預留 Redis 介面供叢集化擴展。

---

## 3. 連線方式核心模式規格 (Connection Modes)

系統提供三種兼顧零伺服器直連、官方開箱即用與私有自架掌控之彈性連線選項：

```text
┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                      Syncine 三模彈性連線選項                                     │
├─────────────────────────────────┬─────────────────────────────────┬───────────────────────────────┤
│ 1. ⚡ WebRTC P2P 端對端直連      │ 2. 🏢 預設中繼模式 (Official)   │ 3. 🌐 自行輸入 IP (Self-Host) │
├─────────────────────────────────┼─────────────────────────────────┼───────────────────────────────┤
│ 統一 6 碼邀請碼 + 房主審核佇列  │ 官方託管雲端中繼 (Fly.io)       │ 自建私有主機 / VPS / NAS / LAN│
│ 星狀拓撲 DataChannel 加密直連   │ 穿透嚴格防火牆、開箱即用免設定  │ 複合分享碼無感自動對接        │
└─────────────────────────────────┴─────────────────────────────────┴───────────────────────────────┘
```

### 3.1 選項一：預設中繼連線模式 (Default Relay Mode)
* **定位**：適合受嚴格企業防火牆限制之網路環境，開箱即用、零配置（控制面板預設選中為 WebRTC P2P 直連模式，可一鍵切換至此模式）。
* **連線端點**：套件依建置設定連線至中繼伺服器（生產環境預設為官方託管端點 `https://syncine.fly.dev`，本地開發可透過 `VITE_DEFAULT_SERVER_URL` 切換為 `http://localhost:8080`）。控制面板僅在使用者切換至本模式時才探測 `/health` 狀態，避免非必要背景請求。
* **傳輸機制**：WebSocket (Socket.IO) 集中式房間中繼轉發。
* **房間代碼**：標準前綴複合碼 `DEF:<RoomID>|<Base64(ServerURL)>`（向下相容純 6 碼代碼如 `X7A9B2`）。
* **房間與資源限制**：單房成員上限 **100 人**，伺服器全域最大併發房間數受 `MAX_ROOMS`（預設 **1,000** 房）保護以防範記憶體耗竭。
* **優點**：無需任何額外配置，即使處於對稱型 NAT 或嚴格防火牆皆可穩定同步。

### 3.2 選項二：自行輸入 IP 模式 (Custom IP / Self-Hosted Mode)
* **定位**：適合自架愛好者、內部區域網路（LAN）、私有雲 VPS 或 NAS 使用者。
* **連線端點**：房主在建立房間時，控制面板 UI 提供「自訂伺服器網址/IP」輸入欄位（例如：`http://192.168.1.100:8080` 或 `https://syncine.myhome.net:8443`）。
* **複合型分享碼無感對接機制**：
  1. 房主在自訂伺服器建房成功後，套件將「6 碼 Room ID」與「Base64 編碼後的自訂伺服器網址」透過管道符號 `|` 組裝成最終分享碼：
     - *格式*：`IP:RoomID|Base64(ServerURL)`（向下相容舊版 `RoomID|Base64(ServerURL)`）
     - *範例*：`IP:X7A9B2|aHR0cDovLzE5Mi4xNjguMS4xMDA6ODA4MA==`
  2. 觀眾在套件中貼入該分享碼時，前端與 Background 自動解析拆解該字串。
  3. 觀眾端套件自動將 WebSocket 連線位置動態切換至解碼後的自訂 IP 並發送加房請求，觀眾**完全不需要手動輸入 IP**。
* **優點**：資料完全自主掌控、區域網路內極低延遲、不受外部伺服器維護限制。

### 3.3 選項三：WebRTC 純端對端直連模式 (Unified Invite Code P2P Mode - 預設模式)
* **定位**：UI 預設選定模式，免自建伺服器、極致低延遲、多人星狀拓撲加密直連。
* **NAT 穿透與信令發現**：配置 Google (`stun:stun.l.google.com:19302`) 與 Cloudflare (`stun:stun.cloudflare.com:3478`) 多節點公共 STUN 伺服器，並透過 PeerJS 公用信令代理 (`0.peerjs.com`) 完成初始房間代碼尋址（PeerID 命名空間為 `syncine-<6碼>`）。
* **統一邀請碼與房主審核握手流程**：
  1. **步驟 1 (房主建房)**：房主點擊建立 P2P 房間，Offscreen Document 生成密碼學安全隨機 6 碼房號並註冊 Host Peer (`syncine-<RoomID>`)，產出統一分享碼 `P2P:<RoomID>`（同一組代碼可同時分享給多位好友）。
  2. **步驟 2 (觀眾申請)**：觀眾貼入邀請碼後建立 DataChannel 連線並送出 `JOIN_REQUEST`（連線握手逾時 10 秒並支援最多 2 次指數退避重試；進入審核等待後，審核等待逾時為 15 秒；房主端待審佇列容量上限為 30 筆，並以**房主本機接收時間 `receivedAt`** 計算 30 秒過期自動清理，不信任遠端時間戳）。
  3. **步驟 3 (房主一鍵審核)**：房主面板即時彈出審核通知，點擊「允許」後對該連線單次確定送出 `JOIN_APPROVED` 與房間初始狀態（避免重複觸發廣播），雙方立即啟動低延遲同步，並由房主每 30 秒廣播 `MEMBER_COUNT_UPDATE` 動態校準全房在線人數；點擊「拒絕」則回傳 `JOIN_REJECTED` 並斷開該訪客連線。

### 3.4 複合分享碼協定標準化與全版本向下相容矩陣 (Share Code Schema & Backward Compatibility)

為徹底解決「房主使用伺服器模式，但觀眾預設停在 P2P 模式導致無法加入」之連線衝突，系統自 v2.2 起導入「自描述語意分享碼（Self-Describing Share Code）」與「全版本向下相容智慧解析機制」：

#### 3.4.1 分享碼格式與版本相容矩陣

| 分類 | 格式規則 | 範例 | 判定模式 (Resolved Mode) | 向下相容處理策略 |
| :--- | :--- | :--- | :--- | :--- |
| **新版 P2P 直連** | `P2P:<RoomID>` | `P2P:X7A9B2` | `P2P` | 權威前綴優先，前端自動切換為 P2P 模式 |
| **新版 預設伺服器** | `DEF:<RoomID>\|<Base64Url>` 或 `DEF:<RoomID>` | `DEF:X7A9B2\|aHR0cDovL2xvY2FsaG9zdDozMDAw` | `DEFAULT` | 權威前綴優先，前端自動切換為預設伺服器 |
| **新版/自架主機** | `IP:<RoomID>\|<Base64Url>` | `IP:X7A9B2\|aHR0cDovLzE5Mi4xNjguMS4xMDA6MzAwMA==` | `CUSTOM_IP` | 權威前綴優先，前端自動切換並填入解碼網址 |
| **舊版 複合分享碼** | `<RoomID>\|<Base64Url>` | `X7A9B2\|aHR0cDovL2xvY2FsaG9zdDozMDAw` | `DEFAULT` 或 `CUSTOM_IP` | 依解碼網址是否等同預設伺服器自動分流，覆蓋選單設定 |
| **舊版 純 6 碼代碼** | `<RoomID>` (6 碼英數) | `X7A9B2` | 遵從當前 UI 選定模式 (`P2P` / `DEFAULT`) | 前端顯示舊版提示；若連線失敗提供雙向一鍵重試引導 |

#### 3.4.2 觀眾端「智慧輸入偵測 (Smart Auto-Detection)」行為規範
1. **即時解析切換**：觀眾於輸入框輸入或貼上字串時，前端即時執行非破壞性解析。若偵測到 `P2P:`、`DEF:`、`IP:` 或包含 `|` 之複合碼，自動鎖定或切換上方模式選單，並展示即時識別徽章（⚡ P2P 直連 / 🌐 預設伺服器 / 🖥️ 自架主機）。
2. **乾淨 Room ID 提取**：前後端提取 Room ID 時，一律過濾 `P2P:` / `DEF:` / `IP:` 前綴並截取管道符號前段，保證送入 PeerJS 與 Socket.IO 之房間識別碼均為標準大寫 6 碼英數字。
3. **舊版代碼容錯引導**：針對純 6 碼無前綴字串，前端允許使用者手動自由切換連線模式；若 P2P 逾時或伺服器查無房間，回饋貼心之雙向模式互換重試建議。

### 3.5 三種連線選項特性對比表

| 比較項目 | 1. ⚡ WebRTC P2P 直連 (預設) | 2. 🏢 預設中繼模式 (Official) | 3. 🌐 自行輸入 IP (自架) |
| :--- | :--- | :--- | :--- |
| **自建主機需求** | **免自架主機** | 免自架（使用官方雲端中繼） | 需使用者自建 Node.js 伺服器 |
| **信令與穿透** | PeerJS 6 碼信令 + Google/Cloudflare STUN | WebSocket (Socket.IO) 中繼 | WebSocket (Socket.IO) / LAN |
| **同步傳輸通道** | **加密星狀拓撲 `RTCDataChannel` 直連** | 雲端伺服器中繼廣播 | 自架伺服器中繼廣播 |
| **入房安全機制** | **房主即時審核佇列 (允許 / 拒絕)** | 6 碼房間代碼配對 | 複合分享碼配對 |
| **同步延遲** | **極佳 (~10-40ms 端對端直連)** | 良好 (~50-150ms) | 極佳 (內網 ~5-20ms) |
| **防火牆穿透力** | 適用於一般家用與行動網路 | **最高（支援對稱型 NAT / 企業網路）** | 依自架主機網路配置而定 |

---

## 4. 核心同步演算法與防禦機制

### 4.1 新進人員狀態初始化拉取機制（Pull Mechanism）
為解決新成員加入房間時，需等待下一次心跳而產生的體驗脫節（Stale State Problem）：
* **實作邏輯**：當新觀影者（Guest）成功加入房間（或 P2P DataChannel 開啟）時，向房主（Host）發送 `REQUEST_CURRENT_STATE` 請求。
* 房主端收到後，立刻回傳當前的精確進度與播放狀態，再轉發給該新 Guest，實現秒級同步初始化。

### 4.2 5 秒時間容差與網路延遲補償演算法
同步邏輯必須嚴格區分「主動操作事件」與「被動定時心跳」。

#### 4.2.1 主動操作事件（無視容差，強制作業）
* 當 **房主**（或獲授權的 Guest）手動點擊觸發 `play`、`pause`、`seek`（拖曳進度條）時，Content Script 捕捉事件並立即發送。
* **觀眾端收到此明確操作指令後，必須無視時間差距，立即強制執行狀態與進度同步。**

#### 4.2.2 被動定時心跳同步（5 秒容差與單程延遲補償）
* **房主端**：每隔 3 秒（`Heartbeat_Interval`），自動獲取影片 `video.currentTime`，連同當前時間戳 `timestamp` 進行心跳廣播。
* **觀影者端**：收到心跳廣播後，結合單程網路延遲（Ping 值補償）執行以下判斷演算法：

```typescript
// AI 實作：5秒容差與延遲補償虛擬碼
const serverSentTime = message.data.currentTime;
const serverPaused = message.data.paused !== undefined ? message.data.paused : (message.data.action === 'PAUSE');
const clientReceiveTimestamp = Date.now();
const clientSentTimestamp = message.data.timestamp; // 發送端時間戳

// 計算單程網路延遲 (毫秒轉秒)，異常或負數時保護歸零
const rawLatency = (clientReceiveTimestamp - clientSentTimestamp) / 2 / 1000;
const networkLatency = (rawLatency > 0 && rawLatency < 10) ? rawLatency : 0;

// 播放狀態下的 PLAY、HEARTBEAT 與 SEEK 均補償單程網路延遲
const isPlayingUpdate =
  message.data.action === 'PLAY' ||
  (message.data.action === 'HEARTBEAT' && !serverPaused) ||
  (message.data.action === 'SEEK' && !serverPaused);
const targetServerTime = serverSentTime + (isPlayingUpdate ? networkLatency : 0);
const localTime = video.currentTime;
const timeDiff = Math.abs(localTime - targetServerTime);

if (message.data.action !== 'HEARTBEAT' || timeDiff > 5) {
    // 主動指令無視容差，或被動心跳差距大於 5 秒時強制校準時間
    seekPlayer(targetServerTime);
}
```

---

## 5. 安全防禦與權限管理

### 5.1 強制跳轉功能與 Host 安全白名單防禦
* 當房主切換新影片並點擊「同步此網頁」或觸發連播換集時，系統發送 `REDIRECT_ROOM` 事件。
* **資安防禦（防範惡意釣魚跳轉）**：
  * `REDIRECT_ROOM` 必須**先完成 `isUrlAllowed` 白名單檢查，通過後才更新 `currentRoomState.currentUrl` 與執行分頁導航**；未通過檢查時立即中止並保留既有房間網址，透過多語系警示防轟炸機制提示使用者。
  * 所有網址白名單規則統一收斂於單一宣告式註冊表 [`shared/platforms.ts`](shared/platforms.ts)，嚴禁多處重複撰寫正規表達式造成規則漂移。

```typescript
// 共用宣告式平台檢查（節錄自 shared/platforms.ts 與 background/verifyAndRedirect）
if (!isUrlAllowed(cleanTargetUrl, allowHttp, unlocked)) {
  console.warn('[Syncine Security] 已攔截未授權之重導向網址:', sanitizeLog(cleanTargetUrl));
  return; // 阻斷執行，絕不更新 currentUrl 或呼叫 chrome.tabs.update
}
```

#### 5.1.1 跨平台純淨標準網址轉換 (getCanonicalVideoUrl)
在建房 (`CREATE_ROOM`)、加入 (`JOIN_ROOM`)、綁定目標分頁與強制跳轉 (`REDIRECT_ROOM`) 前，全系統強制調用 `getCanonicalVideoUrl(rawUrl)`，徹底剔除各串流平台夾帶之冗餘追蹤標籤與上下文參數：
* **Netflix**：剔除 `trackId` 與包含 Base64 推薦狀態之長字串 `tctx`，收斂至標準 `https://www.netflix.com/watch/<id>`。
* **YouTube**：剔除推薦來源、播放清單與頻道參數 (`ab_channel`, `list`, `index`, `si`, `pp` 等)，支援標準 `/watch?v=`、`/shorts/`、`/live/` 與 `youtu.be` 短網址標準化。
* **Bilibili**：剔除來源追蹤碼 (`spm_id_from` 等)，保留純淨 `/video/BV...`（若為分 P 則保留 `?p=`，`p=1` 略過）或 `/bangumi/play/ep...`。
* **Niconico / Disney+ 等**：Niconico 剔除 `ref` 檢索參數僅保留 `/watch/<id>`；Disney+ 支援 `/video/`、`/play/` 與 `/series/` 路徑正規化。
* **通用與候選平台參數保護 (`buildCleanGenericUrl`)**：針對依賴查詢參數定位劇集之平台（如 `?id=`、`?ep=`），精準剝離常見廣告追蹤參數（`utm_*`, `fbclid`, `gclid`, `spm*`, `from*`, `track*`, `tctx`, `ref`, `share*`），同時完整保留非追蹤之必要業務參數。
* **效益**：杜絕龐大追蹤標籤造成 URL 解析異常、降低網路通訊負擔、防止個人推薦 Token 洩漏，並保證跳轉白名單比對 100% 精準。

### 5.2 房主權限控制與雙重攔截機制
房主控制面板設有 `[允許觀眾操作播放器]`（`allow_guest_control: boolean`）開關（預設為關閉）。
* **當開關為 False（禁用觀眾操作）時**：
    1. **前端防線**：當 Guest 嘗試點擊或操作播放器（包含播放 `play`、暫停 `pause` 與拖曳進度條 `seeking`）時，Content Script 捕捉到本地事件，立即將影片播放狀態與時間軸（回滾至 `lastSyncedTime`）強制還原，阻止私自快轉或暫停脫節。
    2. **後端/通道防線（核心安全）**：
       - **伺服器模式**：若 Guest 強行發送 `SYNC_STATE` 請求，後端伺服器校驗其 Socket 身分。若發送者非 Host，後端**直接丟棄（Drop）該請求**。
       - **P2P 模式**：房主端（Host Peer）在 DataChannel 監聽來自 Guest 的事件時，若 `allow_guest_control === false`，房主直接丟棄該訊息，不予本地執行與轉發。
* **Strict Payload Schema 與角色欄位過濾（即使開啟 `allow_guest_control === true`）**：
  - 後端與 P2P Host 接收 `SYNC_STATE` 時**必須先執行 `validateSyncData(data, isHost)`**：
    1. `action` 僅允許 `'PLAY' | 'PAUSE' | 'SEEK' | 'HEARTBEAT'`；**僅限房主 (`isHost === true`) 可發送 `HEARTBEAT`**，任何 Guest 嘗試發送 `HEARTBEAT` 一律 Drop。
    2. `currentTime` 必須為有限數值且 `>= 0`；`playbackRate` 若存在必須為有限數值且介於 `[0.25, 4.0]`；`timestamp` 必須為有效數值。
    3. 重新組裝僅包含白名單欄位（`action`, `currentTime`, `paused`, `playbackRate`, `timestamp`）之物件後再轉發，杜絕透傳未定義欄位。

---

### 5.3 跨平台播放清單與上下集 (Next/Prev Episode) 自動連播跳轉同步規範

為解決使用者觀看播放清單、影集或番劇時需頻繁手動換片推播的問題，系統實裝「播放清單與上下集連播自動跳轉同步」標準架構。本規範為所有支援影音串流平台之標準適配模板：

#### 5.3.1 嚴格條件化生效守衛 (Strict Conditional Guard)
為杜絕一般獨立單部影片因非預期導航產生誤跳轉，跳轉同步必須滿足嚴格的條件閘道：
1. **畫面能力偵測 (`isPlaylistOrEpisodeSupported()`)**：
   - 僅當當前頁面或播放器具備「播放清單、分集選集抽屜、或可用的上下集按鈕」時，方判定為支援環境。
   - 若為普通單支影片（無清單、無選集），此判定回傳 `false`，系統保持純進度同步，不觸發換片廣播。
2. **行為捕捉時間戳記 (`markPlaylistActionTriggered`)**：
   - 在捕獲階段 (Capture phase) 監聽使用者的換集／清單點擊行為，並記錄時間戳記 `lastPlaylistActionTime`。
   - 當影片播放完畢觸發 `<video>` 的 `ended` 事件且當前處於清單／影集頁面時，自動登記換集信號（時間窗口有效期 15 秒）。
3. **雙重門檻**：網址切換時，必須符合 `(isPlaylistOrEpisodeSupported() || isRecentAction)` 且 `currentVideoId !== roomVideoId`，方會啟動廣播。

#### 5.3.2 房主本地無重整與全房無縫跳轉 (Host Seamless Navigation)
- **問題**：房主在網頁上點擊「下一集」或自動連播時，瀏覽器分頁已由平台前端完成換片與播放器更新。若 Background 接獲廣播後再次對房主分頁呼叫 `chrome.tabs.update`，會導致房主分頁被強制重整、影片重頭載入與畫面閃爍。
- **標準解決方案**：
  - Background 在 `verifyAndRedirect(targetUrl)` 中比對：
```typescript
const activeVideoId = getVideoIdentifier(activeTab.url);
const targetVideoId = getVideoIdentifier(cleanUrl);
const isAlreadyOnVideo = (activeTab.url && activeTab.url === cleanUrl) || 
                        (activeVideoId && targetVideoId && activeVideoId === targetVideoId);
if (isAlreadyOnVideo) {
  // 房主分頁已處於目標影片，僅發送狀態變更通知，略過 tabs.update
  chrome.tabs.sendMessage(tabId, { type: 'CS_ROOM_STATE_CHANGED', payload: currentRoomState });
} else {
  // 觀眾端分頁執行跳轉導航
  chrome.tabs.update(tabId, { url: cleanUrl });
}
```

#### 5.3.3 劇集與分 P 唯一識別碼與標準網址規範
各平台換集判定必須依賴標準化唯一識別碼：
- **YouTube**：`yt:<id>`。播放清單切換時 ID 變更即觸發跳轉。
- **Bilibili**：
  - 普通影片（單 P）：`bili:<BV>`
  - 多 P 影片：`bili:<BV>?p=<part>`（當 `p !== '1'` 時保留參數，確保分 P 切換正確辨識為不同視頻目標）
  - 番劇劇集：`bili:<ep_id>`（如 `bili:ep12345`）
- **Netflix**：`netflix:<watch_id>`（提取 `/watch/12345678`），徹底過濾 `tctx` 等追蹤參數。

#### 5.3.4 防抖與全域導航事件監聽
為相容各串流平台之單頁應用（SPA）與前端路由，Content Script 必須建立防抖導航監聽器（Debounce 400ms），統一彙整以下事件：
1. 平台專屬導航事件（如 YouTube `yt-navigate-finish`）
2. 瀏覽器歷史導航（`popstate` 與 `hashchange`）
3. 頂層 DOM 監聽（`MutationObserver` 監控 `window.location.href` 變更）

### 5.4 權限宣告與支援名單解耦架構 (Permission Scope vs. Platform Registry)

為防止未來每新增一個支援網站就導致 Chrome Web Store 觸發「擴充功能已停用，需要接受新權限」之彈跳警告並中斷使用者體驗，自 **v2.10.0** 起全面導入「權限預授權與支援名單解耦架構」：

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        權限宣告與支援名單解耦分層                        │
├────────────────────────────────────────────────────────────────────────┤
│ 1. 廣義權限預授權層 (Manifest Level)                                  │
│    manifest.json 中的 host_permissions 與 content_scripts.matches      │
│    一次性宣告所有現行 (18個) 與潛在候選 (8個) 合法串流影音網域          │
├────────────────────────────────────────────────────────────────────────┤
│ 2. 中央平台登錄表 (Central Platform Registry - shared/platforms.ts)   │
│    單一宣告式 PLATFORM_REGISTRY（含 domains, urlPatterns, enabled）    │
│    唯一衍生 isPlatformActive / isPlatformPermitted / isUrlAllowed      │
├────────────────────────────────────────────────────────────────────────┤
│ 3. 執行期動態控制 (Runtime Early Bailout & Strict Filtering)          │
│    - Content Script: 未啟用網域立即 early return，零 DOM/Port 開銷     │
│    - Background & Server: 嚴格檢驗 SSRF 內網封鎖與合法平台白名單        │
│    - 高風險/盜版站台 (如 Anime1.me): 移出 manifest 與正式清單，僅供彩蛋│
└────────────────────────────────────────────────────────────────────────┘
```

#### 5.4.1 設計動機與 Chrome MV3 權限規範
- **痛點**：Chrome 擴充套件若在版本更新中於 `host_permissions` 新增先前未宣告之 Host，Chrome 瀏覽器會自動停用該擴充套件，並向使用者展示高度戒備之安全權限授權對話框，嚴重影響用戶留存率與更新體驗。
- **解法**：預先在 `manifest.json` 宣告 8 大潛在合法候選平台網域（LiTV、WeTV、Bilibili 國際版、Dailymotion、Hulu、Peacock、Paramount+、HBO GO Asia）；`CATCHPLAY+` 已完成驗證並轉正納入 18 大正式平台。

#### 5.4.2 中央平台登錄表 (`shared/platforms.ts`) 規範
前後端共用 `shared/platforms.ts` 單一真理來源（後端透過同步檢查確保 `server/src/shared/platforms.ts` 與根目錄 `shared/platforms.ts` 位元組級完全一致）：
- **`enabled: true` (現行正式支援平台，共 18 個)**：YouTube、Bilibili、Niconico、CATCHPLAY+、Netflix、Vimeo、巴哈姆特動畫瘋、Twitch、Disney+、Prime Video、MyVideo、LINE TV、KKTV、Crunchyroll、遠傳 friDay 影音、Max、愛奇藝、Apple TV+。
- **`enabled: false` (候選預宣告平台，共 8 個)**：LiTV、WeTV、Bilibili 國際版 (bilibili.tv)、Dailymotion、Hulu、Peacock、Paramount+、HBO GO Asia（已在 Manifest 註冊授權，尚未開放，處於靜默停用狀態）。
- **`HIGH_RISK_STREAMING_CATALOG` (非官方／高風險影視清單)**：包含 `Anime1.me`、Gimy 劇迷、楓林網等盜版／高風險網站；完全移出 `manifest.json` 靜態授權與正式支援清單，僅在手動啟用隱藏彩蛋且處於當前使用中分頁 (`activeTab`) 時由使用者手動注入通用播放器支援。

#### 5.4.3 執行期零負載提早返回與 SPA 首頁導航相容 (Zero-Overhead Early Bailout)
Content Script 注入目標網頁頂層時，以網域級啟用守衛 `isPlatformDomainActive` 搭配路徑級守衛 `isPlatformActive` 控制生命週期：
```typescript
const isSiteActive = isPlatformDomainActive(location.href, unlocked) || isPlatformActive(location.href, unlocked);
if ((isTopFrame || isDedicatedIframe) && isSiteActive) {
  activateContentScript(); // 啟動 Port 保活、SPA 導航與 Video 觀察器
}
// 若為未啟用之候選網域 (isSiteActive === false)，100% 靜默退出，零 DOM 監聽、零 Port、零 Console 輸出
```
此設計同時確保使用者從已開放平台首頁（如 `/browse`、`/`）透過 SPA 路由點進播放頁時能無縫掛載播放器，且未解鎖之候選平台保持絕對靜默。

#### 5.4.4 前後端雙重安全白名單與 SSRF 防禦
- **客戶端 Background SW (`isUrlAllowed`)**：所有發起跳轉或廣播之 URL 先透過 `isPrivateOrInternalHost` 封鎖內網 IP 與特殊本機位址，並依 `https:`（或開發自訂環境允許之 `http:`）校驗 `isPlatformActive(targetUrl, unlocked)`。
- **後端伺服器 (`isServerUrlAllowed`)**：中繼伺服器在 `CREATE_ROOM` 與 `REDIRECT_ROOM` 強制驗證 `https:`（開發例外可由統一函式判斷）、執行 `isPrivateOrInternalHost` SSRF 防禦，並放行 `isPlatformPermitted(targetUrl)`（18 大正式 + 8 大預授權候選平台）或當 `allowUniversal === true` 時經 `isUniversalSupportedUrl(url, allowHttp)` 驗證為公開合法之 HTTP(S) 網址。

#### 5.4.5 控制面板 (Popup UI) 嚴格二元狀態原則
為維持 UI 乾淨直觀，針對已在 Manifest 宣告但 `enabled: false` 之候選網站：
- **嚴格維持二元狀態 (Strict Bi-State)**：僅提供「綠燈（已啟用支援）」與「紅燈（不支援）」。
- **不得展示黃燈或籌備中特殊標籤**：依規格嚴格禁止顯示「即將推出 / 籌備中」之特權樣式或黃色燈號，一律退回標準未支援之紅燈警告，避免干擾使用者判斷。

#### 5.4.6 隱藏測試彩蛋 (Triple-Click Easter Egg) 與通用影片方案 (Generic Fallback)
為便於內部測試與先導體驗，系統實裝隱藏式全開開關：
1. **版本號 3 次連擊觸發**：使用者於 Popup 控制面板右上角之版本號標籤連續點擊 3 次，即可切換儲存旗標 `syncine_unlock_candidates`。
2. **全開預授權與通用模式**：解鎖狀態下，8 大預授權候選串流平台（LiTV、WeTV、Bilibili 國際版、Dailymotion、Hulu、Peacock、Paramount+、HBO GO）與手動透過 `activeTab` 點擊開啟之非官方站台（如 Anime1.me）轉為通用同步支援；背景自動分頁跳轉僅在具備 `activeTab` 手勢或預授權網域下生效。
3. **標準影片通用方案 (`findGenericVideoElement`)**：針對通用支援網站，Content Script 自動以 HTML5 `<video>` 元素的可見面積、播放時長與已載入來源進行智能探測，並調用原生 `play()`, `pause()`, `currentTime` 執行標準同步控制。

### 5.5 跨平台原生播放器安全控制適配器 (Cross-Platform Native Player Bridge Specification)

為徹底解決大型影音串流平台（如 Netflix、YouTube）採用 DASH/MSE 分片緩衝、DRM 授權保護或專屬狀態機所引發之控制遲滯與播放器崩潰問題，系統實施「雙層環境安全調用適配器 (Dual-Layer Bridge Adapter)」標準規範：

#### 5.5.1 執行環境職責分工 (World Isolation & Bridging Architecture)
1. **Isolated World (Content Script)**：
   - 負責房間狀態管理、P2P / Background 通訊、DOM 節點監視與通用事件捕捉。
   - 不得直接操作具備專屬播放引擎之 HTML5 `<video>` 元素（嚴禁直接賦值 `video.currentTime`、`video.play()`、`video.pause()`），改為派發具備安全資料結構之 `CustomEvent`。
2. **MAIN World (Dedicated Bridge Script)**：
   - 於 Manifest 宣告 `world: "MAIN"`, `run_at: "document_start"`，直接運行於目標頁面全域 JavaScript 執行環境。
   - 監聽自訂控制事件，直接調用平台官方內部 API，並於執行完畢後標記 `document.documentElement.dataset` 作為握手狀態回執。

#### 5.5.2 核心平台適配器標準實裝
1. **Netflix Cadmium Bridge (`netflix_bridge.ts`)**：
   - 監聽 `SYNCINE_NETFLIX_CMD`。
   - 透過 `window.netflix.appContext.state.playerApp.getAPI().videoPlayer` 調用 `seek(ms)`、`play()`、`pause()`。
   - 必須將秒數精確換算為毫秒 (`Math.floor(currentTime * 1000)`)，杜絕直接修改 `currentTime` 導致 Cadmium 崩潰。
2. **YouTube MoviePlayer Bridge (`youtube_bridge.ts`)**：
   - 監聽 `SYNCINE_YOUTUBE_CMD`。
   - 鎖定原生 `#movie_player` API：
     - **跳轉 (SEEK)**：呼叫 `player.seekTo(detail.currentTime, true)`，強制開啟 `allowSeekAhead` 預拉取遠端影音分片，杜絕黑屏卡頓。
     - **播放/暫停 (PLAY/PAUSE)**：呼叫原生 `player.playVideo()` 與 `player.pauseVideo()`，徹底繞過 Chrome Autoplay 阻攔與內部播放狀態脫節。
     - **倍速 (RATE)**：呼叫 `player.setPlaybackRate(detail.playbackRate)`。
   - **底層事件互斥防線**：
     - 在 Content Script 之 `pause` 監聽器中，嚴格設置 `if (video.seeking || isUserSeeking) return;`，阻斷 YouTube 進度條拖曳時底層瞬態暫停所外發的偽 `PAUSE` 廣播。
     - 跳轉狀態認定依據：`const isPaused = wasPlayingBeforeSeek ? false : targetVideo.paused;`，防止跳轉中斷播放。

### 5.6 行為級播放控制權衝突偵測與隱私安全診斷規範 (Playback Contention Detection & Zero-Permission Diagnostic Logging)

為防範使用者瀏覽器同時安裝其他同類同步擴充套件或第三方播放腳本，於同一支影片上搶奪控制權導致反覆拉扯、閃爍或使用者誤判故障，系統實施「**零額外權限之行為級衝突偵測與脫敏回報**」標準規範：

#### 5.6.1 最低權限與隱私零洩漏核心原則 (Zero-Permission & Privacy First)
1. **嚴禁新增權限與全域 Console 劫持**：
   - `manifest.json` 嚴禁加入 `management`、`debugger`、`<all_urls>` 或其他擴充套件列舉權限，確保舊用戶更新不受停用影響。
   - **禁止監聽、截取或上傳網頁原始 `console.log`/`console.warn`/`console.error`**，防範意外記錄頁面帳號、Token、播放網址查詢參數或第三方隱私訊息。
2. **純內部狀態機結構化紀錄**：
   - 衝突紀錄僅由 Syncine 內部狀態機 (`PlaybackContentionDetector`) 自行產生，欄位僅限：時間戳、平台 ID 與純網域（僅保留 `hostname`，徹底剝離 `pathname`/`search`/`hash`）、期望與觀測狀態翻轉（如 `PAUSED -> PLAY`）、距前次指令之毫秒差、近期有無使用者輸入標記、計數與角色/模式。
   - 全數紀錄皆須通過 `sanitizeLog` / `sanitizeIp` / `sanitizeDetails` 管線濾除敏感鍵值與識別碼（`roomId` 遮蔽中間碼）。

#### 5.6.2 行為級打架偵測與斷路器 (Ping-Pong Detector & Circuit Breaker)
1. **事件歸因**：被動監聽 `pointerdown` 與 `keydown` 時間戳作為「是否為使用者手動交互」之參考信號（**絕對不可用來阻擋鍵盤媒體鍵、子母畫面 PiP 或自動化測試正常播放操作**）。
2. **衝突門檻**：當 Syncine 剛執行完權限回滾或同步控制（`expectedState`），若於 6 秒滑動視窗內發生 $\ge 3$ 次間隔 $\le 2500\text{ms}$ 且無房主新指令之反向狀態跳變（例如剛強制暫停隨即被外部腳本拉回播放），即觸發衝突偵測 (`conflictDetected = true`)。
3. **斷路器保護 (Circuit Breaker)**：進入衝突狀態後，針對被連續搶奪之重複觀眾權限回滾實施漸進式冷卻退避（`2000ms`），避免每 400ms 互搶導致解碼器卡頓閃爍；**房主發出之任何新同步指令仍享有最高優先權即時執行，不影響正常同步功能**。

#### 5.6.3 跨模式統一診斷回報與 UI 非阻斷引導
- Background 維護跨模式（`DEFAULT` / `CUSTOM_IP` / `P2P`）通用脫敏事件環形緩衝區（FIFO 40 筆），與 Offscreen P2P 診斷日誌合併匯出至統一診斷報告 (`GET_P2P_DIAGNOSTIC` / `GET_DIAGNOSTIC_REPORT`)。
- 當偵測到衝突時，Content Script 透過 `BG_PLAYBACK_CONFLICT_DETECTED` 通知 Background 更新 `roomState.playbackConflict`，Popup 控制面板動態呈現溫和之琥珀色衝突提示橫幅，引導使用者停用同類擴充套件，並可一鍵「複製脫敏衝突報告」或「回報問題至 GitHub」。

---

## 6. Chrome Extension MV3 限制與保活架構 (Keep-Alive)

由於 Chrome Manifest V3 的 Background Service Worker 會在不活動 30 秒後自動休眠，導致長連接中斷，AI 實作時必須包含以下**保活與工作階段還原機制**：

1. **Port 長連接保活**：當任何支援的影片網頁開啟且套件啟用時，Content Script 必須與 Background Script 建立 `chrome.runtime.connect({ name: "syncine-keepalive" })` 通道。只要此通道維持開啟狀態，Service Worker 就不會進入休眠。
2. **合規 Alarm 喚醒備援**：Background Script 僅於**活躍房間連線期間**註冊 `chrome.alarms`（週期 `periodInMinutes: 0.5`，符合 MV3 最小 0.5 分鐘規範），離開房間或連線結束後立即 `chrome.alarms.clear()`；觸發時執行本機連線狀態健康巡檢與重連補償（依賴 Socket.IO 內建 Engine.IO ping/pong，不向後端發送無接收端之冗餘自訂事件）。
3. **SW 喚醒非同步 Hydration 防競爭與全狀態持久化**：
   - Service Worker 啟動時透過單例 `ensureSessionHydrated()` Promise 讀取 `chrome.storage.local` 還原房間狀態；所有依賴 `currentRoomState` 之關鍵訊息處理器（含 `BG_REDIRECT_ROOM`、`BG_TOGGLE_PERMISSION`、`BG_REQUEST_INIT_SYNC`）必須先 `await ensureSessionHydrated()`，且所有房內狀態異動（含權限切換與 P2P 連線狀態切換）均須呼叫 `persistRoomSession()` 持久化。
   - 若還原之工作階段為 `P2P` 模式，SW 喚醒後應自動重啟 Offscreen 連線復原程序而非停留在未觸發重連的 `RECONNECTING` 狀態。

---

## 7. 目標平台整合指南 (DOM 選擇器)

AI 在編寫 Content Script 時，請針對當前核心支援平台採用以下選擇器與注入策略：

### 7.1 YouTube
* **Video 選擇器**：`document.querySelector('video.html5-main-video')`
* **整合重點**：
  - YouTube 屬於 SPA（單頁應用）架構，切換影片時網頁不重新整理。必須監聽 `yt-navigate-finish` 事件，並搭配 `MutationObserver`，一旦偵測到 URL 改變，立即重新綁定 Video 監聽器。
  - **廣告過濾**：當頁面偵測到廣告元素（如 `.video-ads`、`.ytp-ad-player-overlay`）存在時，進入「廣告靜默狀態」，期間暫停發送與接收所有進度同步信號。

### 7.2 Bilibili (嗶哩嗶哩)
* **Video 選擇器**：`document.querySelector('.bpx-player-video-wrap video')`
* **整合重點**：影片 DOM 元素採非同步動態載入。Content Script 啟動時元素可能尚未生成，必須使用 `MutationObserver` 監聽父節點，直到目標 `<video>` 出現在 DOM 中再行綁定。

---

### 7.3 Netflix
* **Video 選擇器**：`document.querySelector('video')`
* **原生播放器控制**：透過 Main World Bridge 調用 `netflix.appContext.state.playerApp.getAPI().videoPlayer.getVideoPlayerBySessionId(...)`。
* **整合重點**：
  - 由於 React 內部合成事件封鎖，直接修改 `video.currentTime` 不會生效，必須使用 Bridge 調用 `player.seek(ms)`。
  - 下一集按鈕：`[data-uia="control-next"]`、`[data-uia*="next-episode"]`、`.button-nfVideos-next`。
  - 劇集選集面板：`[data-uia="control-episodes"]`。

### 7.4 播放清單與上下集按鈕選擇器與適配器規範 (Platform Adapters & DOM Selectors)
Content Script 採模組化 `VideoPlatformAdapter` 架構（`extension/src/content/adapters/`），各平台定義獨立的網域比對 (`matchesUrl`)、影片探測 (`findVideo`)、廣告檢查 (`isAdPlaying`)、連播支援偵測 (`isPlaylistSupported`) 與點擊選擇器 (`playlistClickSelectors`)，嚴格確保泛用 CSS class 不得跨站誤觸：

| 平台 | 清單/選集容器能力偵測選擇器 | 下一部 / 下一集按鈕選擇器 |
| :--- | :--- | :--- |
| **YouTube** | `ytd-playlist-panel-renderer, #playlist, .ytd-playlist-panel-renderer, #playlist-items` | `.ytp-next-button, .ytp-prev-button, ytd-playlist-panel-video-renderer, .ytp-autonav-endscreen-upnext-button` |
| **Bilibili** | `#multi_page, .cur-list, .ep-list-wrapper, .section-ep-wrapper` | `.bpx-player-ctrl-btn-next, .bpx-player-ctrl-btn-prev, .squirtle-video-next, .ep-item, .part-item` |
| **Niconico** | `[class*="Playlist"], [class*="Series"], [data-anchor-area="playlist"]` | `[data-anchor-area="next_video"], [data-anchor-area="prev_video"], [aria-label*="次の動画"], [class*="Series"] a, [class*="Playlist"] a` |
| **CATCHPLAY+** | `.episode-list, [class*="episode" i], [data-testid*="episode"]` | `.episode-item, .next-episode, [class*="episode" i], [aria-label*="Next" i], [aria-label*="下一集"]` |
| **Netflix** | `[data-uia="control-episodes"], [data-uia*="postplay"]` | `[data-uia="control-next"], [data-uia*="next-episode"], .button-nfVideos-next, [data-uia="next-episode-seamless-button"]` |
| **巴哈姆特動畫瘋** | `section.season, .ani-tabs, .season ul li, .ani-episode__item` | `.ani-control__btn--next, section.season a, .ani-tabs a` |
| **Vimeo** | `.playlist-container, .showcase-item, .vp-teleport-tray` | `[aria-label*="Next video"], .vp-teleport-tray a, .showcase-item a` |
| **Twitch** | `[data-a-target="collection-item"], [data-a-target="player-next-video-button"]` | `[data-a-target="player-next-video-button"], [data-a-target="collection-item"]` |
| **Disney+** | `[data-testid*="up-next"], [data-testid="episode-card"]` | `[data-testid*="next-episode"], [data-testid*="up-next"], .up-next-card` |
| **Prime Video** | `.dv-player-next-episode, .nextUpCard` | `[data-testid="next-episode-button"], .next-episode, .nextUpCard` |
| **MyVideo** | `.episode-item, .episode_list, .drama-episode, .season-list` | `.episode-item, .drama-episode, .season-list a, .episode_list a` |
| **LINE TV** | `.eps-item, .ep-btn, [data-testid="next-episode"], .episode_li, .eps_item` | `.eps-item, .ep-btn, [data-testid="next-episode"], .episode_li, .eps_item` |
| **KKTV** | `.play-series-item, .next-episode-btn, .series-item, [data-testid*="next-episode"]` | `.play-series-item, .next-episode-btn, .series-item, [data-testid*="next-episode"]` |
| **Crunchyroll** | `[data-t="next-episode-btn"], .playable-card, [data-t="episode-card"], .next-episode-btn` | `[data-t="next-episode-btn"], .playable-card, [data-t="episode-card"], .next-episode-btn` |
| **遠傳 friDay 影音** | `.episode-item, .drama-item, .item-episode, [data-episode]` | `.episode-item, .drama-item, .item-episode, [data-episode]` |
| **Max (HBO Max)** | `[data-testid*="next-episode"], [data-testid*="up-next"], [aria-label*="Next Episode"]` | `[data-testid*="next-episode"], [data-testid*="up-next"], [aria-label*="Next Episode"]` |
| **愛奇藝 (iQIYI)** | `.album-item, .episode-item, .iqp-btn-next, [data-player-hook="next-btn"]` | `.album-item, .episode-item, .iqp-btn-next, [data-player-hook="next-btn"]` |
| **Apple TV+** | `[data-testid*="next-episode"], .upstream-next-item, [aria-label*="Next Episode"]` | `[data-testid*="next-episode"], .upstream-next-item, [aria-label*="Next Episode"]` |

---

## 8. 通訊協定與信令規格 (Protocol Schema)

請嚴格按照 `shared/protocol.ts` 定義之以下 TypeScript 型別來實作前後端與 P2P 通訊及嚴格欄位校驗邏輯：

```typescript
// 連線模式列舉
export type ConnectionMode = 'DEFAULT' | 'CUSTOM_IP' | 'P2P';

// 分享碼解析結果結構 (全版本向下相容)
export type DetectedShareCodeType = 'P2P' | 'DEFAULT' | 'CUSTOM_IP' | 'LEGACY_RAW' | 'LEGACY_COMPOSITE';

export interface ParsedConnectionInfo {
  roomId: string;             // 6 碼大寫 Room ID (例如 "IW7OL7")
  mode: ConnectionMode;       // 判定之連線模式
  serverUrl: string;          // 目標伺服器網址 (一律填值；P2P 時保留預設或空值佔位)
  isLegacy: boolean;          // 是否為舊版格式 (無前綴純 6 碼或舊版複合碼)
  detectedType: DetectedShareCodeType;
}

export type SyncineEvent =
  | 'CREATE_ROOM'
  | 'CREATE_ROOM_SUCCESS'
  | 'JOIN_ROOM'
  | 'JOIN_ROOM_SUCCESS'
  | 'LEAVE_ROOM'
  | 'REQUEST_CURRENT_STATE'
  | 'REQUEST_INIT_SYNC'
  | 'SYNC_STATE'
  | 'REDIRECT_ROOM'
  | 'TOGGLE_PERMISSION'
  | 'GET_ROOM_MEMBER_COUNT'
  | 'MEMBER_COUNT_UPDATED'
  | 'HOST_CHANGED'
  | 'HOST_PRIVILEGE_GRANTED'
  | 'ERROR';

export interface SyncData {
  action: 'PLAY' | 'PAUSE' | 'SEEK' | 'HEARTBEAT';
  currentTime: number;   // 必須為有限數值且 >= 0
  timestamp: number;     // 發送端 Date.now()
  paused?: boolean;      // 播放/暫停旗標
  playbackRate?: number; // 倍速限制範圍: 0.25 <= playbackRate <= 4.0
}

// 嚴格執行期 Payload 校驗與白名單欄位清理 (前後端共用)
export function validateSyncData(raw: unknown, isHost: boolean): SyncData | null;

// 1. 建立房間請求 (Client -> Server)
export interface CreateRoomReq {
  userId: string;
  currentUrl: string;
  mode: ConnectionMode;
  allowUniversal?: boolean;
  language?: string; // 選填，長度 <= 10，僅供伺服器運行日誌統計，不廣播給其他成員
}

// 2. 建立房間成功 (Server -> Client) — 前端依 mode / serverUrl 組裝分享碼
export interface CreateRoomRes {
  roomId: string;
  allowGuestControl: boolean;
  resumeToken: string; // 房主專屬安全憑證，防冒名劫持
}

// 3. 加入房間請求 (Client -> Server)
export interface JoinRoomReq {
  roomId: string;
  userId: string;
  allowUniversal?: boolean;
  resumeToken?: string; // 斷線回魂申領房主權限之憑證
}

// 4. 加入房間成功 (Server -> Client)
export interface JoinRoomRes {
  roomId: string;
  isHost: boolean;
  allowGuestControl: boolean;
  currentUrl: string;
  memberCount: number;
  resumeToken?: string; // 僅當以房主身分回魂時回傳
}

// 5. 狀態同步信號 (Client <-> Server)
export interface SyncStateMsg {
  roomId: string;
  targetGuestSocketId?: string;
  data: SyncData;
}

// 6. 強制網頁跳轉廣播 (Host -> Server -> Guest)
export interface RedirectRoomMsg {
  roomId: string;
  targetUrl: string;
}

// 7. 房主權限變更廣播
export interface TogglePermissionMsg {
  roomId: string;
  allowGuestControl: boolean;
}

// 8. P2P DataChannel 專屬信令聯合型別
export type P2PDataMessage =
  | { type: 'JOIN_REQUEST'; guestName: string; timestamp?: number }
  | { type: 'JOIN_APPROVED'; roomId: string; currentUrl: string; allowGuestControl: boolean; memberCount: number }
  | { type: 'JOIN_REJECTED'; reason: string }
  | { type: 'REQUEST_INIT_SYNC' }
  | { type: 'REQUEST_CURRENT_STATE' }
  | { type: 'SYNC_STATE'; data: SyncData }
  | { type: 'REDIRECT_ROOM'; targetUrl: string }
  | { type: 'TOGGLE_PERMISSION'; allowGuestControl: boolean }
  | { type: 'MEMBER_COUNT_UPDATE'; count: number };
```

---

## 9. 異常處理與短中期優化項目

### 9.1 核心異常邊界條件 (已實裝覆蓋)
* [x] **緩衝卡頓處理（僅房主觸發，v2.3.1 修訂）**：
    1. **觸發條件**：僅當 **房主 (Host)** 的 `<video>` 觸發 `waiting` (Buffering) 並持續超過 5 秒（防抖，且非廣告期間、非程式化操作）時，向房間發送 `PAUSE`，讓全房等待房主，避免觀眾進度領先過多。
    2. **觀眾端卡頓不外發任何指令**（含已獲授權操作之觀眾）：觀眾自身網路卡頓僅在本機緩衝，不得暫停全房；落後進度由心跳之 5 秒容差機制校正。
    3. **心跳一致性**：房主處於「已確認卡頓」期間，心跳 `HEARTBEAT.paused` 一律回報 `true`，避免觀眾被下一次心跳（`paused:false`）立即恢復播放而使暫停失效。
    4. **自動恢復**：房主影片恢復（`playing` 事件）且未被手動暫停時，房主主動發送一次 `PLAY`（附當前 `currentTime`）以恢復全房；若房主於卡頓期間手動暫停，則不發送 `PLAY`。
* [x] **時間軸跳轉對齊**：主動 SEEK 事件除校準時間戳外，雙向同步發送端之 `paused` 狀態，避免跳轉後接收端定格暫停。
* [x] **伺服器執行期異常防護與邊界驗證 (P0 防崩潰)**：全面以 `safeHandler` 包裝所有 Socket 事件回呼函式，嚴格校驗 Payload 為非空物件，並配置全域 `uncaughtException` 與 `unhandledRejection` 保護，防止單一惡意/畸形封包崩潰整個 Node.js 伺服器程序。
* [x] **嚴格房間隔離與防跨房廣播注入 (P0 房間安全)**：伺服器處理 `SYNC_STATE`、`REDIRECT_ROOM`、`TOGGLE_PERMISSION` 與信令轉發時，一律以 `socketToRoom` 映射為唯一房間真理來源，嚴格比對客戶端上報之 `roomId`；若帶有 `targetGuestSocketId`，必須確認目標連線同處於同一房間，徹底杜絕跨房操作與指令注入。
* [x] **P2P 多人連線競爭修復與雙階段逾時機制 (P0 連線穩定)**：觀眾端修復核准狀態輪詢，握手逾時為 **10 秒**（支援最多 2 次指數退避重試，間隔 1.5s / 3s），連線建立後等待房主審核逾時為 **15 秒**；逾時主動觸發 `ERR_P2P_TIMEOUT` 解鎖介面轉圈並引導改用中繼模式。房主端待審佇列容量上限 30 筆，一律以房主本機接收時間 (`receivedAt`) 判定 30 秒逾期清理，且每筆核准僅單次確定送出 `JOIN_APPROVED`。
* [x] **P2P 房主權威與特權指令安全過濾 (P0 權限防禦)**：房主端 Offscreen Document 監聽觀眾 DataChannel 時，嚴格丟棄任何觀眾發起之 `REDIRECT_ROOM` 與 `TOGGLE_PERMISSION` 特權指令；當房主關閉「允許觀眾操作」時，一律丟棄觀眾之播放動作（PLAY/PAUSE/SEEK），確保房主權威不被繞過。
* [x] **房主身分識別防劫持 (P1 resumeToken 機制)**：伺服器建房時簽發不可預測之安全憑證 `resumeToken`，僅房主本地持有；斷線重連寬限期 (Grace Period) 內，客戶端必須攜帶有效之 `resumeToken` 方可重申房主身分，若無 Token 或 Token 不符則一律降級為普通觀眾；原房主離線逾時轉移新房主時，透過私有事件 `HOST_PRIVILEGE_GRANTED` 獨立發送新 Token 給繼任房主，徹底杜絕公開 `userId` 冒名劫持。
* [x] **密碼學安全隨機亂數 (P1 加密安全)**：後端房號生成全面淘汰 `Math.random()` 改採 Node.js 原生 `crypto.randomInt`；擴充套件端房號與使用者識別碼改採 Web Crypto API `crypto.getRandomValues()`，根除可預測亂數與碰撞風險。
* [x] **伺服器雙維度頻率限制、全域房間上限與防洪保護 (P1/P2 Rate Limiting)**：
    1. **高頻播放同步限流**：`SYNC_STATE` 限制單一 Socket 每秒最多 15 次，超限靜默丟棄 (Silent Drop)，杜絕巨量播放進度廣播風暴。
    2. **低頻敏感操作限流**：`CREATE_ROOM` / `JOIN_ROOM` 限制單一 Socket 及單一來源 IP 10 秒內最多 6 次（防範斷線重連換 `socket.id` 繞過），超限即時拋出 `ERR_RATE_LIMITED`。
    3. **惡意攻擊強制斷線與全域房間上限**：若單一 Socket 或來源 IP 於 1 秒內累積請求突破 50 次（或同 IP 併發建立過多連線），伺服器判定為惡意 DoS 攻擊並主動強制斷開 (`socket.disconnect(true)`)；`RoomManager` 強制實施全域 `MAX_ROOMS`（預設 1,000）保護 256MB 容器記憶體，超過上限拒絕建房並回傳 `ERR_ROOM_FULL`。
* [x] **WebRTC P2P ICE 連線失敗重試與備援機制 (P1 ICE Retry)**：
    1. **多重 STUN 伺服器節點池**：配置 Google 與 Cloudflare 多組 STUN 伺服器，提升受限 NAT 網絡下 Candidate 收集成功率。
    2. **指數退避重試狀態機**：觀眾端握手超時或 ICE 連線失敗時觸發自動重試（最多 2 次，間隔 1.5s / 3s），重試期間保持介面連線狀態同步。
    3. **友好引導降級**：重試耗盡仍無法打洞穿透時，回報 `ERR_P2P_TIMEOUT` 並引導使用者切換至預設伺服器或自架主機模式。
* [x] **P2P 結構化診斷日誌與 GitHub Issue 一鍵回報 (P1 觀測與隱私安全)**：
    1. **環形記憶體日誌緩衝區**：Offscreen Document 維護長度固定為 60 筆之記憶體 FIFO 佇列，嚴格追蹤 PeerJS 初始化、STUN 探測、信令握手、DataChannel 開啟與重試階段之結構化事件。
    2. **開源隱私零洩漏脫敏 (Privacy First)**：匯出前強制將所有 IPv4（遮蔽後兩段如 `192.168.*.*`）、IPv6、Token 與識別碼（`roomId`、`peerId`、`userId`、`requestId` 遮蔽中間碼如 `WN***RQ`）進行遮蔽清毒，僅記錄 Candidate 類型（host/srflx/relay）與協定。
    3. **GitHub Issue 預填與剪貼簿備援**：連線異常時於 Popup 動態呈現「回報問題至 GitHub」與「複製診斷報告」按鈕（若為房主主動拒絕入房申請 `ERR_AUDIT_REJECTED`，屬正常權限決策，不提供錯誤回報按鈕），點擊後自動生成結構化 Markdown 報告、預填 Issue 標題/標籤並新開分頁，同時複製至剪貼簿，兼具極致安全性與無摩擦回報體驗。
* [x] **廣告干擾隔離**：在 YouTube 等平台廣告播放期間，嚴格暫停發送與接收同步事件，避免廣告時長干擾正片進度。
* [x] **斷線重連機制**：`socket.io` 實作指數型退避重連；重連成功後自動攜帶 Room ID 重新註冊。
* [x] **房主離線處理**：當 Host 斷線超過 30 秒未恢復，通知房間成員並升級加入時間最早之 Guest 為新房主。

### 9.2 短中期優化項目 (Short-to-Medium Term Optimizations)
1. **突發斷線恢復機制 (Auto-Reconnection & Grace Period)**：
   - 透過 `chrome.storage.local` 本地持久化工作階段（Session Persistence），防範瀏覽器重啟或 SW 休眠遺失房號。
   - 伺服器端實施「主動退房立即銷毀」與「非預期突發斷線 60 秒保留寬限期 (Grace Period)」，在寬限期內原房成員重新連線即自動取消消滅計時器，實現平滑無感「回魂」。
2. **Log 資訊注入攻擊防護 (Log Injection Defense)**：
   - 前後端全面配置日誌清毒輔助函式（`sanitizeLog`），對使用者傳入之 `userId`, `roomId`, `targetUrl`, `reason` 等欄位徹底過濾 CRLF 換行符（`\r\n`）與不可見控制字元，防止偽造日誌行（Log Forging / CRLF Injection）與終端機轉義攻擊，並設定最大截斷長度防止日誌爆破。
3. **客戶端中繼伺服器按需連線狀態確認 (On-Demand Connectivity Healthcheck)**：
   - 僅當使用者於控制面板切換至「預設中繼伺服器 (`DEFAULT`)」模式時，才發送非同步 `/health` 健康探測，即時回饋「線上就緒」或「連線異常」狀態；在預設 P2P 與自架主機模式下絕不發送非必要背景 HTTP 請求。
4. **客戶端連線模式動態顯示與精簡房內操作**：
   - 於面板右下角動態顯示當前連線模式（`WebRTC P2P` / `官方中繼` / `自架主機`）。
   - 於 P2P 模式說明卡片提供防火牆受阻時改用預設中繼伺服器之清晰指引；房內介面精簡為單一明確之「離開房間」按鈕，移除冗餘技術提示與重複按鈕。
5. **控制面板多語系文字自適應與懸停提示 (UI Text Truncation & Hover Tooltip)**：
   - 針對 380px 面板寬度精簡各語系分頁提示文案，避免固定寬度下字串截斷，並搭配 HTML `title` 懸停提示呈現完整說明。
6. **網站支援燈號狀態指示與商店導流系統 (Site Support Traffic Light & Store Feedback)**：
   - **單一真理來源燈號標記**：全面以 `platforms.ts` 中央註冊表判定支援狀態，當目前分頁為 18 大正式支援平台（或彩蛋解鎖之通用模式平台）之有效播放頁時顯示高亮綠燈與 `[支援]` 徽章；其餘頁面一律顯示紅燈與 `[不支援]` 徽章，杜絕燈號與文案不一致。
   - **官方商店導流**：點擊面板底部引擎支援標籤（`Syncine • YouTube / Netflix / Bilibili 與更多`），導向官方純淨 Chrome 線上應用程式商店頁面（不含任何個人帳號或語系尾綴參數）。
   - **左下角空間極簡化問題回報按鈕**：面板左下角配置低侵入性「`問題回報`」按鈕，一鍵發起 GitHub Issue 並自動整合本機脫敏診斷報告。

7. **bfcache 頁面快取生命週期適配與沙盒 iframe 注入防護 (bfcache & Sandbox iframe Isolation)**：
   - **全域停用 `all_frames` 與 `match_about_blank`（具跨網域播放器單一特例）**：主 Content Script 一律設定 `all_frames: false` 僅注入頂層視窗，避免注入廣告或沙盒 iframe 觸發 `Unsafe attempt to load URL`；僅針對跨網域嵌入式播放器 `https://static.crunchyroll.com/*` 設定顯式特例 `all_frames: true`（由 `isAllowedPlayerFrame()` 嚴格限定來源）。
   - **Page Lifecycle API (bfcache)**：監聽 `pagehide` 與 `pageshow` 事件。在分頁進入快退快進快取（bfcache）時主動中斷長連接 Port，喚醒時自動重連並恢復房間最新狀態。
   - **主動捕捉 `chrome.runtime.lastError`**：於 `port.onDisconnect` 與後端訊息回呼中顯式存取 `lastError`，消除瀏覽器未捕捉異常警示。

---

## 10. 長期主要功能規劃 (Long-Term Roadmap)

以下項目列為系統長期演進之主要功能路線圖：

### 10.1 預授權候選串流平台專屬適配器逐步開放 (Staged Platform Adapters)
* **目標方向**：現行版本已完成前後端共用契約（`shared/`）、宣告式中央平台註冊表及模組化播放器適配器（`VideoPlatformAdapter`）；後續將針對已完成 Manifest 權限預授權之 8 大候選串流平台逐步驗證並啟用對應適配器。
* **技術要點**：針對各平台相異的播放器 DOM 結構、SPA 換集路由機制與自適應串流防禦（防跳幀、防廣告干擾）擴充 `extension/src/content/adapters/` 模組。

### 10.2 本地影片 P2P 串流播放 (Local Video P2P Streaming)
* **需求定位**：允許房主選取本機硬碟中的私有影片檔案（`.mp4`, `.mkv`），免上傳第三方雲端，直接端對端串流給好友同步觀看。
* **技術方案**：利用 WebRTC DataChannel 進行二進位分塊傳輸（File Chunking）或 WebTorrent 技術，結合 MediaSource Extensions (MSE) API 於觀眾端瀏覽器動態解碼組裝播放，落實極致隱私與零伺服器頻寬負載。

### 10.3 多語系介面支援 (Internationalization / i18n - 已實裝)
* **需求定位**：擴展國際化社群，支援多國語言介面與全球影音同映社群。
* **技術方案**：
  * **支援語系**：繁體中文 (`zh-TW`)、English (`en-US`)、日本語 (`ja-JP`)、简体中文 (`zh-CN`) 四國語系。
  * **智慧自動偵測**：透過 `chrome.i18n.getUILanguage()` 與 `navigator.language` 優先判定瀏覽器語系自動載入；支援 `chrome.storage.sync` 跨裝置持久化偏好。
  * **前後端解耦 ReturnCode 機制**：後端、Background Service Worker 與 Offscreen 通道全面以標準化 ReturnCode 溝通，杜絕硬編碼中文回傳字串。全域標準代碼定義如下：
    - 通用狀態：`SUCCESS`、`ERR_UNKNOWN`
    - 房間生命週期：`ERR_ROOM_NOT_FOUND`、`ERR_ROOM_FULL`、`ERR_ROOM_CLOSED`、`ERR_INVALID_CODE`
    - 權限管理：`ERR_PERMISSION_DENIED`、`ERR_HOST_ONLY`、`ERR_AUDIT_REJECTED`
    - 網路與伺服器：`ERR_SERVER_UNREACHABLE`、`ERR_SERVER_TIMEOUT`、`ERR_RATE_LIMITED`、`ERR_CUSTOM_IP_REQUIRED`、`ERR_NETWORK_DISCONNECTED`、`ERR_SEND_MESSAGE_FAILED`
    - WebRTC P2P 連線：`ERR_P2P_SIGNAL_FAILED`、`ERR_P2P_TIMEOUT`、`ERR_P2P_CONNECTION_LOST`
    - 安全防護：`ERR_UNAUTHORIZED_URL`
  * **去硬編碼展示原則**：入房審核申請之預設稱謂由 UI 層函式 `defaultGuestName(id)` 依用戶目前語系動態渲染，通道僅傳遞使用者 ID 或代碼。
  * **Chrome 原生 MV3 本地化**：於 `public/_locales/` 建置各語系 `messages.json`，支援 Chrome 擴充商店與管理清單原生多語系展示。



---

## 11. 伺服器端資安防禦與漏洞緩解規範 (Server Security Hardening)

針對 Node.js 執行環境之底層記憶體缺陷（如 CVE-2026-111497 Brotli 邊界外寫入漏洞）與拒絕服務（DoS）攻擊，Syncine 中繼伺服器實裝以下主動式縱深防禦機制：

### 11.1 外部壓縮酬載嚴格阻斷 (Anti-Decompression Bomb & Out-of-bounds Defense)
* **規範**：Syncine 信令伺服器所有 REST 端點（如 `/health`）僅接收標準純文字 JSON，不支援亦不需要任何外部壓縮編碼。
* **中介軟體攔截**：伺服器入口檢查 `Content-Encoding` 標頭。凡夾帶 `br` (Brotli)、`gzip`、`deflate` 之請求，在進入任何解析器前**立即中斷並回傳 `HTTP 415 Unsupported Media Type`**（錯誤代碼 `ERR_COMPRESSED_PAYLOAD_FORBIDDEN`），從網路層切斷針對 Node.js 底層解碼器的惡意位元組攻擊。
* **記憶體配置上限**：`express.json` 限制最大請求酬載為 `64kb`，防止巨量畸形資料消耗系統記憶體。

### 11.2 WebSocket 壓縮關閉與緩衝區邊界
* **Socket.IO 安全參數**：
  * `httpCompression: false`：停用 HTTP 長輪詢壓縮。
  * `perMessageDeflate: false`：關閉 WebSocket 訊框壓縮協議，避免透過 WebSocket 連線觸發底層 zlib / Brotli 函式庫損壞。
  * `maxHttpBufferSize: 64 * 1024`：嚴格限制單一 WebSocket 封包上限為 64KB。

### 11.3 執行期安全基準稽核 (Runtime Security Auditing)
* **生產容器與套件基準**：`server/package.json` 之 `engines.node` 強制限定 `>=22.23.4 || >=24.22.1 || >=26.12.1`（線上容器為 `node:26-alpine`，預設監聽 `PORT=8080`）。
* **安全基準版本**：
  * Node.js 22.x: `>= 22.23.4`
  * Node.js 24.x: `>= 24.22.1`
  * Node.js 26.x: `>= 26.12.1`
* **主動診斷**：伺服器啟動時自動呼叫 `checkNodeSecurityVersion()` 檢驗目前執行環境。若版本低於安全修復基準，主動輸出高亮資安警告日誌，指引維運人員升級。

---

## 12. Chrome MV3 擴充套件合規與禁止遠端程式碼規範 (No Remotely Hosted Code Policy)

為落實 Google Chrome Web Store Manifest V3 開發者政策與權限申報規範（單一用途原則與隱私權限表），Syncine 擴充套件訂定最高資安合規紅線：

### 12.1 嚴格禁止遠端託管程式碼 (Remotely Hosted Code)
* **禁止動態代碼執行**：全端嚴禁呼叫 `eval()`、`new Function()` 或以字串型式調用 `setTimeout()` / `setInterval()`。
* **禁止外部腳本引用**：擴充套件所有頁面（Popup、Offscreen、Background）嚴禁使用外部 `<script src="https://...">` 標籤，嚴禁向外部 CDN 取得可執行程式碼。
* **禁止動態腳本注入**：嚴禁於 DOM 中動態呼叫 `document.createElement('script')` 載入遠端 URL，亦不使用 `chrome.scripting.executeScript` 執行遠端代碼。
* **100% 本地靜態封裝**：所有前端依賴函式庫（React、Socket.IO Client、PeerJS、Lucide）必須於編譯期靜態打包於本地 `dist/` 與發布套件包中。

### 12.2 自動化合規檢驗阻斷
* 專案內建之 `npm run security:check`（`scan_secrets.js`）已納入遠端代碼模式偵測。任何引進動態代碼或外部腳本之變更將被自動標記為致命阻斷項，嚴格杜絕違規代碼合入主線。
