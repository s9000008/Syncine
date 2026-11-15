# Syncine (同映) 隱私權政策 (Privacy Policy)

最後更新日期：2026 年 11 月 13 日

Syncine（以下簡稱「本擴充套件」）致力於保障每位使用者的個人隱私。本隱私權政策旨在清楚說明本套件對使用者資料的處理原則、連線架構及各項瀏覽器權限的使用目的。

---

## 1. 零個資收集原則 (Zero Personal Data Collection)
本擴充套件秉持「最小權限」與「保護使用者個資」原則：
- 我們**不會收集、記錄、儲存、追蹤或出售**任何個人識別資訊（包含您的姓名、電子郵件、電話、身分資訊或平台帳號密碼）。
- 我們**不會收集**您的日常網頁瀏覽歷史、影片觀看偏好、搜尋記錄或任何私人通訊內容。

---

## 2. 權限需求與單一用途說明
本擴充套件向瀏覽器申請的所有權限，均嚴格受限於實現「跨平台網頁影片同步播放 (Watch Party)」之單一核心功能：

1. **儲存空間 (`storage`)**：
   僅用於在您的瀏覽器本機端儲存隨機生成的匿名客戶端識別碼（`userId`）、介面語系偏好、連線模式設定及當前房間連線暫存狀態（供網路瞬斷自動重連使用）。相關資料保存在本機或瀏覽器同步儲存區，絕不作追蹤用途。

2. **分頁資訊 (`tabs` & `activeTab`)**：
   僅用於偵測目前使用中的支援影音串流分頁狀態（例如 YouTube、Netflix、Bilibili、Niconico、CATCHPLAY+、Disney+、Prime Video、巴哈姆特動畫瘋、Twitch、Crunchyroll 等 18 大正式支援平台），並在房主發起同房換集或指定網頁同步時，經安全白名單驗證後導向目標影片頁面，絕不讀取與影片同步無關之分頁內容。

3. **動態腳本注入 (`scripting`)**：
   僅在您主動開啟進階通用／預授權測試模式並點擊擴充套件圖示授予當前分頁 `activeTab` 權限時，於該授權分頁注入本地靜態打包之同步控制腳本。所有腳本皆 100% 封裝於本機擴充套件內部，絕不載入或執行遠端程式碼。

4. **鬧鐘排程 (`alarms`)**：
   依據 Chrome Manifest V3 規範，僅於活躍房間連線期間維持輕量的週期性心跳保活檢查（最小間隔 0.5 分鐘），避免觀影途中同步連線因瀏覽器休眠而中斷；退房後即行清除。

5. **螢幕外文件 (`offscreen`)**：
   依據 Chrome Manifest V3 規範，用於建立背景隔離之執行環境以承載 WebRTC `RTCPeerConnection` 與 `RTCDataChannel` 點對點連線生命週期。

6. **主機網站存取權限 (`host_permissions`)**：
   存取範圍嚴格限定於：
   - **支援與預授權之合法影音串流平台網域**：僅用於在已啟用支援的合法影音網站（包含嵌入式播放器來源如 `static.crunchyroll.com` 及 Prime Video 地區站點如 `amazon.com`）讀取與控制 HTML5 影片播放器之播放狀態（`play`、`pause`、`currentTime`、`playbackRate`）及選集導航，絕不存取使用者的登入憑證、付款資訊或帳號個資。非官方或高風險第三方網站完全不包含於靜態 `host_permissions` 中；部分預授權之合法候選串流網域預設處於本地靜默停用狀態，未啟用前不會執行任何 DOM 讀取或網路通訊。
   - **官方中繼伺服器（`https://syncine.fly.dev`）或使用者自訂之自架中繼主機**：僅在使用者選擇中繼伺服器模式時，用於房間代碼配對與同步指令轉發。

---

## 3. 同步傳輸機制、第三方信令與資料暫存聲明
- **僅傳送控制訊號與最小化識別欄位**：房間內同步傳遞的數據僅包含播放動作（`PLAY` / `PAUSE` / `SEEK` / `HEARTBEAT`）、影片當前秒數 (`currentTime`)、播放倍速 (`playbackRate`)、操作時間戳 (`timestamp`) 及經安全清洗後之目標影片標準網址；中繼伺服器模式下建房與加房會傳送瀏覽器本機隨機生成之匿名識別碼 (`userId`) 與選填之介面語系代碼 (`language`，僅供伺服器端運行日誌觀測，絕不廣播給房間內其他成員)。
- **揮發性記憶體與伺服器運行日誌**：官方中繼伺服器僅於揮發性記憶體維持房間狀態（房主主動退房時立即清除，全員意外斷線超過 60 秒自動銷毀）。為維持服務可用性與資安防禦（例如 HTTP 415 異常壓縮酬載阻斷與 DoS 限流），伺服器標準輸出運行日誌會暫時記錄匿名化事件、安全警告及觸發異常安全防線請求之來源 IP，不會建立長期追蹤檔案庫。
- **不涉及影音串流**：本套件絕不重播、轉播、下載或側錄任何視訊與音訊本體。所有影音內容皆直接由各合法串流平台官方伺服器向使用者各自的瀏覽器串流（使用者須具備該平台之合法觀看權限）。
- **WebRTC P2P 直連與 STUN IP 交換揭露**：
  - 當使用「WebRTC P2P 直連」模式時，瀏覽器會透過公開信令服務（PeerJS Broker `0.peerjs.com`）交換隨機房間配對信令，並透過公共 STUN 伺服器（Google `stun.l.google.com` 與 Cloudflare `stun.cloudflare.com`）執行標準 NAT 網路穿透握手；依 WebRTC 協定特性，雙方端點之網路位址（ICE Candidate）會於建立直連過程中進行技術性交換。
  - 配對完成後，所有播放同步控制信號皆透過加密之 `RTCDataChannel` 於房主與觀眾瀏覽器間點對點直連傳輸，不經過中繼伺服器儲存。
