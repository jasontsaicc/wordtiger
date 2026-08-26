# 攔詞虎 WordTiger

**把英文裡的攔路虎，一隻隻抓起來。**

攔詞虎是 JasonDevOps 製作的英文閱讀助手。閱讀英文網頁時，它會依個人詞彙程度標示生詞，
並提供 AI 查詞、快速看懂、拆句教學、自然 AI 發音、生詞語境、「今晚打老虎」間隔複習與 AI 詞典快取管理。
技術棧為 WXT、Vue 3、TypeScript、Dexie、Vitest。

目前核心 MVP 已可日常使用。最新進度與下次待辦見
[2026-08-26 作業紀錄](docs/worklogs/2026-08-26.md)。

## 快速開始

```bash
pnpm install
pnpm dev
```

正式驗證與建置：

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm build:safari
```

`pnpm build` 產物位於 `.output/chrome-mv3`，可從 Chrome／Edge 的擴充功能開發者模式載入；
`pnpm build:safari` 產物位於 `.output/safari-mv3`，供 Safari Web Extension Packager 封裝。

## 給同事試用

1. `pnpm zip` 產出 `.output/wordtiger-1.5.0-chrome.zip`，解壓縮到一個資料夾。
2. Edge 開 `edge://extensions`，開啟開發人員模式，按「載入解壓縮」選那個資料夾。
3. 首次安裝會自動打開設定頁。填服務網址、API Key 與 Model 之後才能查詞。
4. 服務欄位吃任何 OpenAI 相容端點，不限 OpenAI。
5. 不需要 Supabase。沒登入時高亮、查詞、拆句、收藏與複習全部照常，只是不跨裝置同步。

每個人要自備一把 API Key。

### 升級開發版

1. 固定使用同一個解壓縮資料夾，新版 ZIP 直接覆蓋該資料夾內容。
2. 到 `edge://extensions` 找到攔詞虎並按「重新載入」；不要先移除擴充功能，移除會清掉本機設定與登入 session。
3. 首次換到含固定 ID 的版本時需最後登入一次；此後原地升級會保留 AI、Supabase 與學習資料。

開發版固定 ID：`hpimiefbpenmngcfkjcfkakndphhofio`。manifest 內的公開 `key` 不可重新產生或替換。

## 多裝置同步

1. 建立 Supabase 專案，並在 SQL Editor 執行 [`supabase/schema.sql`](supabase/schema.sql)。
2. 在 Authentication 建立 email/password 使用者。
3. 到擴充功能設定頁填入 Project URL、anon key 與帳密後登入，再按「立即同步」。

從舊版升級且尚未同步過複習進度時，也要把目前的 `schema.sql` 再執行一次以加入
`review_step`、`review_due_at`；腳本使用 `IF NOT EXISTS`，可安全重跑。學習足跡與片語 AI 詞典沿用既有資料表，不需要額外 SQL。

同步採 local-first：單字、語境、複習進度與 AI 詞典 cache 永遠先寫 IndexedDB，離線不影響使用；登入後每 5 分鐘、
本機變更後 30 秒與手動按鈕都會做增量同步。刪除以 tombstone 傳遞，衝突採最後寫入者勝出。
只有同一 Supabase 帳號能讀取該帳號的 cache；AI Key、prompt、顏色與句子翻譯／拆句 cache 仍僅存本機。

## 使用方式

| 按鍵／入口 | 動作 |
|---|---|
| 工具列圖示 | 開啟目前網站控制、高亮樣式與設定入口 |
| 小虎懸浮球 | 預設出現在一般網頁；點一下開關生詞標示，也可拖到不擋閱讀的位置 |
| popup「今晚打老虎」 | 開啟本次 5 題的間隔複習 |
| options「學習足跡」 | 用月曆查看每天的新收藏與有收藏內容的來源文章 |
| `Alt+U` | 開關目前頁面的生詞標示 |
| `A` | 查詢滑鼠所在單字 |
| `S` | 快速看懂所在句子 |
| `D` | 拆懂所在句子 |
| `F` | 單字卡朗讀單字；快速看懂／拆句卡朗讀完整原句 |
| `Space` | 將卡片單字加入／移出生詞 |
| `X` | 將滑鼠下或卡片中的單字標成已認得／恢復自動判定 |
| `Esc` | 關閉卡片 |

## 核心規則

- 詞頻門檻代表使用者已掌握的詞彙量；門檻以下不標示，以上依門檻的 `1.5 倍`、
  `2.5 倍`分成三層。詞頻表外的網址、品牌與領域術語不自動標示；手動收藏的生詞使用獨立顏色，且優先於詞頻判定。
