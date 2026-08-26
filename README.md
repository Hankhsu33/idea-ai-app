# BGone AI

> WEEK 3+4 — 使用 Expo 與 React Native 製作的手機 AI 去背 App。

BGone AI 讓使用者從手機相簿選擇照片，在裝置上移除背景，並透過 CLIP 圖片辨識產生標籤與簡短描述。處理完成的圖片會暫時加入 Gallery，方便查看放大結果與辨識資訊。

## 專案功能

- 從手機相簿選擇照片，並處理相簿權限被拒絕的情況。
- 使用 RMBG-1.4 AI 模型移除照片背景。
- 以棋盤格顯示透明背景，方便確認去背結果。
- 使用 MobileCLIP 分析圖片並產生標籤與描述。
- 在 Gallery 以三欄方格排列照片，點選後可開啟放大頁面。
- 在 Settings 下載 AI 模型，顯示真實下載容量與百分比。
- 提供 CLIP 圖片辨識測試與前五名辨識結果。
- AI 尚未準備完成時顯示清楚狀態，不會讓按鈕無聲失效。

## 三個主要頁面

### Create

選擇照片、預覽原圖、執行 AI 去背，並查看透明背景結果、推論時間、圖片標籤與描述。

### Gallery

以三欄網格顯示本次使用期間加入的照片；點選照片可以放大查看、閱讀標籤，或重新執行圖片描述。

### Settings

查看及下載去背模型、追蹤下載進度，並使用 CLIP 測試工具檢查圖片辨識結果。

## WEEK 3+4 完成內容

在上一個版本只有基本畫面與去背流程的基礎上，本次新增：

- 更新 BGone AI 引擎與 WebView 推論頁面。
- 加入 CLIP 圖片與文字向量辨識。
- 加入 256 px 的辨識圖片預處理流程。
- 去背後自動產生圖片標籤與描述。
- 新增 `TagChips` 標籤介面與 `ClipProbe` 測試元件。
- Gallery 詳細頁新增透明背景預覽、標籤、描述及重新辨識功能。
- 新增圖片相似度與標籤處理程式。
- 新增引擎 HTML 語法檢查工具與課程文件。

## 使用技術

- Expo SDK 54
- React Native 0.81
- React 19
- TypeScript
- Expo Router
- Expo Image Picker
- Expo Image Manipulator
- React Native WebView
- AsyncStorage
- Transformers.js、ONNX Runtime Web
- RMBG-1.4、MobileCLIP-S0

## 開始使用

### 1. 安裝套件

```powershell
cd C:\Users\HANK\idea\my-app
npm install
```

### 2. 啟動 Expo

Windows PowerShell 如果不允許執行 `npx.ps1`，請使用 `npx.cmd`：

```powershell
npx.cmd expo start --tunnel
```

接著使用手機的 Expo Go 掃描終端機顯示的 QR Code。

### 3. 下載 AI 模型

第一次開啟 App 時：

1. 前往 **Settings**。
2. 點選 **Download Model** 並等待進度完成。
3. 回到 **Create** 選擇照片。
4. 點選 **Remove background**。

第一次產生標籤或使用 CLIP 測試時，App 會額外下載約 90 MB 的 CLIP 模型檔案，請保持網路連線。

## 常用指令

```powershell
# 啟動開發伺服器
npm.cmd start

# TypeScript 檢查
npx.cmd tsc --noEmit

# 檢查 WebView 引擎 HTML 內的 JavaScript
npm.cmd run check-engine
```

## 專案結構

```text
my-app/
├─ app/
│  ├─ (tabs)/              # Create、Gallery、Settings
│  ├─ gallery/[id].tsx     # Gallery 照片放大頁
│  └─ _layout.tsx          # App Provider 與導覽入口
├─ assets/webview/         # AI WebView 推論頁面
├─ components/             # Gallery、透明背景、標籤與 CLIP 元件
├─ src/lib/                # AI 引擎、模型管理與圖片處理
├─ scripts/                # 引擎檢查工具
└─ ders/                   # 課程及提示詞文件
```

## 隱私與目前限制

- 照片及 AI 處理都留在使用者的手機上，本專案不會把選取的照片上傳到伺服器。
- Gallery 目前只保存在記憶體中，重新啟動 App 後照片會消失。
- 目前沒有帳號、雲端儲存或分享功能。
- AI 模型第一次使用時需要網路下載，下載完成後會保存在裝置上。

## 參考專案

AI 引擎架構與課程參考：[hmtcelik/bgone](https://github.com/hmtcelik/bgone)

## 專案狀態

這是一個學習中的 Expo App，目前進度為 **WEEK 3+4**。