- **問題回報診斷脫敏**：僅在您主動點擊「問題回報」或「複製診斷報告」時，系統才會在本機產生連線診斷摘要（包含套件版本、作業系統與瀏覽器類型概要，並自動遮蔽 IP 位址與房間／使用者識別碼中間字元），由您自行決定是否貼上提交至 GitHub Issues。

---

## 4. 資料分享與第三方服務聲明
- 我們絕不會將使用者資料出售、出租或移轉給任何第三方機構或資料仲介商。
- 我們不會將任何使用者資料用於廣告投放、個人化分析、信用評等或貸款用途。
- 本擴充套件完全封裝本地靜態程式碼，絕不載入或執行任何遠端託管程式碼（No Remotely Hosted Code）。

---

## 5. 政策更新與問題聯繫
若本隱私權政策有任何修改，我們將直接更新於本文件與專案主頁。如果您對本政策有任何疑問，歡迎透過我們的開源專案儲存庫提出：
專案原始碼與問題回報：https://github.com/s9000008/Syncine

---

# Privacy Policy for Syncine (English Version)

Last Updated: November 13, 2026

Syncine ("the extension") is committed to protecting your privacy. This Privacy Policy explains our zero-data-collection principles, network architecture, and single-purpose browser permission requirements.

## 1. Zero Personal Data Collection
We strictly respect your privacy:
- We **DO NOT** collect, store, track, or sell any personally identifiable information (such as your name, email address, phone number, or streaming account credentials).
- We **DO NOT** collect browsing history, viewing habits, search queries, or personal communications.

## 2. Permissions Justification (Single Purpose)
All requested permissions are strictly scoped to Syncine's single purpose—real-time web video playback synchronization (Watch Party):
- `storage`: Stores a randomly generated anonymous client ID (`userId`), UI language preferences, connection mode settings, and active room session state locally on your browser for seamless reconnection.
- `tabs` & `activeTab`: Detects video playback tabs on officially supported streaming platforms (including YouTube, Netflix, Bilibili, Niconico, CATCHPLAY+, Disney+, Prime Video, Bahamut Anime, Twitch, Crunchyroll, and other supported sites) and navigates room tabs to host-shared video URLs verified against strict domain whitelists. Unrelated tabs are never read.
- `scripting`: Injects locally bundled synchronization scripts only into the active tab when the user explicitly unlocks universal/candidate testing mode and activates the extension on that tab (`activeTab`). All injected scripts are 100% statically packaged within the extension; no remote code is ever executed.
- `alarms`: Maintains lightweight keep-alive checks (minimum 0.5-minute MV3 interval) for the Manifest V3 background Service Worker strictly while an active watch room session is running, and clears them upon leaving.
- `offscreen`: Hosts an isolated Manifest V3 Offscreen Document required to run WebRTC `RTCPeerConnection` and `RTCDataChannel` connections.
- `host_permissions`: Restricted to:
  1. Officially supported and pre-authorized legitimate streaming video platforms (including embedded player frames such as `static.crunchyroll.com` and regional Prime Video domains like `amazon.com`), governed by a local Platform Registry so staged candidate domains remain completely dormant with zero DOM or network activity. Unofficial third-party sites are excluded from static `host_permissions`. Only player state (`play`, `pause`, `currentTime`, `playbackRate`) and episode navigation are synchronized—credentials and account data are never accessed.
  2. The official relay server (`https://syncine.fly.dev`) or a user-specified self-hosted relay server when Relay Mode is selected.

## 3. Synchronization Architecture, Retention & WebRTC Disclosure
- **Minimal Control Signals Only**: Syncine only transmits playback actions (`PLAY`, `PAUSE`, `SEEK`, `HEARTBEAT`), `currentTime`, `playbackRate`, operation `timestamp`, and canonicalized video URLs. In Relay mode, a randomly generated anonymous `userId` and optional UI `language` code (logged only on the server for diagnostics and never broadcast to other room members) are included during room creation/joining.
- **Ephemeral Server State & Security Logs**: The official relay server holds room state strictly in volatile memory (deleted immediately on explicit host leave, or after a 60-second empty-room grace period). Transient stdout operational/security logs may temporarily record anonymized events, rate-limit alerts, or source IP addresses on blocked anomalous requests (e.g., HTTP 415 compressed-payload defense) without building persistent tracking profiles.
- **WebRTC P2P Signaling & STUN**: In Direct WebRTC P2P mode, initial room-code discovery uses the public PeerJS signaling broker (`0.peerjs.com`) and NAT traversal uses public STUN servers (Google `stun.l.google.com` and Cloudflare `stun.cloudflare.com`), which inherently exchanges ICE network endpoint IP candidates per standard WebRTC negotiation. Once established, playback sync messages travel directly between peers over encrypted WebRTC DataChannels.
- **Redacted Local Diagnostics**: Connection diagnostic reports are generated locally only when you explicitly click "Report to GitHub" or "Copy Report", summarizing extension version and basic OS/browser family while automatically masking IP addresses and room/user identifiers.

## 4. Data Sharing & Remote Code Policy
- We never sell, rent, or transfer user data to third parties, advertisers, or data brokers, nor use data for creditworthiness or lending purposes.
- All executable code is bundled statically inside the extension package; no remotely hosted code is ever loaded or executed.

## 5. Contact & Inquiries
For questions or feedback regarding this Privacy Policy, please contact us via our official GitHub repository:
https://github.com/s9000008/Syncine