- 每層可分別設定背景、字體與下劃線顏色；連詞標記以點線區分並列連詞、雙線區分從句連詞。
- 按 `Space` 加入生詞時會儲存所在句子；之後對已收藏的紅色單字按 `A`，也會在查詞時加入目前語境。相同頁面的相同句子不重複，語境數量不設上限；少於 26 字元不存。
- `S` 在卡片頂端保留原文，再用「意思／關鍵」快速消除誤讀；`D` 用「意思／拆法／卡點」幫助學習同類句型。兩者都會參考游標詞、同段落前一句和頁面標題。
- 發音使用 OpenAI `gpt-4o-mini-tts` 的 `marin` AI 聲線；API 未設定、端點不支援或播放失敗時，會自動改用裝置英文語音。
- `D` 遇到可遷移結構時會輸出全英文「帶走」句型、自然使用場景與例句；按 `Space` 可連同來源語境收藏，並自動建立可同步的片語 AI 詞典快取。舊片語可在「我的攔路虎」按「AI 詞典」補建。
- 「今晚打老虎」每輪最多取 5 個到期收藏：單字使用產生 AI 詞典時的句子回想語境義；
  固定片語由來源句回想意思與用法，泛化句型則套入自己的情境口頭造句，揭曉後顯示既有 AI 詞典。
  可繼續下一輪；第 5 階可標成已馴服。
  自評「抓到了」依 1、3、7、14、30 天延長間隔，「又讓牠溜了」則隔天再來。
- 「學習足跡」只用既有收藏與語境建立月曆，不記錄沒有收藏內容的一般瀏覽歷史。
- content script 不直接連外或操作 IndexedDB。AI 與資料操作由 background 負責；
  AI 文字透過 `runtime.Port` 串流回卡片，成功完成後才寫入快取。
- 小虎懸浮球預設注入所有一般網頁，點擊與 `Alt+U` 共用背景切換流程；高亮與 AI 仍遵守黑名單。
- 高亮使用 CSS Custom Highlight API，不包裹或修改網頁正文節點。

## 程式入口

- `entrypoints/highlight.content.ts`：高亮、快捷鍵、卡片與 AI 串流顯示。
- `entrypoints/launcher.content.ts`：在一般網頁顯示小虎懸浮球並切換高亮。
- `entrypoints/background.ts`：訊息處理、AI 串流通道、自動注入與同步排程。
- `entrypoints/popup/`：工具列控制中心。
- `entrypoints/options/`：AI 設定、生詞語境與快取回答。
- `entrypoints/options/ReviewSession.vue`：「今晚打老虎」五題複習介面。
- `entrypoints/options/LearningDashboard.vue`：新收藏與來源文章月曆。
- `src/lib/decide.ts`：詞頻、手動標記與色階判定。
- `src/lib/ai.ts`：OpenAI 相容的 Chat Completions、SSE 解析與自然語音，端點可在設定頁自訂。
- `src/lib/messages.ts`：content、options 與 background 的共用訊息入口。
- `src/lib/db.ts`：Dexie 資料表與軟刪除規則。
- `src/lib/sync.ts`：Supabase 登入、session 更新與增量拉推。

## 文件與交接

- [架構決策索引](docs/adr/README.md)
- [版本變更紀錄](CHANGELOG.md)
- [功能設計](docs/superpowers/specs/2026-08-23-wordtiger-design.md)
- [P1 核心閉環計畫](docs/superpowers/plans/2026-08-23-p1-core-loop.md)
- [P3 加值功能計畫](docs/superpowers/plans/2026-08-24-p3-features.md)
- [最新作業紀錄與下次待辦](docs/worklogs/2026-08-26.md)

## 資料來源

詞頻排名來自 SUBTLEX-US（Brysbaert & New, 2009），經 npm 套件
`subtlex-word-frequencies` 在 build 時轉成本地 `freq.json`，執行期不連外查詢。

## 品牌資產

- 主 icon：[`assets/brand/wordtiger-icon-master.png`](assets/brand/wordtiger-icon-master.png)
- 擴充功能 icon：`public/icons/16.png`、`32.png`、`48.png`、`128.png`
- 商店素材：`store-assets/wordtiger-logo-300.png`、`wordtiger-app-icon-1024.png`

## 延後發佈規劃

- Edge Add-ons：產品流程穩定後，補商店文案、隱私政策與審核說明，先以 Hidden 上架。
- macOS Safari：Edge 版穩定後，以 Safari 17.2 為最低版本做實機相容測試，再處理 Apple Developer Program 與 App Store 包裝。

下個 session 建議先讀本檔與最新作業紀錄，再執行 `git status`、`pnpm test`；
商店發佈先不投入，優先處理日常使用中實際遇到的問題，不重構已通過測試的核心流程。
