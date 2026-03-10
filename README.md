# 📊 財務分析系統 v4.3

React + Vite + Firebase Firestore 財務儀表板，支援多人共用、雲端資料庫。

## 步驟一：建立 Firebase 專案

1. 前往 https://console.firebase.google.com，用 Google 帳號登入
2. 點「新增專案」→ 填名稱 → 建立
3. 左側點「Firestore Database」→「建立資料庫」→「測試模式」→ 地區選 asia-east1（台灣）
4. 左側「專案設定」（齒輪）→「你的應用程式」→ 點「</>」網頁圖示 → 複製 firebaseConfig 所有值

## 步驟二：填入 Firebase 設定

打開 src/firebase.js，填入你的設定值後存檔。

## 步驟三：Build 網站

安裝 Node.js LTS（https://nodejs.org），開啟命令提示字元：

  cd 你解壓縮的路徑\finance-dashboard
  npm install
  npm run build

完成後產生 dist 資料夾。

## 步驟四：上傳到 GitHub Pages（不需要 Git）

1. 到 github.com 建立新 repository，名稱 finance-dashboard，選 Public
2. 打開 dist 資料夾，全選所有檔案，直接拖曳到 GitHub 網頁
3. GitHub 專案 → Settings → Pages → Branch 選 main → Save

網址：https://你的帳號.github.io/finance-dashboard

## 注意事項

- Firebase 免費方案每日讀取 50,000 次、寫入 20,000 次，小團隊完全足夠
- 測試模式 30 天後需到 Firestore → 規則，將條件改為 allow read, write: if true → 發布
