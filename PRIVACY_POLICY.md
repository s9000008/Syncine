# Syncine (同映) 隱私權政策 (Privacy Policy)

最後更新日期：2026 年 11 月 7 日

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
   僅用於偵測目前使用中的支援影音串流分頁狀態（例如 YouTube、Netflix、Bilibili、Disney+、Prime Video、巴哈姆特動畫瘋、Niconico、Twitch、Anime1.me 等），並在房主發起同房換集或指定網頁同步時，經安全白名單驗證後導向目標影片頁面，絕不讀取與影片同步無關之分頁內容。

3. **鬧鐘排程 (`alarms`)**：
   依據 Chrome Manifest V3 規範，用於在背景 Service Worker 連線期間維持輕量的心跳保活檢查，避免觀影途中同步連線因瀏覽器休眠而中斷。

4. **螢幕外文件 (`offscreen`)**：
   依據 Chrome Manifest V3 規範，用於建立背景隔離之執行環境以承載 WebRTC `RTCPeerConnection` 與 `RTCDataChannel` 點對點連線生命週期。

5. **主機網站存取權限 (`host_permissions`)**：
   存取範圍嚴格限定於：
   - **支援與預授權之合法影音串流平台網域**：僅用於在已啟用支援的影音網站讀取與控制 HTML5 影片播放器之播放狀態（`play`、`pause`、`currentTime`）及選集導航，絕不存取使用者的登入憑證、付款資訊或帳號個資。為避免未來版本逐步開放新串流平台時觸發瀏覽器停用擴充套件警告，部分預授權之候選串流網域預設處於本地靜默停用狀態，未啟用前不會執行任何 DOM 讀取或網路通訊。
   - **官方中繼伺服器（`https://syncine.fly.dev`）或使用者自訂之自架中繼主機**：僅在使用者選擇中繼伺服器模式時，用於房間代碼配對與同步指令轉發。

---

## 3. 同步傳輸機制、第三方信令與影音版權
- **僅傳送控制訊號**：房間內同步傳遞的數據僅包含「播放 (`PLAY`)」、「暫停 (`PAUSE`)」、「影片當前秒數 (`currentTime`)」及經安全清洗後之目標影片標準網址。
- **不涉及影音串流**：本套件絕不重播、轉播、下載或側錄任何視訊與音訊本體。所有影音內容皆直接由各合法串流平台官方伺服器向使用者各自的瀏覽器串流（使用者須具備該平台之合法觀看權限）。
- **WebRTC P2P 直連與信令揭露**：
  - 當使用「WebRTC P2P 直連」模式時，瀏覽器會透過公開信令服務（PeerJS Broker `0.peerjs.com`）交換隨機房間配對信令，並透過公共 STUN 伺服器（Google `stun.l.google.com` 與 Cloudflare `stun.cloudflare.com`）執行標準 NAT 網路穿透握手。
  - 配對完成後，所有播放同步控制信號皆透過加密之 `RTCDataChannel` 於房主與觀眾瀏覽器間點對點直連傳輸，不經過中繼伺服器儲存。
- **問題回報診斷脫敏**：僅在您主動點擊「問題回報」或「複製診斷報告」時，系統才會在本機產生連線診斷摘要，且會自動遮蔽 IP 位址與房間代碼中間字元，由您自行決定是否貼上提交至 GitHub Issues。

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

Last Updated: November 7, 2026

Syncine ("the extension") is committed to protecting your privacy. This Privacy Policy explains our zero-data-collection principles, network architecture, and single-purpose browser permission requirements.

## 1. Zero Personal Data Collection
We strictly respect your privacy:
- We **DO NOT** collect, store, track, or sell any personally identifiable information (such as your name, email address, phone number, or streaming account credentials).
- We **DO NOT** collect browsing history, viewing habits, search queries, or personal communications.

## 2. Permissions Justification (Single Purpose)
All requested permissions are strictly scoped to Syncine's single purpose—real-time web video playback synchronization (Watch Party):
- `storage`: Stores a randomly generated anonymous client ID (`userId`), UI language preferences, connection mode settings, and active room session state locally on your browser for seamless reconnection.
- `tabs` & `activeTab`: Detects video playback tabs on supported streaming platforms (including YouTube, Netflix, Bilibili, Disney+, Prime Video, Bahamut Anime, Niconico, Twitch, Anime1.me, and other supported sites) and navigates room tabs to host-shared video URLs verified against strict domain whitelists. Unrelated tabs are never read.
- `alarms`: Maintains lightweight keep-alive heartbeats for the Manifest V3 background Service Worker during active watch sessions.
- `offscreen`: Hosts an isolated Manifest V3 Offscreen Document required to run WebRTC `RTCPeerConnection` and `RTCDataChannel` connections.
- `host_permissions`: Restricted to:
  1. Supported streaming video platforms and pre-authorized streaming domains (governed by a local Platform Registry so unactivated staged domains remain completely dormant with zero DOM or network activity, preventing disruptive browser disablement warnings during incremental platform rollouts), used solely to synchronize player state (`play`, `pause`, `currentTime`) without accessing user credentials or account data.
  2. The official relay server (`https://syncine.fly.dev`) or a user-specified self-hosted relay server when Relay Mode is selected.

## 3. Synchronization Architecture & WebRTC Disclosure
- **Control Signals Only**: Syncine only transmits playback control events (`PLAY`, `PAUSE`, `SEEK`, `currentTime`) and canonicalized video URLs. No audio or video streams are ever captured, proxied, or re-hosted; media streams directly from each official streaming provider to each viewer's browser.
- **WebRTC P2P Signaling & STUN**: In Direct WebRTC P2P mode, initial room-code discovery uses the public PeerJS signaling broker (`0.peerjs.com`) and NAT traversal uses public STUN servers (Google `stun.l.google.com` and Cloudflare `stun.cloudflare.com`). Once established, playback sync messages travel directly between peers over encrypted WebRTC DataChannels.
- **Redacted Local Diagnostics**: Connection diagnostic reports are generated locally only when you explicitly click "Report to GitHub" or "Copy Report", with IP addresses and room/user identifiers automatically masked.

## 4. Data Sharing & Remote Code Policy
- We never sell, rent, or transfer user data to third parties, advertisers, or data brokers, nor use data for creditworthiness or lending purposes.
- All executable code is bundled statically inside the extension package; no remotely hosted code is ever loaded or executed.

## 5. Contact & Inquiries
For questions or feedback regarding this Privacy Policy, please contact us via our official GitHub repository:
https://github.com/s9000008/Syncine
