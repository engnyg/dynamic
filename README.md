# Ripple

一個靈感來自 Apple Dynamic Island 並參考https://github.com/TopMyster/Ripple/tree/main 的桌面小工具，使用 Electron + React 打造，支援 Windows、macOS 和 Linux。

## 功能

- **動態島介面** — 懸浮於桌面最上層，可拖曳定位，支援展開/收合動畫（Framer Motion）
- **AI 聊天** — 整合 Groq API，支援自訂模型，直接在島內對話
- **音樂控制** — 偵測系統正在播放的音樂（Spotify / Apple Music / playerctl），顯示封面、播放/暫停/上下首、音量調整
- **天氣顯示** — 根據設定地點顯示即時天氣與溫度，支援 °F / °C 切換
- **待辦事項** — 輕量級任務清單，資料存於 localStorage
- **工作流程** — 一鍵批次開啟多個應用程式或網址
- **電池 & 藍牙提醒** — 低電量警告、充電狀態、藍牙連線通知
- **高度自訂** — 背景顏色/圖片、文字顏色、12/24 小時制、多螢幕支援、待機模式等
- **系統匣圖示** — 透過 Tray 快速顯示/隱藏或退出

## 技術棧

| 類別 | 技術 |
|------|------|
| 框架 | Electron 31 + React 18 |
| 建置 | Vite 5 |
| 動畫 | Framer Motion |
| AI | Groq SDK |
| 圖示 | Lucide React |
| Markdown | react-markdown |
| 打包 | electron-builder |

## 快速開始

直接下載exe打開即可使用
https://github.com/engnyg/dynamic/releases/tag/dynamic

## 自己編譯

```bash
# 安裝依賴
npm install

# 開發模式（同時啟動 Vite + Electron）
npm run dev

# 打包
npm run build:win    # Windows (NSIS)
npm run build:mac    # macOS (DMG)
npm run build:linux  # Linux (AppImage)
```

## 專案結構

```
src/
├── main.js        # Electron 主程序（視窗、Tray、IPC、媒體偵測）
├── preload.js     # Preload 腳本
├── App.jsx        # React 入口
├── App.css        # 全域樣式
├── Island.jsx     # Dynamic Island 核心元件
├── index.html     # HTML 模板
└── assets/
    ├── fonts/     # OpenRunde 字型
    └── icons/     # 應用程式圖示
```

## 授權

MIT
