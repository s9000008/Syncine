---
name: architecture-agent
description: >-
  針對 Syncine 專案進行系統架構分析、長遠擴張性評估、技術選型檢視、模組解耦設計與架構決策紀錄 (ADR)。
  當使用者需要擴展新串流平台（如 Netflix、Vimeo、巴哈姆特）、調整連線拓撲（Relay/P2P/分散式叢集）、
  重構通訊協定或評估新技術架構對現有系統的衝擊時，調用此 Skill。
---

# 架構 Agent (Architecture Agent) - 分析與擴張評估工作手冊

本 Skill 專門提供 Syncine 系統架構評估、平台擴展設計與技術決策支援。

## 🎯 核心執行步驟

### 步驟 1：檢視現有架構邊界與相容性
- 核對變更涉及的層級：
  1. **前端 MV3 擴充套件**：Service Worker 生命週期、`chrome.offscreen` 載體、Content Script DOM 隔離。
  2. **後端中繼伺服器**：Node.js + Socket.IO 房間拓撲、記憶體佔用與叢集化潛力。
  3. **P2P 端對端通道**：Google STUN NAT 穿透、兩階段剪貼簿或 DataChannel 流量背壓。
- 確認是否打破現有通訊協議型別（參考 [Syncine_System_Specification.md](../../../Syncine_System_Specification.md) 第 8 章）。

### 步驟 2：執行平台擴充適配器評估 (Platform Expansion)
若任務目標為擴展新影音平台（如 Netflix / Vimeo / 巴哈姆特動畫瘋）：
1. 檢視目標網站是否為 SPA 架構、是否有特有換片路由事件。
2. 評估 `<video>` 標籤載入生命週期（靜態 DOM 或非同步動態載入）。
3. 評估廣告機制與自適應流防禦（防跳幀、防廣告時長混淆）。
4. 撰寫符合 `VideoPlatformAdapter` 介面的適配方案。

### 步驟 3：評估長遠擴展維度 (Scalability Evaluation)
1. **房間人數與流量評估**：
   - Relay 模式：評估頻寬開銷（$O(N)$ 伺服器廣播負載）。
   - P2P 模式：評估全網狀 Mesh ($O(N^2)$) vs 星狀 Star ($O(N)$ Host 轉發) 的瓶頸上限。
2. **記憶體向 Redis 叢集擴展之相容性**：
   - 確保 RoomManager 中的房間狀態可被序列化（JSON/Redis Hash），無本機閉包引用。

### 步驟 4：產出架構決策記錄 (ADR)
若牽涉架構重大改動，依據範本產出 ADR 文件：
- 參考範本：[ADR 範本](./references/adr_template.md)
