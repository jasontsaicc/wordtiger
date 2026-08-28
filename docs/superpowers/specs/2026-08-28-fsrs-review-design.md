# 今晚打老虎 FSRS 與低壓學習進度設計

日期：2026-08-28  
狀態：已書面審閱，待實作。分兩批交付，見「交付順序」。

## 目的

把「今晚打老虎」的固定 1、3、7、14、30 天排程改為 FSRS，並讓使用者看得出：

- 哪些卡片尚未練過。
- 每張卡練過幾次、抓到幾次。
- 哪些卡片現在可練、哪些已排到未來。
- 即使一天只練一張，也能感覺自己持續前進。

產品基調是低壓、可中斷、有空再練。沒有每日最低張數，也不把未完成、忘記或隔天沒上線呈現成失敗。

## 不做

- 不提供 FSRS 參數設定頁。
- 不訓練個人化 FSRS 權重，也不加入 optimizer。
- 不提供 Again／Hard／Good／Easy 四個按鈕。
- 不重播舊 `reviewLog` 建立 FSRS 狀態，也不搬移舊 `reviewStep`／`reviewDueAt`。
- 不加入 streak、XP、排行榜、每日目標、逾期警告或記憶百分比。
- 不預先加入分頁、虛擬列表或新的學習儀表板；真實資料量造成延遲時再處理。

## 排程決策

使用官方 `ts-fsrs` 套件，釘 `5.4.1` 這個 exact version 寫入 `package.json`，並由 `pnpm-lock.yaml` 鎖定。5.4.1 的 `FSRSVersion` 已經是 `using FSRS-6.0`，不必為了 FSRS-6 去用 `6.0.0-beta`。應用程式使用該版本的預設權重與 90% requested retention，不自行實作公式。

使用者不會持續在線，因此關閉官方預設的分鐘級學習步驟：

```ts
fsrs({
  enable_short_term: false,
  learning_steps: [],
  relearning_steps: [],
})
```

其餘參數沿用套件預設值。排程以天為尺度，同一張卡不會因 1 分鐘或 10 分鐘 learning step 在同一晚再次出題。

現有二元自評維持不變：

| 介面操作 | FSRS rating |
| --- | --- |
| 又讓牠溜了 | `Rating.Again` |
| 抓到了 | `Rating.Good` |

`Hard` 與 `Easy` 不出現在介面，也不由回答時間或其他啟發式自動猜測。

## 一輪與選題

一張卡代表一隻老虎，一輪最多五張不同卡片。五張是上限，不是每日目標；使用者可以在任何一張完成後選擇「今天先到這裡」。

每次建立一輪時：

1. 只選 `status === 'unknown'` 且未刪除的卡片。答案材料留到第 3 步才查。
2. 用單一比較函式排序：已到期卡在前，依 due 由早到晚；其後是尚無 `fsrsCard` 的新卡，依 `collectedAt ?? createdAt` 由早到晚。
3. 排序後才逐張檢查答案材料，湊滿五張就停。不先算「還缺幾張」再補：到期卡缺詞典時，那個算法會回傳只有兩張的一輪，卻讓新卡繼續等。
4. 未到期卡片不提前出題；已馴服卡片不出題。
5. 關閉頁面不算失敗，未完成的卡片下次重新建立一輪時再選。

選題不顯示紅色 backlog 或逾期天數。完整數量可在「我的攔路虎」查看，但不在每次練習入口催促使用者。

## 資料模型

FSRS 卡片與 `words` 是一對一關係，使用既有 `words` 保存完整卡片狀態，不新增本機表。

```ts
interface StoredFsrsCard {
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days?: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: State;
  last_review?: number;
}

interface WordRow {
  // 既有欄位
  fsrsCard?: StoredFsrsCard;
}
```

欄位名稱直接對應 `ts-fsrs` 的 `Card`；`Date` 在儲存邊界轉成毫秒整數，呼叫 scheduler 前再還原。這能維持 IndexedDB、runtime messaging 與 JSON 同步資料都是 plain data。

