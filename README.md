# Syncine (同映) - 跨平台網頁影片同步播放系統

![Syncine Banner](https://img.shields.io/badge/Manifest_V3-Chrome_Extension-3b82f6?style=for-the-badge&logo=googlechrome)
![Socket.IO](https://img.shields.io/badge/Socket.io-4.7-010101?style=for-the-badge&logo=socketdotio)
![TypeScript](https://img.shields.io/badge/TypeScript-5.4-3178c6?style=for-the-badge&logo=typescript)
![React](https://img.shields.io/badge/React-18.3-61dafb?style=for-the-badge&logo=react)
![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-3.4-06b6d4?style=for-the-badge&logo=tailwindcss)

> **Syncine (同映)** 是一款專為跨地理位置、跨平台網頁設計的即時低延遲影片同步播放系統。結合 Chrome Extension Manifest V3 擴充套件與 Node.js + Socket.IO 高效能架構，讓您與好友無論身在何處都能同步觀看 YouTube 與 Bilibili 影片。

---

## 🌟 專案特色

* 🎬 **跨平台支援**：現行版本支援 **YouTube** (含 SPA 頁面動態導航與廣告過濾) 與 **Bilibili** (動態 DOM 偵測)；後續規劃支援 Vimeo、Netflix、本地影片 P2P 串流與多語系。
* ⚡ **5 秒時間容差與單程延遲補償**：被動心跳控制在 5 秒差值內不強制跳轉進度（避免抖動卡頓），大於 5 秒強制定位；主動操作 (Play/Pause/Seek) 無視容差強制秒級同步。
* 🌐 **三大彈性連線架構**：
  1. **預設中繼連線 (Default Relay)**：連線至預設中繼伺服器，開箱即用免設定。
  2. **自行輸入 IP (Self-Hosted IP)**：支援房主自架主機/NAS/私有雲，透過複合分享碼 (`IP:RoomID|Base64(URL)`) 實現觀眾無感對接。
  3. **⚡ 純端對端直連 (WebRTC P2P Direct)**：完全不依賴任何本機或自架伺服器！直接利用 Google 公共 STUN 穿透 NAT，採用統一 6 碼邀請碼支援多人（不設人數上限）群體申請，房主控制面板即時彈出審核清單（支援一鍵允許/拒絕），並具備全模式 30 秒動態在線人數校準與離房原生播放器自動解鎖防護。
* 🔒 **多重資安防衛**：
  * **網域白名單防禦**：房主進行網頁跳轉時，觀眾端自動比對 URL 正則白名單，自動攔截惡意釣魚連結。
  * **雙層權限 Drop 防線**：房主關閉「觀眾操作權限」時，非 Host 發送之同步請求會在後端伺服器端直接丟棄。
* 🔋 **MV3 永不斷線保活機制**：採用 `chrome.runtime.connect` Port 長連接與 20 秒 `chrome.alarms` 心跳雙保險，克服 Chrome Service Worker 30 秒休眠限制。
* 🖥️ **MV3 Offscreen 載體架構**：採用 Chrome 官方推薦之 `chrome.offscreen` Document 承載 WebRTC，解決 MV3 Service Worker 無法運行 `RTCPeerConnection` 之原生限制。

---

## 📁 專案架構

```text
Syncine/
├── .env.example             # 專案環境變數範例檔
├── .gitignore                # 版控排除清單
├── README.md                 # 專案完整說明文件
├── Syncine_System_Specification.md # 系統規格書 (v2.3)
│
├── server/                   # WebSocket 後端伺服器 (Node.js + Express + Socket.IO)
│   ├── src/
│   │   ├── index.ts          # 伺服器入口與 Socket 事件監聽
│   │   ├── roomManager.ts    # 記憶體房間狀態管理與權限校驗
│   │   └── types.ts          # 伺服器通訊協定型別定義
│   └── package.json
│
├── extension/                # 前端 Chrome 擴充套件 (React 18 + Vite + Tailwind CSS)
│   ├── src/
│   │   ├── background/       # Service Worker (Socket 連線、信令中繼、白名單過濾、保活)
│   │   ├── offscreen/        # Offscreen Document (WebRTC RTCPeerConnection & DataChannel 引擎)
│   │   ├── content/          # Content Script (YouTube/Bilibili Video DOM 綁定與補償演算法)
│   │   ├── popup/            # React + Tailwind CSS 房主/觀眾控制面板
│   │   ├── types/            # 前端通訊協定型別
│   │   ├── index.css         # Tailwind 全域樣式
│   │   └── manifest.json     # Chrome Extension MV3 規格說明
│   ├── package.json
    ├── tailwind.config.js
    └── vite.config.ts
```

---

## 🛠️ 安裝與環境變數設定

### 1. 複製環境變數範例

在專案根目錄主動複製 `.env.example` 為 `.env`：

```bash
cp .env.example .env
```

`.env` 設定說明：

| 環境變數 | 預設值 | 說明 |
| :--- | :--- | :--- |
| `PORT` | `3000` | 後端伺服器通訊埠 (Port) |
| `VITE_DEFAULT_SERVER_URL` | `http://localhost:3000` | 前端 Extension 預設連線伺服器位置 |
| `CORS_ORIGIN` | `*` | 跨域請求 CORS 允許來源 |
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

# 測試生產環境建置
npm run build
npm start
```

伺服器啟動後可存取 `http://localhost:3000/health` 確認健康狀態。

### 前端擴充套件 (Extension)

```bash
# 進入擴充套件目錄
cd extension

# 安裝依賴套件
npm install

# 啟動 Vite 熱重載開發模式
npm run dev

# 打包擴充套件 bundle
npm run build
```

#### 在 Chrome 瀏覽器載入套件測試：
1. 開啟 Chrome 瀏覽器，進入 `chrome://extensions/`。
2. 開啟右上角 **「開發者模式」 (Developer mode)**。
3. 點擊 **「載入未打包擴充套件」 (Load unpacked)**。
4. 選擇 `extension/dist` (或 `Syncine/extension/dist`) 資料夾即可完成載入！

---

## 📦 生產環境部署指南

### 1. 後端伺服器部署 (Docker / Railway / Render)

可使用包含 Node.js 20 的 Dockerfile 部署至 Railway、Render 或 GCP / AWS 伺服器：

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY server/package*.json ./
RUN npm ci --only=production
COPY server/dist ./dist
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### 2. GitHub Actions 自動化 CI/CD 流程 (.github/workflows/deploy.yml)

您可以在專案中建立 `.github/workflows/deploy.yml` 實現自動化測試與 GitHub Pages / Releases 發布：

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
          node-version: 20

      - name: Build Server
        run: |
          cd server
          npm ci
          npm run build

      - name: Build Extension
        run: |
          cd extension
          npm ci
          npm run build

      - name: Archive Extension Build Artifact
        uses: actions/upload-artifact@v4
        with:
          name: syncine-extension-build
          path: extension/dist/
```

---

## 🔮 未來主要功能規劃 (Roadmap) 與短中期優化

### 短中期優化項目 (Short-to-Medium Term)
* [x] **突發斷線恢復機制**：透過 `chrome.storage.local` 本機持久化房間工作階段，支援斷線自動回魂與伺服器端 60 秒保留寬限期 (Grace Period)。
* [x] **Log 資訊注入攻擊防護**：全端配備 `sanitizeLog` 函式，防止 CRLF 換行偽造與不可見字元注入日誌。
* [x] **官方伺服器與 P2P 連線健康探測**：控制面板實裝真實連線健康檢查 (`/health` 端點探測)。
* [x] **控制面板 UI 優化**：動態連線模式狀態顯示、移除推薦 P2P 標籤，並提示 P2P 異常時切換中繼伺服器指引。
* [x] **單分頁防護提示**：主動提示使用者瀏覽器建議僅保留單一影片分頁，避免同步衝突。

### 長期主要功能 (Long-Term Roadmap)
* [ ] **更多主流影音網站支援**：拓展支援 Vimeo、Netflix、巴哈姆特動畫瘋等平台。
* [ ] **本地影片檔案 P2P 串流播放**：房主選取本機 `.mp4` 影片，透過 WebRTC DataChannel 分塊傳輸技術點對點串流播放。
* [ ] **多語系介面支援 (i18n)**：控制面板支援繁中、簡中、英文等多國語言即時切換。

---

## 📄 授權條款

本專案採用 [MIT License](LICENSE) 釋出。歡迎自由修改與二次開發！
