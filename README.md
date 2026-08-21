# 服用紀錄卡｜保健食品購買與成效追蹤

記錄保健食品的採購資訊（品項、品牌、規格、單價、每顆成本）與服用後的身體反應，並自動計算庫存與同品項不同品牌的性價比比較。全家共用同一份雲端資料，僅限知道通行碼的人可以存取。

## 檔案結構

```
.
├── index.html      網頁主體結構
├── style.css       版面樣式
├── script.js       主要邏輯（表單、清單分頁、庫存比價計算、Firebase 連線）
└── README.md       本說明文件
```

## 功能

- **購買紀錄**：記錄日期、品項、品牌、規格／劑量、每瓶顆數、購買瓶數、總價，自動換算每瓶單價與每顆成本；條列式清單，每頁 20 筆
- **服用紀錄**：記錄日期時間、品項（下拉選單）、服用顆數、身體反應（可複選標籤）、備註；同樣條列式分頁顯示
- **庫存／比價**：依「品項」分組，顯示累計購買顆數、已服用顆數、估算剩餘庫存；同一品項底下所有採購批次依每顆成本排序，方便比較不同品牌的性價比
- **家庭通行碼登入**：僅限知道通行碼的人可以讀寫資料，其餘人打開網址只會看到登入畫面

## 技術架構

- 前端：純 HTML／CSS／JavaScript，無框架、無需建置流程
- 資料庫：[Firebase Firestore](https://firebase.google.com/docs/firestore)（即時同步）
- 驗證：Firebase Authentication（電子郵件／密碼登入，帳號僅由管理者於 Firebase 主控台手動建立，不開放自助註冊）
- 託管：[GitHub Pages](https://pages.github.com/)

## 部署設定

### 1. 建立 Firebase 專案

到 [Firebase 主控台](https://console.firebase.google.com) 建立新專案，啟用：

- **Firestore Database**（建議地區 `asia-east1`）
- **Authentication → 電子郵件/密碼** 登入方式
- 在「Authentication → 使用者」手動新增一組帳號，密碼即為家庭通行碼

### 2. 設定 Firestore 安全規則

到「Firestore Database → 規則」貼上專案內附的安全規則（限制僅登入使用者可讀寫，且會驗證寫入資料的欄位型別與範圍）。

### 3. 填入設定值

編輯 `script.js`，找到最上方這兩處並填入你自己的 Firebase 專案設定：

```js
const firebaseConfig = {
  apiKey: "你的 API Key",
  authDomain: "你的專案.firebaseapp.com",
  projectId: "你的專案 ID",
  storageBucket: "你的專案.appspot.com",
  messagingSenderId: "你的 Sender ID",
  appId: "你的 App ID"
};
const FAMILY_EMAIL = '你在 Authentication 建立的帳號 email';
```

### 4. 部署到 GitHub Pages

將 `index.html`、`style.css`、`script.js` 上傳到 repository 根目錄，於 Settings → Pages 啟用 GitHub Pages 即可。

## 資料結構（Firestore）

```
family/shared/purchases/{docId}
  date, itemName, brand, spec, unitsPerContainer, containerQty, totalPrice, createdAt

family/shared/usages/{docId}
  date, time, itemName, qty, dose, note, reactions[], createdAt
```

## 安全性說明

- 密碼從未寫入任何程式碼，僅由使用者於瀏覽器輸入，經 Firebase 伺服器端驗證
- Firestore 安全規則會拒絕未登入的讀寫請求，並驗證寫入資料的欄位格式，避免異常或惡意資料寫入
- 帳號僅由管理者於後台手動建立，不開放公開註冊
