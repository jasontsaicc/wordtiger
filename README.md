# 個人詞庫瀏覽器擴充

閱讀英文網頁時，依個人詞彙程度標示生詞，並提供 AI 查詞、翻譯、文法分析、
發音、生詞語境與本地快取管理。技術棧為 WXT、Vue 3、TypeScript、Dexie、Vitest。

目前核心 MVP 已可日常使用。最新進度與下次待辦見
[2026-08-25 作業紀錄](docs/worklogs/2026-08-25.md)。

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
```

`pnpm build` 產物位於 `.output/chrome-mv3`，可從 Chrome／Edge 的擴充功能開發者模式載入。

## 多裝置同步

1. 建立 Supabase 專案，並在 SQL Editor 執行 [`supabase/schema.sql`](supabase/schema.sql)。
2. 在 Authentication 建立 email/password 使用者。
3. 到擴充功能設定頁填入 Project URL、anon key 與帳密後登入，再按「立即同步」。

同步採 local-first：單字與語境永遠先寫 IndexedDB，離線不影響使用；登入後每 5 分鐘、
本機變更後 30 秒與手動按鈕都會做增量同步。刪除以 tombstone 傳遞，衝突採最後寫入者勝出。

## 使用方式

| 按鍵／入口 | 動作 |
|---|---|
| 工具列圖示 | 開啟目前網站控制、高亮樣式與設定入口 |
| `Alt+U` | 開關目前頁面的生詞標示 |
| `A` | 查詢滑鼠所在單字 |
| `S` | 翻譯所在句子 |
| `D` | 分析所在句子的文法 |
| `F` | 朗讀單字 |
| `Space` | 將卡片單字加入／移出生詞 |
| `X` | 將滑鼠下或卡片中的單字標成已認得／恢復自動判定 |
| `Esc` | 關閉卡片 |

## 核心規則

- 詞頻門檻代表使用者已掌握的詞彙量；門檻以下不標示，以上依門檻的 `1.5 倍`、
  `2.5 倍`分成三層。手動收藏的生詞使用獨立顏色，且優先於詞頻判定。
- 每層可分別設定背景、字體與下劃線顏色；連詞標記以點線區分並列連詞、雙線區分從句連詞。
- 按 `A` 只查詞，不儲存語境。按 `Space` 加入生詞時才儲存所在句子；相同頁面的相同句子不重複，語境數量不設上限；少於 26 字元不存。
- content script 不直接連外或操作 IndexedDB。AI 與資料操作由 background 負責；
  AI 文字透過 `runtime.Port` 串流回卡片，成功完成後才寫入快取。
- 高亮使用 CSS Custom Highlight API，不包裹或修改網頁正文節點。

## 程式入口

- `entrypoints/highlight.content.ts`：高亮、快捷鍵、卡片與 AI 串流顯示。
- `entrypoints/background.ts`：訊息處理、AI 串流通道、自動注入與同步排程。
- `entrypoints/popup/`：工具列控制中心。
- `entrypoints/options/`：AI 設定、生詞語境與快取回答。
- `src/lib/decide.ts`：詞頻、手動標記與色階判定。
- `src/lib/ai.ts`：OpenAI Chat Completions 與 SSE 解析。
- `src/lib/messages.ts`：content、options 與 background 的共用訊息入口。
- `src/lib/db.ts`：Dexie 資料表與軟刪除規則。
- `src/lib/sync.ts`：Supabase 登入、session 更新與增量拉推。

## 文件與交接

- [架構決策索引](docs/adr/README.md)
- [功能設計](docs/superpowers/specs/2026-08-23-vocab-extension-design.md)
- [P1 核心閉環計畫](docs/superpowers/plans/2026-08-23-p1-core-loop.md)
- [P3 加值功能計畫](docs/superpowers/plans/2026-08-24-p3-features.md)
- [最新作業紀錄與下次待辦](docs/worklogs/2026-08-25.md)

下個 session 建議先讀本檔與最新作業紀錄，再執行 `git status`、`pnpm test`；
優先讓關閉卡片能取消仍在進行的 AI 請求，不要先重構已通過測試的核心流程。