`due` 轉成毫秒時往下取整到當地午夜，`last_review` 保留原本時刻。關掉 learning steps 不會讓 `due` 對齊日界線：晚上 22:40 作答排到「明天」，若保留原時刻，隔天 21:00 打開時這張卡還沒到期，畫面講的「下次：明天」就跳票。取整只影響本機的到期判斷，`next()` 由 `last_review` 與當下時間算 elapsed days，不讀輸入卡片的 `due`，排程數學不受影響。讀取端沿用 `due <= now`，不必各自記住日界線規則。

本機 Dexie 不需要 schema migration：`words` 的索引沒有改變，舊列自然缺少 optional `fsrsCard`。缺少時一律視為 FSRS 新卡，因此既有卡片不繼承固定階梯進度。

既有 `reviewLog` 保留，繼續作為「練過 N 次／抓到 C 次」與學習足跡的唯一歷史來源；它不參與 FSRS 初始化，也不增加欄位。

`reviewStep` 與 `reviewDueAt` 從排程程式移除但資料欄位暫不刪除。新版本不再寫入它們，也不用於排程，只有「已經馴服」的顯示條件會讀一次 `reviewStep`，避免沒有收益的破壞性 migration。

## 寫入流程與原子性

回答一張卡時：

1. 取得 `words` 列並確認仍是有效生詞。
2. `fsrsCard` 缺少時，以回答當下建立 empty card；存在時先驗證並還原成 `Card`。
3. 將二元結果映射為 `Again` 或 `Good`，呼叫 `scheduler.next()`。
4. 把新的完整卡片狀態序列化回 `words.fsrsCard`。
5. 在既有 `reviewLog` 寫入 `{ id, word, remembered, at }`。

步驟 4、5 保持在同一個 Dexie transaction。排程或紀錄任何一邊失敗時全部回滾，避免卡片前進但次數沒增加，或留下成績卻仍立即到期。

runtime message 不再只回傳 boolean；成功時一併回傳 `nextReviewAt`，讓完成畫面能立即告知「下次明天／某日期」。

「已經馴服」仍以既有 `masterWord` 原子更新狀態與紀錄。當 `scheduled_days >= 30` 或舊的 `reviewStep >= 5` 時，複習畫面才顯示此操作；多這一個條件，既有停在第 5 階的卡片不會因為改用 FSRS 就失去按鈕，也不必為此做資料搬移；從「我的攔路虎」手動切換狀態仍維持既有行為。恢復成生詞時保留既有 FSRS 狀態與歷史。

## Supabase 同步

Supabase `words` 增加單一 JSONB 欄位：

```sql
alter table public.words
  add column if not exists fsrs_card jsonb;
```

`RemoteWord`、`localWord()` 與 `remoteWord()` 負責在 `fsrs_card` 和 `StoredFsrsCard` 之間轉換。`remoteWord()` 一律輸出 `fsrs_card: row.fsrsCard ?? null`，不用條件展開：`push()` 一次送最多 500 列，PostgREST 的 bulk insert 要求同批物件的 key 集合一致。FSRS 卡片是一組不可分割的記憶狀態，不做欄位級 merge，沿用 `words.updatedAt` 的整列 last-write-wins。

舊版客戶端上傳時不包含 `fsrs_card`，PostgREST 的 merge upsert 不會主動把未提供的欄位設成 null。正式使用同步前仍需在 Supabase 重新執行 `schema.sql`；未更新 schema 時，本機學習照常運作，同步呈現既有錯誤。

多裝置同時回答同一張卡時，FSRS 狀態沿用 words 的 last-write-wins；兩次不可變 `reviewLog` 都會保留。這與目前進度欄位的衝突語意一致，不另建合併演算法。

明確送出 `null` 的代價要寫清楚：還沒 pull 就先 push 的裝置，會把雲端已有的卡片蓋成 null。這是整列 LWW 本來就有的行為，跟現在的 `review_step` 一樣，差別在於被蓋掉的是一組記憶狀態而不是一個整數。`reviewLog` 仍留著，重練幾次就會回到接近的間隔。

## 儲存邊界驗證

從 IndexedDB 或 Supabase 讀出的 `fsrsCard` 在交給套件前驗證：

