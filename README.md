<div align="center">

# 🤖 AI Quota Tracker ── AI 額度追蹤器

**即時監控你所有 AI 訂閱方案的用量與重置倒數**

[![Platform](https://img.shields.io/badge/platform-Windows-0078D6?logo=windows&logoColor=white)](#)
[![Built With](https://img.shields.io/badge/built_with-Electron-47848F?logo=electron&logoColor=white)](#技術棧)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](#授權)
[![Version](https://img.shields.io/badge/version-2.2.1-blue)](#)

<br>

> 一個 Windows 桌面小工具，讓你一眼掌握 ChatGPT、Claude、Gemini、Grok、Copilot 等 AI 服務的訂閱額度，
> 關閉視窗自動縮到系統托盤繼續倒數，不會打擾你的工作流。

<br>

</div>

---

## ✨ 功能亮點

<table>
<tr>
<td width="50%">

### 📊 即時用量儀表板
- 一頁看完所有 AI 服務的**剩餘額度 %** 與**重置倒數**
- 雙色進度條（🟠 已使用 / 🟢 可用），數字一目了然
- 自動定時刷新官方即時數據（間隔可自訂）

</td>
<td width="50%">

### 🔌 多供應商支援
- **ChatGPT** (OpenAI)
- **Claude** (Anthropic)
- **Gemini** (Google)
- **Antigravity** (Google OAuth 登入)
- **Grok** (xAI)
- **GitHub Copilot**
- 同帳號可建立多個連線、自訂命名

</td>
</tr>
<tr>
<td width="50%">

### 🖥️ 迷你懸浮小工具
- 關閉或最小化視窗 → 右下角自動浮現**圓餅圖小工具**
- Always-on-top、半透明背景、可拖曳移動
- 最多同時顯示 **8 個服務**的剩餘 % 圓餅圖
- 雙擊即可還原主視窗

</td>
<td width="50%">

### 🔔 智慧通知
- 額度低於自訂門檻時，自動推送 **Windows 桌面通知**
- 每個週期只通知一次，不會重複打擾
- 系統托盤圖示右鍵選單顯示最吃緊服務的下次重置時間

</td>
</tr>
<tr>
<td width="50%">

### 🔒 隱私優先
- Cookie / 登入資訊**只存在本機** (`%APPDATA%`)
- 請求**只送往各服務的官方伺服器**，不經任何第三方
- 不需要額外註冊帳號

</td>
<td width="50%">

### 📦 匯入 / 匯出
- 連線設定可匯出為 JSON 檔
- 一鍵匯入，換電腦不用重新設定
- 卡片支援**拖曳排序**，自訂你的儀表板版面

</td>
</tr>
</table>

---

## 🚀 快速開始

### 方式一：下載安裝檔（推薦）

> 前往 [**Releases**](../../releases) 頁面下載最新版 `.exe` 安裝檔，安裝即可使用。

### 方式二：從原始碼編譯

```bash
# 1. 安裝相依套件
npm install

# 2. 開發模式（含熱重載）
npm run dev

# 3. 產生 Windows 安裝檔
npm run dist
# → 安裝檔輸出在 dist/ 資料夾
```

---

## 📖 使用方式

### Step 1 — 新增供應商

點擊主畫面的「**＋ 新增供應商**」，選擇你要追蹤的 AI 服務。

### Step 2 — 連接帳號

根據不同服務，連接方式略有不同：

| 服務 | 連接方式 |
|------|---------|
| ChatGPT | 貼上瀏覽器 Cookie |
| Claude | 貼上瀏覽器 Cookie（自動探測組織 ID） |
| Gemini | 貼上瀏覽器 Cookie |
| Antigravity | **Google OAuth 登入**（正規授權流程） |
| Grok | 貼上瀏覽器 Cookie |
| Copilot | 貼上瀏覽器 Cookie |

> 💡 應用程式內建每個服務的**逐步圖文教學**，點擊「使用說明」即可查看。

### Step 3 — 自動追蹤

連接後，用量數據會每 **5 分鐘**自動更新（可在設定中調整 1–120 分鐘）。
關閉視窗後會自動縮到**右下角系統托盤** + 顯示**迷你圓餅圖小工具**繼續監控。

---

## ⚙️ 設定選項

| 選項 | 說明 | 預設值 |
|------|------|--------|
| 🚀 開機自動啟動 | Windows 登入後自動開啟 | 關閉 |
| 🔔 用量過低通知 | 剩餘額度低於門檻時推送通知 | 開啟（15%） |
| ⏱️ 自動刷新間隔 | 多久向官方重新抓取一次數據 | 5 分鐘 |

---

## 🛠️ 技術棧

| 技術 | 用途 |
|------|------|
| [Electron](https://www.electronjs.org/) | 桌面應用框架 |
| [React](https://react.dev/) | UI 渲染 |
| [TypeScript](https://www.typescriptlang.org/) | 型別安全 |
| [Vite](https://vitejs.dev/) + [electron-vite](https://electron-vite.org/) | 建構工具 + 熱重載 |
| [electron-builder](https://www.electron.build/) | Windows 安裝檔打包 |

---

## 📂 專案結構

```
ai-quota-tracker/
├── src/
│   ├── main/                  # Electron 主行程
│   │   ├── index.ts           # 視窗管理、托盤、IPC 通道
│   │   ├── googleOAuth.ts     # Google OAuth 登入流程
│   │   ├── hiddenBrowser.ts   # 隱藏瀏覽器視窗
│   │   └── providers/         # 各 AI 服務的 API 抓取邏輯
│   │       ├── chatgpt.ts
│   │       ├── claude.ts
│   │       ├── gemini.ts
│   │       ├── antigravity.ts
│   │       ├── grok.ts
│   │       ├── copilot.ts
│   │       ├── registry.ts    # 供應商註冊中心
│   │       └── types.ts       # 共用型別
│   ├── preload/               # Electron preload 安全橋接
│   └── renderer/              # React 前端
│       └── src/
│           ├── App.tsx         # 主應用程式
│           ├── MiniWidget.tsx  # 迷你懸浮圓餅圖小工具
│           ├── styles.css      # 深色主題樣式
│           └── components/     # UI 元件
├── assets/                    # 托盤圖示等靜態資源
├── tools/                     # 開發輔助工具
├── electron-builder.yml       # 打包設定
└── package.json
```

---

## 🤝 貢獻

歡迎提交 Issue 和 Pull Request！如果你想新增一個 AI 供應商的支援：

1. 在 `src/main/providers/` 新增一個 provider 檔案
2. 在 `registry.ts` 中註冊
3. 在 `providerGuides.ts` 中加入使用說明
4. 提交 PR 🎉

---

## 📄 授權

本專案採用 [MIT License](LICENSE) 授權。

---

<div align="center">

**如果這個工具對你有幫助，歡迎給一顆 ⭐ Star！**

Made with ❤️ for AI power users

</div>
