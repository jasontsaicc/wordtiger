# ADR-0021: 可同步資料表用 (user_id, id) 複合主鍵

Date: 2026-08-27 | Status: accepted

## Context

`contexts` 與 `review_log` 用客戶端產生的 uuid 當主鍵。切換 Supabase 帳號時，
`signIn` 會把本機列重新標成待上傳，新帳號於是用同一個 uuid upsert，撞上舊帳號受 RLS 保護的列。

在 Postgres 16 上以非 owner 角色實測，結果是硬錯誤而不是靜默略過：

```
ERROR:  new row violates row-level security policy (USING expression) for table "review_log"
```

`request()` 會 throw，整輪同步中斷，而且那些列維持 pending，之後每次重試都撞同一個錯，等於永久失敗。
`words` 與 `lookup_cache` 本來就是 `(user_id, word)`，不受影響。

## Decision

- `contexts` 與 `review_log` 主鍵改成 `(user_id, id)`，推送的 `on_conflict` 一併改成 `user_id,id`。
- `schema.sql` 用 `drop constraint if exists` 加 `add primary key` 做遷移。
  `id` 原本全域唯一，`(user_id, id)` 不可能重複，drop 之後 add 必定成功，因此可重複執行。

## Alternatives

- **換帳號時不重新標成待上傳**：一行就避開衝突，但等於放棄「資料跟著人搬家」，
  也與 `words`、`contexts` 現有行為不一致。
- **換帳號時重新產生 uuid**：搬得過去，但切回原帳號會產生重複列，而且本機與雲端的 id 從此對不起來。
- **應用層先查詢再決定 insert 或 update**：多一次往返，而且兩台同時推送時仍有 race，
  等於用比較差的方式重做資料庫已經提供的約束。

## Consequences

同一個 uuid 可以同時屬於兩個帳號，這是搬家的預期結果，不是資料重複。

`create table if not exists` 不會回頭修改既有資料表，所以主鍵遷移必須寫成獨立的 `alter` 敘述。
之後新增以 uuid 為主鍵的同步表時，要記得一開始就用複合主鍵，否則會再犯一次。

遷移依賴 Postgres 預設的 `<表名>_pkey` 命名。若有人手動改過約束名稱，
`add primary key` 會直接報錯而不是靜默失敗，看得出來。