- 必要數字必須存在且為 finite number。
- `elapsed_days` 例外，視為 optional。ts-fsrs 已標記它在 6.0 移除，列為必要欄位會讓升版當天所有既有卡片被判成損壞。
- `due` 與 `last_review` 必須是有效毫秒時間。
- `state` 必須是 FSRS 支援的 enum 值。
- `reps`、`lapses`、`learning_steps` 不得為負數。

缺少整個 `fsrsCard` 是合法新卡；物件存在但損壞則不是新卡。此時該題停止寫入並顯示可重試錯誤，不可偷偷重設，以免掩蓋同步或版本問題。驗證用一個小型本地 type guard，不為此新增 schema dependency。

## 低壓學習流程

### 練習中

畫面仍顯示一輪最多五隻，但避免把五張塑造成必做目標：

```text
今晚打老虎

本輪最多 5 隻
🐾 🐾 ○ ○ ○                 今天已練 2 隻

┌──────────────────────────────────┐
│             deploy               │
│                                  │
│      這隻在這裡是什麼意思？        │
│                                  │
│  [ 又讓牠溜了 ]    [ 抓到了 ]      │
└──────────────────────────────────┘

[ 今天先到這裡 ]
```

卡片可顯示「過去練過 N 次」，但不在回答前顯示成功率，避免過去表現影響當下自評。

### 每張完成後

無論抓到或溜走，都算一次有效練習。主要訊息是投入，而不是分數：

```text
              🐾

         今天又前進 1 步

    記得或忘記，都是學習的一部分。
        deploy 下次：明天

     [ 再抓一隻 ]   [ 今天先到這裡 ]
```

按「再抓一隻」才進入本輪下一張；不自動推進。完成五張或沒有更多題目時顯示收工畫面，但不使用全對慶祝與失敗責備。抓到數可以作為次要資訊保留。

回饋只使用短促換色與一次虎掌出現，不加入循環動畫、聲音或 confetti。`prefers-reduced-motion` 下改為靜態換色或短淡入。

## 完整總表

現有「我的攔路虎」就是全部學習進度，不新增另一個 dashboard。

頁首提供：

- 全部。
- 現在可練。
- 尚未打過。
- 排程中。
- 已馴服。

這些學習進度只計算 `collectedAt !== null` 的真正收藏。按 `X` 排除、從未收藏的
`known` 列不是卡片，不得灌入「已馴服」數字；它在全部清單中標示為「已排除」。

每個單字使用收合列：

```text
deploy
練過 3 次 · 抓到 2 次 · 下次明天

rollback
尚未打過 · 有空時再認識牠
```

點擊後才展開 AI 詞典與來源語境。既有搜尋保留，進度篩選就是上面那五個，排序增加「下次複習」。狀態文字依下列順序取第一個成立的規則，規則會重疊，所以順序是規格的一部分：

1. `status === 'known' && collectedAt === null`：已排除，不列入學習進度。
2. `status === 'known'`：已馴服。
3. 缺少 AI 詞典，片語另缺來源語境：還不能出題，提示先查一次詞。
4. 無 `fsrsCard`：尚未打過。
5. `fsrsCard.due <= now`：現在可練。
6. `scheduled_days >= 30`：漸漸穩定。
7. 其餘：排程中。

第 3 條不能省。選題本來就要求可核對的答案材料，少了這條，沒有詞典的字會永遠掛在「現在可練」卻永遠不出題，總表的數字跟實際題數對不起來。它只出現在「全部」清單，不另開篩選。

總表不顯示紅色 overdue，也不把本週與上週互相比較。現有學習足跡繼續呈現每日收藏與練習事件，不增加 streak。

## 資料量成長

FSRS 會把熟悉卡片逐漸排遠，練習入口仍固定最多五張，不隨詞庫總量擴張。已馴服卡片保留在總表但退出題庫。

第一版只做：

- 一字一列的收合呈現。
- 搜尋、進度篩選與下次日期排序。
- 只有展開的列渲染詞典與語境內容。

IndexedDB 與 `reviewLog` 仍沿用目前的全表讀取和記憶體分組。這是刻意的簡化；個人資料量出現可測載入延遲時，再以索引、分頁或虛擬列表處理，不先增加三套複雜度。

## 錯誤處理

