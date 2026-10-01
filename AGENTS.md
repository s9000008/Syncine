# Syncine 多代理人協作體系 (Multi-Agent System)

本專案遵循 Google Antigravity 代理人協同規範。針對 Syncine 跨平台網頁影片同步播放系統之特殊架構（Chrome MV3 擴充套件 + Node.js/Socket.IO 中繼 + WebRTC P2P 直連），配置三大專責 Agent：

---

## 🤖 專案三大核心 Agent 一覽

| Agent 代號 | 名稱 | 主要職責 | 觸發時機 | 對應 Skill / 規格 |
| :--- | :--- | :--- | :--- | :--- |
| **`@architecture-agent`** | **架構 Agent** | 評估系統擴展性、跨平台適配器架構、連線拓撲演進、技術債控管與 ADR 決策 | 規劃新功能、擴充新串流平台、重構前後端通道或評估分散式/P2P 擴張時 | [.agents/skills/architecture-agent/SKILL.md](./.agents/skills/architecture-agent/SKILL.md) |
| **`@security-agent`** | **資安 Agent** | 審查新代碼安全性、防止開源洩漏隱私與敏感資訊（金鑰/IP/憑證）、MV3 權限最小化、網域白名單與日誌清毒 | 提交 Commit/PR 前、引入外部套件、新增通訊協定、處理環境變數或連線端點時 | [.agents/skills/security-agent/SKILL.md](./.agents/skills/security-agent/SKILL.md) |
| **`@business-agent`** | **業務 Agent** | 負責影音同步演算法（5秒容差/延遲補償）、房間生命週期狀態機、多語系 ReturnCode 解耦與邊界行為處理 | 實作或調整播放控制、房間操作、i18n 語系、斷線寬限回魂或平台播放器事件時 | [.agents/skills/business-agent/SKILL.md](./.agents/skills/business-agent/SKILL.md) |

---

## 📐 規格驅動開發協同工作流 (Specification-Driven Development, SDD)

專案未來所有新功能擴展、平台支援（如 Netflix/Vimeo/巴哈姆特）、通訊重構或業務優化，**必須嚴格遵循「規格驅動開發 (SDD)」準則**。規格書 [Syncine_System_Specification.md](./Syncine_System_Specification.md) 為全系統唯一真理來源 (Single Source of Truth)。

```mermaid
graph TD
    User([1. 使用者需求提出]) --> SDD_Spec[2. 規格先行階段: 撰寫/增修規格書]
    subgraph SDD [📐 規格驅動設計階段 (Spec-First)]
        SDD_Spec --> SpecBiz[業務 Agent: 領域事件/狀態機/ReturnCode 規格化]
        SDD_Spec --> SpecArch[架構 Agent: 協定型別/平台適配/ADR 規格化]
        SpecBiz & SpecArch --> SyncSpec[更新/審核 Syncine_System_Specification.md]
    end
    SyncSpec --> SDD_Test[3. 測試規格化: 依據規格產出測試矩陣與驗收標準]
    SDD_Test --> Dev[4. 核心工程開發: 嚴格依照規格型別實作]
    Dev --> SpecDriftCheck{規格漂移檢查}
    SpecDriftCheck -- 發現未考慮細節 --> SyncSpec
    SpecDriftCheck -- 100% 符合規格 --> SDD_Audit[5. 資安與規格稽核: 資安 Agent 審核開源防洩與防線]
    SDD_Audit --> Verified{驗收是否通過}
    Verified -- 通過 --> Release([6. 安全交付 / Commit / PR])
    Verified -- 未通過 --> Dev
```

### 🎯 SDD 四大核心實踐準則
1. **規格先行 (Spec-First)**：
   - 任何新功能開發前，**禁止直接撰寫業務代碼**。
   - 必須由業務 Agent 與架構 Agent 先行在 [Syncine_System_Specification.md](./Syncine_System_Specification.md) 中更新通訊協定型別 (TypeScript Protocol Schema)、容差演算法、失敗降級路徑與 ReturnCode 定義。
2. **契約即約束 (Contract as Constraint)**：
   - 前後端與 P2P 通道通訊以規格書所定義之 Protocol Schema 為唯一合法契約，型別名稱、欄位型態必須嚴密對齊。
3. **零規格漂移 (Zero Spec Drift)**：
   - 開發過程中若發現技術限制或新邊界需調整實作，**必須先修改規格書，再行調整代碼**，嚴禁「代碼跑在規格前面」。
4. **規格導向驗收 (Spec-Guided Verification)**：
   - 每個新增規格皆須具備可對應之自動化測試案例或明確驗證步驟，驗收時對照規格條款逐一比對核銷。

---

> [!NOTE]
> 通用工程開發規範（含全端工程師角色、開源安全防洩、UI/UX 規範、測試說明與 `[AI Coding]` Commit 格式）統一收斂並維護於 [GEMINI.md](./GEMINI.md)。

