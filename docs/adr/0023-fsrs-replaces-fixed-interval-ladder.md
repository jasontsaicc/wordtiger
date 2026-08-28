# ADR-0023: 用 ts-fsrs 取代固定間隔階梯，卡片狀態整組存在 words

Date: 2026-08-28 | Status: accepted | Supersedes: [ADR-0011](0011-contextual-binary-spaced-review.md) 的排程部分

## Context

ADR-0011 的 1、3、7、14、30 天階梯只看「連續答對幾次」，不看這張卡實際多難、上次隔了多久。
同一疊卡片裡，早就記住的字和每次都溜掉的字拿到一樣的間隔，練習時間沒有花在真正需要的卡上。
階梯也只有五格，走到第 5 階之後就停在 30 天，沒有繼續延長的空間。

FSRS 依 stability 與 difficulty 排程，能處理這件事，但它的官方預設帶有 1 分鐘與 10 分鐘的
learning steps。那組步驟假設使用者會坐在桌前連續練到熟，跟「上班空檔開一下，一天可能只練一張」
的實際節奏不合：卡片會在同一晚重複出現，關掉頁面後又長期顯示逾期。

## Decision

- 使用官方 `ts-fsrs`，在 `package.json` 釘 exact `5.4.1`。該版的 `FSRSVersion` 已經是
  `using FSRS-6.0`，不需要為了 FSRS-6 改用 beta。不自行實作公式，也不訓練個人化權重。
- 建立 scheduler 時關閉短期記憶步驟：`enable_short_term: false`、`learning_steps: []`、
  `relearning_steps: []`。其餘沿用套件預設權重與 90% requested retention。排程以天為尺度。
- 既有二元自評不變：「抓到了」對應 `Rating.Good`，「又讓牠溜了」對應 `Rating.Again`。
  介面不出現 `Hard` 與 `Easy`，也不由回答時間猜測評分。
- 卡片狀態整組存進既有 `words` 的 `fsrsCard`，欄位名直接對應 ts-fsrs 的 `Card`，
  `Date` 在儲存邊界轉成毫秒整數。Supabase 對應單一 JSONB 欄位 `fsrs_card`，
  沿用 `words.updatedAt` 的整列 last-write-wins，不做欄位級 merge。
- `due` 存檔時往下取整到當地午夜，`last_review` 保留原時刻。
- 讀出的 `fsrsCard` 交給套件前先驗證。缺少整個物件是合法新卡；物件存在但損壞則停止寫入並
  顯示可重試錯誤，不偷偷重設。`elapsed_days` 視為選填，ts-fsrs 已標記它在 6.0 移除。
- 不重播舊 `reviewLog` 建立 FSRS 狀態，也不搬移 `reviewStep` 與 `reviewDueAt`。
  兩個舊欄位停止寫入、退出排程，只有「已經馴服」的顯示條件仍讀 `reviewStep`。
- 「已經馴服」的條件改成 `scheduled_days >= 30` 或舊的 `reviewStep >= 5`。

## Alternatives

- **完整採用官方 1／10 分鐘 learning steps**：演算法合理，但不符合使用者只在空檔開啟的節奏。
- **保留分鐘級 due、只在 UI 擋同日重複**：資料會長期顯示逾期，等於餵給 FSRS 錯誤的學習行為。
- **繼續固定 1、3、7、14、30 天**：簡單，但不依卡片難度與實際間隔調整，也停在 30 天。
- **自行實作 FSRS 公式**：省一個依賴，但版本、邊界與日期處理都是自找的錯誤來源。
- **每個 FSRS 值各建一個 SQL 欄位**：同步 mapping 與 schema 欄位過多，而卡片狀態本來就整組更新。
- **另建 `fsrsCards` 表**：每個 word 只有一張卡，拆表只是複製主鍵、同步與衝突邏輯。
- **用舊 review log 重建狀態**：目前只有單一使用者與少量卡片，遷移成本沒有收益。

## Consequences

排程改由卡片實際表現決定，間隔可以超過 30 天，也能對常溜掉的字縮短。既有卡片一律視為 FSRS
新卡，升級後的第一次間隔會比舊階梯短，`reviewLog` 的歷史次數不受影響。

`due` 取整到午夜只影響本機的到期判斷。`next()` 由 `last_review` 與當下時間算 elapsed days，
不讀輸入卡片的 `due`，排程數學不變。晚上作答排到「明天」的卡，隔天白天打開就選得到。

本機 Dexie 不需要 migration，`words` 的索引沒有變動，舊列自然缺少 optional 的 `fsrsCard`。
正式使用同步前必須在 Supabase 重新執行 `schema.sql` 加入 `fsrs_card`；沒更新 schema 時本機
學習照常運作，同步呈現既有錯誤。

整列 LWW 的代價要講清楚：還沒 pull 就先 push 的裝置，會把雲端已有的卡片蓋成 null。這與現在的
`review_step` 行為一致，差別在於被蓋掉的是一組記憶狀態而不是一個整數。`reviewLog` 仍然保留，
重練幾次就會回到接近的間隔。
