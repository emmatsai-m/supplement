# 服用紀錄卡｜保健食品購買與成效追蹤

記錄保健食品的採購資訊（品項、品牌、規格、效期、存放地點、採購人）、依品項與地點分組的庫存總表（可直接使用／編輯／刪除），以及同品項不同品牌的性價比比較。全家共用同一份雲端資料，僅限知道通行碼的人可以存取。

## 檔案結構

```
.
├── index.html      網頁主體結構
├── style.css       版面樣式
├── script.js       主要邏輯（表單、庫存分組、編輯/使用、Firebase 連線）
└── README.md       本說明文件
```

## 分頁功能

### 📋 購買紀錄
記錄日期、品項、品牌、規格／劑量、每瓶顆數、購買瓶數、總價（自動換算每瓶單價與每顆成本）、有效期限（年月）、存放地點、採購人。下方為條列式清單，每頁 20 筆，可編輯或刪除單筆紀錄。

### 📦 庫存總表
依「品項＋存放地點」分組成卡片，每張卡片顯示：
- 累計購買顆數／已使用顆數／估算剩餘顆數
- 效期狀態標籤（即期／已過期會標色提示）
- 最近一次採購人

每張卡片可以：
- **使用**：記錄一次服用（含顆數增減、身體反應標籤、備註），自動累計扣除庫存
- **📋 明細**：展開查看該品項＋地點底下所有採購批次與使用紀錄，可個別編輯或刪除

支援依品項名稱搜尋、每頁 12 張卡片分頁。

### 🏷️ 性價比比較
依品項分組，列出所有品牌／時間點的採購批次，依「每顆成本」由低到高排序，成本最低的批次會標示 🏆，同時顯示採購人。支援依品項名稱搜尋。

## 技術架構

- 前端：純 HTML／CSS／JavaScript，無框架、無需建置流程
- 資料庫：[Firebase Firestore](https://firebase.google.com/docs/firestore)（即時同步）
- 驗證：Firebase Authentication（電子郵件／密碼登入，帳號僅由管理者於 Firebase 主控台手動建立，不開放自助註冊）
- 託管：[GitHub Pages](https://pages.github.com/)

## 部署設定

### 1. 建立 Firebase 專案
到 [Firebase 主控台](https://console.firebase.google.com) 建立專案，啟用 **Firestore Database**（建議地區 `asia-east1`）與 **Authentication → 電子郵件/密碼** 登入方式，並在「使用者」分頁手動新增一組帳號，密碼即為家庭通行碼。

### 2. 設定 Firestore 安全規則
到「Firestore Database → 規則」貼上專案內附的 `firestore.rules` 內容並發布。

### 3. 填入設定值
編輯 `script.js` 最上方：

```js
const firebaseConfig = { apiKey: "...", authDomain: "...", projectId: "...", storageBucket: "...", messagingSenderId: "...", appId: "..." };
const FAMILY_EMAIL = '你在 Authentication 建立的帳號 email';
```

### 4. 部署到 GitHub Pages
將 `index.html`、`style.css`、`script.js` 上傳到 repository 根目錄，於 Settings → Pages 啟用即可。

## 資料結構（Firestore）

```
family/shared/purchases/{docId}
  date, itemName, brand, spec, unitsPerContainer, containerQty,
  totalPrice, expiryMonth, location, buyer, createdAt

family/shared/usages/{docId}
  date, time, itemName, location, qty, dose, note, reactions[], createdAt
```

庫存估算邏輯：同一「品項＋存放地點」的累計採購顆數，扣除該品項＋地點底下所有使用紀錄的顆數總和，即為估算庫存（非精確值，假設所有使用紀錄的顆數輸入正確）。

## 安全性說明

- 密碼從未寫入任何程式碼，僅由使用者於瀏覽器輸入，經 Firebase 伺服器端驗證
- Firestore 安全規則會拒絕未登入的讀寫請求，並驗證寫入／更新資料的欄位格式，避免異常或惡意資料寫入
- 帳號僅由管理者於後台手動建立，不開放公開註冊
- 購買紀錄開放編輯（update），使用紀錄僅開放新增與刪除（不可修改內容，避免竄改服用歷史）
