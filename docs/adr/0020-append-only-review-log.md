# ADR-0020: 打老虎成績存成 append-only 事件表

Date: 2026-08-27 | Status: accepted

## Context

使用者要知道每天練了幾隻、練了哪些字、每個字累計練過幾次。
在此之前只有 `words.reviewStep` 與 `reviewDueAt`，兩者都是排程狀態而不是歷史，
無法回答其中任何一個問題，也沒有其他既有欄位可以推導出複習事件。

ADR-0015 曾否決 activity 事件表，理由是它會複製 `words` 與 `contexts` 既有的 timestamp。
那個理由對收藏成立，對複習不成立：複習從來沒有留下任何時間紀錄。

## Decision

- 新增 `reviewLog`，每次自評與「已經馴服」各寫一列 `{ id, word, remembered, at }`，只新增不修改。
- 主鍵用 `crypto.randomUUID()`，成績才能跨裝置合併；同步進 Supabase 的 `review_log`。
- 不設 `deletedAt`、本機也不存 `updatedAt`；拉取時直接覆寫同一個 `id`，不做衝突解析。
- 排程更新與紀錄寫入放在同一個 Dexie transaction；「已經馴服」由單一的 `masterWord` 原子完成。

## Alternatives

- **在 `words` 加 `reviewCount` 與 `lastReviewAt`**：兩個欄位就能回答「練過幾次」，
  但答不出「幾號練了哪些」，月曆仍然做不出來。
- **只存本機不同步**：少一張雲端表與一段 schema 遷移，但換裝置就看不到同一份練習歷史，
  與 ADR-0009「學習資料跨裝置」的前提衝突。
- **沿用 ADR-0009 的 `updatedAt`／`deletedAt`／衝突解析**：表面一致，
  但不可變的列不可能衝突，這些欄位會是永遠用不到的樣板，反而讓讀者誤以為它可以被編輯。

## Consequences

`reviewLog` 是唯一不遵守 ADR-0009 資料表契約的同步表。它的正確性來自「列不可變」這個前提，
任何讓成績可以被修改的需求都會讓現在的無條件覆寫失效。

練習紀錄刪不掉：`deleteWord` 不清 `reviewLog`，刪掉一個字再重新收藏，
「練過 N 次」會帶著舊數字回來。目前視為歷史事實，不是待修的 bug。

月曆的練習資料從 1.6.0 開始累積，舊版沒有留下任何複習事件可供回填。

`listWords` 每次載入整份 `reviewLog` 計算次數。目前資料量無感，大到有感時要改成依 `at` 取區間。