- 卡片在回答前被刪除或改成已馴服：拒絕寫入並提示重新載入。
- FSRS 狀態驗證或 scheduler 計算失敗：保留原資料，顯示「這題沒有存成功，請再試一次」。
- `reviewLog` 寫入失敗：transaction 回滾 FSRS 卡片更新。
- 沒有 AI 詞典或片語缺少必要語境：沿用現況，不列入題目。
- 關閉或離開未完成的一輪：不寫事件，也不修改排程。
- Supabase 缺少新欄位：本機功能不中斷，同步面板顯示錯誤並引導重新執行 schema。

## 測試與驗證

最小但完整的自動檢查：

- `Again`／`Good` 映射正確。
- 關閉 short-term steps 後，新卡不會在同一天再次到期。
- 存入的 `due` 是當地午夜；晚上作答排到明天的卡，隔天白天就選得到。
- 舊 `reviewStep` 為 5 而尚無 FSRS 間隔的卡片，仍顯示「已經馴服」。
- FSRS 卡片序列化、還原與輸入驗證。
- 一輪最多五張，優先已到期卡，再以新卡補足。
- 未到期、已馴服與缺少答案材料的卡片不出題。
- 排程更新與 append-only review log 同進同退。
- `fsrs_card` 經 Supabase push／pull 保持完整，並遵守既有 LWW。
- 總表正確推導尚未打過、練習次數、抓到次數與下次日期。
- 沒有 AI 詞典的字在總表不算「現在可練」，總表數字與實際題數一致。
- 收藏後已馴服與只按 `X` 排除的單字不會混為一談。
- 完成畫面收到並呈現 scheduler 回傳的下次日期。

交付前執行：

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm build:safari
```

## 交付順序

拆成兩批，各自能獨立出版本。第一批動資料模型與同步，風險集中在那裡；第二批只動呈現，改壞了不會傷資料。兩批都只修改既有檔案，不建立額外服務或通用 abstraction。

### 第一批：排程置換

換掉排程器，介面維持現狀，只改「已經馴服」的顯示條件。

- `package.json`、`pnpm-lock.yaml`
- `src/lib/review.ts`、`src/lib/review.test.ts`
- `src/lib/db.ts`、`src/lib/db.test.ts`
- `src/lib/messages.ts` 與相關測試：`reviewWord` 改回傳 `nextReviewAt`
- `src/lib/sync.ts`、`src/lib/sync.test.ts`
- `entrypoints/options/ReviewSession.vue`：只改馴服按鈕條件
- `supabase/schema.sql`
- CHANGELOG；新增本案 ADR，並把 ADR-0011 標成 superseded

驗收：現有複習流程照舊可用，間隔改由 FSRS 決定，Supabase 往返不掉卡片狀態。

### 第二批：低壓介面

不動資料模型與同步，只改呈現。

- `entrypoints/options/ReviewSession.vue`：每張完成畫面、文案、進度呈現
- `entrypoints/options/WordLibrary.vue`：收合列、進度篩選、下次複習排序
- `entrypoints/options/App.vue`
- `src/lib/messages.ts`：`listWords` 補上抓到次數與下次日期
- README、CHANGELOG

驗收：總表的狀態文字與篩選數字跟實際題庫一致，文案沒有失敗語氣。

## 已否決方案

- **完整採用 1／10 分鐘官方 learning steps**：演算法合理，但不符合使用者上班空檔才開啟的真實節奏。
- **保留分鐘 due、只在 UI 擋同日重複**：資料會長期顯示逾期，讓 FSRS 接收到錯誤的學習行為。
- **繼續固定 1、3、7、14、30 天**：簡單，但不會依卡片難度與實際間隔調整。
- **自行實作 FSRS 公式**：不必要且容易在版本、邊界與日期處理出錯。
- **每個 FSRS 值各建 SQL 欄位**：同步 mapping 與 schema 欄位過多，卡片狀態本來就應整組更新。
- **另建 `fsrsCards` 表**：每個 word 只有一張卡，拆表只會複製主鍵、同步與衝突邏輯。
- **用舊 review log 重建狀態**：目前只有單一使用者與少量卡片，遷移成本沒有收益。
