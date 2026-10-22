# ==============================================================================
# Syncine Server - Multi-Stage Security-Hardened Dockerfile
# 針對 256MB 記憶體上限優化、非 root 使用者、dumb-init 訊號優雅轉發
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build Phase (包含 TypeScript 編譯環境)
# ------------------------------------------------------------------------------
FROM node:26-alpine AS builder

WORKDIR /app

# 優先複製 package 檔案以最大化利用 Docker BuildKit 快取層
COPY package*.json tsconfig.json ./

# 安裝完整依賴（含 devDependencies 以進行 TypeScript 編譯）
RUN npm ci

# 複製原始碼並執行編譯
COPY src/ ./src/
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 2: Production Runner Phase (最小化安全執行環境)
# ------------------------------------------------------------------------------
FROM node:26-alpine AS runner

# 安裝 dumb-init 作為 PID 1，負責正確轉發 SIGINT/SIGTERM 等 Linux 訊號
RUN apk add --no-cache dumb-init

WORKDIR /app

# 生產環境優化：
# 1. NODE_ENV=production 關閉開發輔助
# 2. --max-old-space-size=192：為 256MB 容器保留 ~64MB 給 OS 與原生程序，杜絕 OOM Killer
ENV NODE_ENV=production \
    PORT=3000 \
    NODE_OPTIONS="--max-old-space-size=192"

# 複製依賴檔案並僅安裝生產所需套件
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# 從編譯階段複製產出的編譯後 JS 檔案
COPY --from=builder /app/dist ./dist

# 切換為 Node 官方無特權使用者 (node:1000)，嚴禁 root 權限執行
USER node

# 宣告服務監聽埠
EXPOSE 3000

# 透過 dumb-init 啟動 node，避免 npm 阻斷 SIGTERM 訊號造成無法優雅關機
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
