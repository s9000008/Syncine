# Syncine (同映) - 跨平台網頁影片同步播放系統

![Syncine Banner](https://img.shields.io/badge/Manifest_V3-Chrome_Extension-3b82f6?style=for-the-badge&logo=googlechrome)
![Socket.IO](https://img.shields.io/badge/Socket.io-4.7-010101?style=for-the-badge&logo=socketdotio)
![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178c6?style=for-the-badge&logo=typescript)
![React](https://img.shields.io/badge/React-18.3-61dafb?style=for-the-badge&logo=react)
![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-3.4-06b6d4?style=for-the-badge&logo=tailwindcss)

> **Syncine (同映)** 是一款專為跨地理位置、跨平台網頁設計的即時低延遲影片同步播放系統（Watch Party）。結合 Chrome Extension Manifest V3 擴充套件、WebRTC P2P 端對端直連與 Node.js + Socket.IO 高效能中繼架構，讓您與好友無論身在何處都能同步觀看 YouTube、Netflix、Bilibili、Disney+、巴哈姆特動畫瘋、Prime Video 等多平台影片。

---

## 🌟 專案特色

* 🎬 **跨平台支援與解耦架構**：現行版本正式支援 **YouTube**、**Bilibili**、**Niconico**、**CATCHPLAY+**、**Netflix**、**Vimeo**、**巴哈姆特動畫瘋**、**Twitch**、**Disney+**、**Prime Video**、**MyVideo**、**LINE TV**、**KKTV**、**Crunchyroll**、**遠傳 friDay 影音**、**Max (HBO Max)**、**愛奇藝 (iQIYI)** 與 **Apple TV+** 等 18 大正版串流影音平台（非官方或高風險站台如 Anime1.me 已移出正式授權，僅置於進階測試彩蛋通用清單）。並實裝「權限預授權與支援名單解耦架構」，透過 `shared/` 單一真理來源控制啟用狀態。
* ⚡ **5 秒時間容差與單程延遲補償**：被動心跳控制在 5 秒差值內不強制跳轉進度（避免抖動卡頓），大於 5 秒強制定位；主動操作 (`PLAY` / `PAUSE` / `SEEK`) 無視容差強制秒級同步。
* 🌐 **三大彈性連線架構**：
  1. **⚡ 純端對端直連 (WebRTC P2P Direct)**：免自架伺服器！採用統一 6 碼邀請碼 (`P2P:XXXXXX`) 搭配 Google / Cloudflare 公共 STUN 穿透 NAT，支援多人申請與房主即時審核清單（一鍵允許/拒絕），透過加密星狀拓撲 `RTCDataChannel` 低延遲直連同步。
  2. **🏢 預設中繼連線 (Official Relay)**：連線至官方雲端中繼伺服器 (`https://syncine.fly.dev`)，穿透嚴格企業防火牆，開箱即用免設定。
  3. **🌐 自行輸入 IP (Self-Hosted IP)**：支援房主自架主機 / NAS / 私有雲，透過複合分享碼 (`IP:RoomID|Base64(URL)`) 實現觀眾無感自動對接。
* 🌍 **全方位多語系支援 (i18n)**：
  * 支援 **繁體中文 (台灣)**、**English (US)**、**日本語**、**简体中文** 四國語言即時切換。
  * **智慧預設**：自動識別瀏覽器語系 (`chrome.i18n.getUILanguage()` / `navigator.language`) 進行預設載入。
  * **前後端解耦轉譯**：核心錯誤與狀態全面標準化為 `ReturnCode`，由前端字典即時轉譯為當地語系。
  * **原生商店與擴充清單整合**：採用 Chrome MV3 `_locales` 機制，擴充套件管理介面與商店依瀏覽器語系自動本地化。
* 🔒 **多重資安防衛**：
  * **網域白名單與嚴格 HTTPS 防禦**：房主進行網頁跳轉或選集連播時，前後端雙重驗證 `https:` 協定與合法平台白名單，自動攔截惡意釣魚連結，並自動剝離個人推薦追蹤參數（如 `tctx`、`utm_*`、`fbclid`）。
  * **雙層權限 Drop 防線**：房主關閉「觀眾操作權限」時，非 Host 發送之同步請求會在後端伺服器與 P2P 房主通道直接丟棄，前端亦自動回滾越權拖曳。
* 🔋 **MV3 保活與 bfcache 生命週期管理**：採用 `chrome.runtime.connect` Port 長連接、`pagehide`/`pageshow` 快取釋放與活躍期間 `0.5` 分鐘（30 秒）`chrome.alarms` 巡檢，兼顧穩定長連線與瀏覽器省電效能。
* 🖥️ **MV3 Offscreen 載體與 Netflix MAIN Bridge**：採用 `chrome.offscreen` 承載 WebRTC 引擎，並透過 MV3 `world: "MAIN"` 安全橋接 Netflix Cadmium 播放器 API。

---

## 📁 專案架構

```text
Syncine/
├── .agents/                        # Antigravity 代理人客製化系統
│   └── skills/                     # 三大 Agent 專屬 Skills (架構、資安、業務) 與自動化掃描腳本
├── AGENTS.md                       # 專案頂層 Multi-Agent 協作指引
├── GEMINI.md                       # 專案核心規範與開發守則
├── PRIVACY_POLICY.md               # Chrome Web Store 雙語隱私權政策
├── Syncine_System_Specification.md # 系統完整開發規格書 (v2.10.0)
├── .env.example                    # 專案環境變數範例檔
├── README.md                       # 專案完整說明文件
│
├── server/                         # WebSocket 後端中繼伺服器 (Node.js + Express + Socket.IO)
│   ├── src/
│   │   ├── index.ts                # 伺服器入口、CORS 校驗、防壓縮攻擊與 Socket 事件路由
│   │   ├── platforms.ts            # 後端中央平台註冊表與嚴格 HTTPS 網域匹配
│   │   ├── rateLimiter.ts          # 滑動視窗頻率限制與防洪斷線保護
│   │   ├── roomManager.ts          # 記憶體房間狀態機、resumeToken 防劫持與寬限期管理
│   │   └── types.ts                # 伺服器通訊協定型別與標準網址清洗函式
│   ├── Dockerfile                  # 生產環境容器建置設定
│   └── package.json
│
└── extension/                      # 前端 Chrome 擴充套件 (React 18 + Vite + Tailwind CSS)
    ├── public/_locales/            # Chrome MV3 四語系商店與擴充清單本地化字典
    ├── src/
    │   ├── background/             # Service Worker (Socket 連線、Offscreen 調度、白名單過濾、保活)
    │   ├── components/             # 共用 UI 元件 (LanguageSelector 多語系切換器)
    │   ├── content/                # Content Script (18 平台播放器適配器、選集連播與 Netflix MAIN Bridge)
    │   ├── locales/                # 四語系前端字典 (zh-TW / en-US / ja-JP / zh-CN) 與 ReturnCode 轉譯器
    │   ├── offscreen/              # Offscreen Document (PeerJS WebRTC 星狀拓撲與審核佇列引擎)
    │   ├── popup/                  # React + Tailwind CSS 房主/觀眾控制面板
    │   ├── types/                  # 前端通訊協定型別與跨平台網址標準化工具
    │   ├── utils/                  # 分享碼解析器、P2P 脫敏診斷日誌與 Log 清毒工具
    │   ├── platforms.ts            # 前端中央平台註冊表與局部開放特性開關
    │   └── manifest.json           # Chrome Extension MV3 權限與注入規則宣告
    ├── build_content.mjs           # Content Script 與 Netflix Bridge 原生 IIFE 封裝腳本
    ├── package.json
    └── vite.config.ts
```

---

## 🤖 專案專屬 AI 代理人體系 (Multi-Agent System)

專案導入 Google Antigravity 協作體系，配置 3 大專責 Agent 協助專案生命週期開發與維護：

| Agent | 角色定位 | 核心職責 | 調用方式 / 工具 |
| :--- | :--- | :--- | :--- |
| 🏗️ **架構 Agent** | `@architecture-agent` | 針對現有架構與未來擴張進行分析評估。評估新串流平台適配器、WebRTC 拓撲極限、Redis 叢集擴展與產出 ADR 架構決策記錄。 | `.agents/skills/architecture-agent/` |
| 🛡️ **資安 Agent** | `@security-agent` | 專門審查代碼安全性，**嚴格杜絕開源專案意外推送隱私資訊、真實測試 IP、金鑰或私鑰**，落實 MV3 最小權限、網域白名單與 Log 清毒。 | `npm run security:check` 或 `.agents/skills/security-agent/` |
| 💼 **業務 Agent** | `@business-agent` | 針對業務邏輯進行系統性處理與回應。主責 5 秒容差與延遲補償同步演算法、房間狀態機、斷線寬限期無感回魂、以及多語系 `ReturnCode` 解耦規範。 | `.agents/skills/business-agent/` |

---

## 🛠️ 安裝與環境變數設定

### 1. 複製環境變數範例

在專案根目錄複製 `.env.example` 為 `.env`：

```bash
cp .env.example .env
```

`.env` 設定說明：

| 環境變數 | 預設值 | 說明 |
| :--- | :--- | :--- |
| `PORT` | `8080` | 後端伺服器通訊埠 (Port，對齊 Fly.io 線上環境) |
| `MAX_ROOMS` | `1000` | 伺服器全域最大併發房間數（防範容器 OOM） |
| `VITE_DEFAULT_SERVER_URL` | `https://syncine.fly.dev` | 前端 Extension 預設連線中繼伺服器位置（本地開發可改設 `http://localhost:8080`） |
| `CORS_ORIGIN` | `*` | 跨域請求 CORS 允許來源（支援逗號分隔多組網域；擴充套件 `chrome-extension://` 自動放行） |
| `LOG_LEVEL` | `info` | 日誌紀錄等級 |

---

## 🚀 本地開發與測試

### 後端伺服器 (Server)

```bash
# 進入伺服器目錄
cd server

# 安裝依賴套件
npm install

# 啟動開發熱重載 (Dev Mode)
npm run dev

# 執行單元、資安 P1 與 CVE 防護自動化測試
npm test

# 執行資安與開源隱私防洩檢測
npm run security:check

# 測試生產環境建置
npm run build
npm start
```

伺服器啟動後可存取 `http://localhost:8080/health` 確認健康狀態。

### 前端擴充套件 (Extension)

```bash
# 進入擴充套件目錄
cd extension

# 安裝依賴套件
npm install

# 啟動 Vite 熱重載開發模式
npm run dev

# 執行多語系與前端規格自動化測試
npm test

# 執行擴充套件資安防洩檢測
npm run security:check

# 打包擴充套件生產環境 bundle
npm run build
```

#### 在 Chrome 瀏覽器載入套件測試：
1. 開啟 Chrome 瀏覽器，進入 `chrome://extensions/`。
2. 開啟右上角 **「開發者模式」 (Developer mode)**。
3. 點擊 **「載入未打包擴充套件」 (Load unpacked)**。
4. 選擇 `extension/dist` 資料夾即可完成載入！

---

## 📦 生產環境部署指南

### 1. 後端伺服器部署 (Docker / Fly.io / Railway / Render)

可使用內附 Node.js 26 安全基準的 `server/Dockerfile` 部署至容器雲平台：

```dockerfile
FROM node:26-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE 8080
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
```

### 2. GitHub Actions 自動化 CI/CD 流程

可在專案中配置自動化建置與測試工作流程：

```yaml
name: Syncine CI/CD Pipeline

on:
  push:
    branches: [ main ]

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Build & Test Server
        run: |
          cd server
          npm ci
          npm test

      - name: Build & Test Extension
        run: |
          cd extension
          npm ci
          npm run build
          npm test
          npm run security:check
```

---

## 🔮 功能里程碑與未來規劃 (Roadmap)

### 已完成里程碑 (Completed Milestones)
* [x] **18 大正版串流平台與選集連播同步**：支援 YouTube、Netflix、Bilibili、Niconico、CATCHPLAY+、Vimeo、巴哈姆特動畫瘋、Twitch、Disney+、Prime Video、MyVideo、LINE TV、KKTV、Crunchyroll、friDay 影音、Max、愛奇藝與 Apple TV+（`Anime1.me` 轉為非正式彩蛋清單隔離）。
* [x] **共用通訊協定與平台適配器模組化 (`shared/` & Adapters)**：前後端共用唯一 `platforms.ts`、`protocol.ts`、`sanitize.ts` 與 `validateSyncData`，Content/Background/Popup 全面拆解為單一職責模組。
* [x] **權限預授權與支援名單解耦架構**：中央平台登錄表控管啟用狀態，候選網域零執行期開銷。
* [x] **突發斷線恢復與防劫持機制**：本機持久化工作階段搭配伺服器 60 秒保留寬限期與 `resumeToken` 密碼學憑證校驗。
* [x] **P2P 脫敏診斷與一鍵問題回報**：自動遮蔽 IP 與識別碼，一鍵生成 GitHub Issue 診斷報告。
* [x] **四國語系介面支援 (i18n)**：控制面板與商店支援繁中、英文、日文、簡中即時切換。

### 長期主要功能 (Long-Term Roadmap)
* [ ] **逐步開放 8 大預授權串流平台專屬適配器**：針對已完成權限預佈署之候選串流平台（LiTV、WeTV 等）逐步實裝客製化播放器適配器。
* [ ] **本地影片檔案 P2P 串流播放**：房主選取本機 `.mp4` 影片，透過 WebRTC DataChannel 分塊傳輸與 MSE 技術點對點同步觀影。
* [ ] **平滑倍速微調追趕與 P2P 自動中繼降級**：1.5s～5s 誤差以倍速平滑對齊，P2P 握手全面失敗時一鍵無縫切換至官方中繼房間。

---

## 📄 授權條款

本專案採用 [MIT License](LICENSE) 釋出。歡迎自由修改與二次開發！
