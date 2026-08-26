# ADR-0009: Supabase 只作為 local-first 的同步傳遞層

Date: 2026-08-25 | Status: accepted

## Context

生詞與語境需要跨公司、家中裝置同步，但擴充功能不能因網路中斷、Supabase 免費專案暫停，
或登入 session 過期就停止工作。刪除也不能用硬刪：A 裝置刪掉的列若完全消失，B 裝置下次同步會把它推回來。

MV3 service worker 沒有 `localStorage`，而目前只需要 Supabase Auth 與 PostgREST；引入完整 SDK
會增加相依與 bundle，卻仍要另寫瀏覽器 storage adapter。

## Decision

IndexedDB 永遠是 source of truth，Supabase 傳遞 `words`、`contexts` 與 `lookup_cache`；
`words` 也承載「今晚打老虎」的 `reviewStep`、`reviewDueAt`，不另建同步表。
AI 詞典回答在同一帳號的裝置間同步，避免重複消耗 token，也讓詞庫頁能直接顯示其他裝置查過的詞典。
收藏 `D` 找出的片語時，沿用同一個 lookup 流程自動建立片語詞典；舊片語從詞庫頁按需補建，
兩者都寫入既有 `lookup_cache`，不增加表或同步分支。
AI Key、prompt、顏色與含頁面上下文的句子翻譯／拆句 cache 仍保持本機限定。
產生 AI 詞典時使用的來源句只存在本機 lookup cache，讓複習能對回查詢語境；同步 payload 時不外傳該句，
而且遠端合併與 push acknowledgement 都必須保留仍對應同一 payload 的本機句子。
切換帳號時不把既有詞典 cache 標成待上傳，避免舊帳號內容被複製到新帳號。

同步直接使用原生 `fetch` 呼叫 Supabase Auth 與 PostgREST。擴充功能只接受 publishable／legacy anon key，
使用者登入後靠 JWT 與資料表 RLS 限制為自己的列；不得使用會繞過 RLS 的 secret／service-role key。
Session 與同步游標存進 `browser.storage.local`，access token 到期前用 refresh token 更新。

每個本機修改把列標成 `pending`；升級前沒有此欄的舊資料也視為待推送。每次同步先向資料庫取得 cutoff，
再拉取 `cursor < updated_at <= cutoff` 的遠端列，避免分表查詢期間出現的寫入被新游標跳過。
衝突以 `updatedAt` 做 last-write-wins；`deletedAt` tombstone 和一般更新走同一條路。
合併後只 upsert pending 列，並以資料庫 trigger 產生伺服器 `updated_at`。伺服器回應只有在推送期間
本機列沒有再次改動時才能清除 pending，否則保留較新的本機版本等下一輪再推。

觸發時機是每 5 分鐘一次、本機修改後 30 秒，以及 options 頁的手動按鈕。同步失敗不影響本機功能，
但會保留錯誤並在工具列 badge 顯示驚嘆號。

## Alternatives

- **以 Supabase 為 source of truth**：離線或免費專案暫停時主要功能會失效，也提高服務被關閉時的遷移成本。
- **使用 `chrome.storage.sync`**：額度與單筆大小適合偏好設定，不適合持續增加的語境句子。
- **引入 `@supabase/supabase-js`**：能省少量 Auth 包裝，但此專案只用幾個 HTTP endpoint，原生 API 已足夠。
- **每次全量覆蓋**：程式表面簡單，但資料量成長後浪費流量，且無法可靠處理兩台同時修改與刪除。
- **硬刪除**：沒有可同步的刪除事件，其他裝置會讓資料復活。

## Consequences

一般閱讀、收藏與查詞不依賴網路；同步失敗後 pending 資料仍在，下次可安全重試。
資料表必須先執行 `supabase/schema.sql`，RLS 是安全邊界而非可選設定。
三個可同步表都必須維持 `updatedAt`、`deletedAt` 與本機 `pending` 語意；新增同步表時也要沿用 cutoff、
tombstone 與推送途中再修改的保護。偏好設定目前不跨裝置，真的出現需求時再為它定義可同步且不含憑證的白名單。
開發版若 extension ID 改變，瀏覽器會給它新的本機儲存空間；固定 ID 與升級流程見 ADR-0014。
