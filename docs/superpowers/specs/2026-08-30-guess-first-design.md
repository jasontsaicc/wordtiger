# 先猜再揭曉與複習語境輪替設計

日期：2026-08-30（2026-08-31 依程式現況修訂）
狀態：待實作。分兩批交付，見「交付順序」。

## 目的

現在的學習迴圈只有辨識，沒有提取：

- 查詞按 `A` 之後 0.3 秒就拿到答案，中間沒有任何認知投入。
- 打老虎是自評，看到答案才判斷自己會不會，訊號來自後見之明。
- `reviewLog` 每次只留 `remembered` 一個 bit，沒有任何內容可供日後診斷。

這份設計做兩件事：

- 查詞時先答一題三選一，把既有的串流等待時間換成一次真實提取，並留下對錯紀錄。
- 打老虎的題目輪替語境，同一個字不再永遠配同一句。

## 不做

- 不做造句練習，也不做 AI 評分。
- 不新增第四個 `PromptKind`，不新增快取表，不新增 variant 指紋。
- 三選一的對錯不影響 FSRS 排程。
- 不做弱點分析報表。這份設計只負責產生它需要的資料。
- 打老虎不出三選一。它讀的是同一份 `payload`，本批只讓它剝除。

## 決策一：三選一夾帶在 lookup 回應的最前面

模型在 `lookup` 回應的第一、二行輸出：

```
選項｜掐住、扼住｜被服務端限流擋下｜主動調降發送速率
答案｜2
```

串流順序即時序，選項會跟第一批 token 一起到，完整詞典在後面繼續串。這是本設計唯一不加 API 呼叫、不加快取、不加請求協調就能讓選項先到的做法。

`prompt.ts` 新增兩個純函式，形狀比照既有的 `extractTakeaway`：

| 函式 | 行為 |
|---|---|
| `extractQuiz(text)` | 回傳 `{ choices: [string, string, string]; right: 0 \| 1 \| 2 }` 或 `null` |
| `stripQuiz(text)` | 移除開頭的 `選項｜`／`答案｜` 行後回傳其餘內容 |

`extractQuiz` 在下列情況一律回 `null`，讓功能靜默退場而不是產生壞題：

- 兩行不在回應開頭（略過開頭空行後的第一、二行）
- 選項不是剛好三個，或任一項為空
- 選項有重複
- `答案｜` 不在 1 到 3
- 缺少任一行

兩個函式的嚴格程度不同，這是刻意的：

- `extractQuiz` 嚴格。任一條件不成立就回 `null`，寧可不出題。
- `stripQuiz` 寬鬆且無條件。開頭只要是 `選項｜` 或 `答案｜` 就剝掉，不管抽取有沒有成功。模型只吐了選項沒吐答案時，抽取會回 `null`，但那行仍然必須剝掉，否則壞題直接印在卡片上。

只認開頭的行，出現在正文中間的同名行視為內容，不動它。

## 決策二：正解位置由程式打亂，不交給模型

模型產生隨機位置並不可靠。抽出來之後在顯示端洗牌。

洗牌結果存在 content script 的 session 狀態，不進快取：

```ts
interface Quiz {
  choices: [string, string, string];   // 原始順序
  right: 0 | 1 | 2;                    // 原始索引
  order: [number, number, number];     // 畫面第 i 個位置顯示 choices[order[i]]
}
```

點第 i 個位置，作答的原始索引就是 `order[i]`，答對的條件是 `order[i] === right`。`quizLog` 一律存原始索引，不存畫面位置。

## 決策三：題型由判準決定，不寫死

`SYSTEM_RULES.lookup` 加入的規則：

- 三個選項必須互相推不出來。知道其中任一個，都不能推得出另外兩個。
- 字義本身猜得到、但語態、施事者或範圍容易讀錯時，問「這句在說誰對誰做了什麼」。
- 一般義與技術義真的無關時，才問「這個字在這句是哪一個意思」。
- 每個干擾項要對應一個真實誤讀，不放明顯錯誤來湊數。
- 三個選項的長度、詞性與具體程度要接近。

反例寫進 prompt：`throttled` 不可用義項型出題，因為「掐住」直接推得出「被限流擋下」。

`SYSTEM_RULES.lookup` 同時也是片語查詞的 system prompt（`highlight.content.ts` 收藏帶走片語後那次背景 `lookup`）。規則對單字與片語一體適用，出題單位是「查詢項目在出處句裡的意思」，不因為是片語就改變。既有的「多字片語改用 `## 核心意思` 等標題」那條規則不受影響，兩行題目在那之前。

## 決策四：作答只記錄，不影響排程

查詞時的三選一與坐下來複習是兩種不同的認知任務，混進同一個排程器會靜默污染間隔。FSRS 仍然只由「今晚打老虎」驅動。

## 決策五：揭曉是一行診斷加上原本的卡片

作答後不再多按一次鍵。對錯壓成一行放在卡片頂端，其下就是今天那張詞典卡，`Space`、`F`、`X` 行為完全不變。

理由：知道自己答錯卻還沒看到原因，這個中間狀態換不到任何東西。矯正回饋要緊貼錯誤發生的時刻。

### 怎麼作答

卡片渲染三個 `<button>`，`card.ts` 的 `CardOptions` 加一個 `onPick?: (position: 0 | 1 | 2) => void`，綁法比照既有的 `.close` 與 `.retry`。同時支援 `1`／`2`／`3` 三個按鍵當快捷鍵。

按鈕是主要介面，不是只有快捷鍵：三個沒有可見操作目標的選項，滑鼠使用者與讀螢幕的人都用不了。

### 卡片狀態機

查詞卡多一個 `quiz` 狀態：`null`（沒題目）、`pending`（等作答）、`revealed`（已揭曉或已跳過）。

- `currentDefinition` 的定義不變，永遠是**剝除後的完整答案**，串流每一段都更新它。
- 畫面上顯示什麼由 `quiz` 狀態決定，不是由 `currentDefinition` 決定。`pending` 顯示題目，其餘顯示 `currentDefinition`。
- 揭曉時串流可能還沒結束。這是正常情況，揭曉後的卡片繼續隨串流更新。

實作上把「這張查詞卡現在該顯示什麼」收斂成一個函式，所有 `showCard` 呼叫點都經過它。否則 `Space` 的重畫（`highlight.content.ts` 目前直接傳 `body: currentDefinition`）會在作答前把完整答案揭曉出來。

### 三個按鍵衝突

| 鍵 | 處理 |
|---|---|
| `A` | 跳過鍵。`quiz === 'pending'` 的分支要排在既有查詞分支之前並直接 `return`，否則跳過會對游標下的字再查一次 |
| `Space`／`X` | 重畫卡片時走上面那個顯示函式，不直接讀 `currentDefinition` |
| 重試（`onRetry`） | 不重新武裝。重問會拿到不同的題目，已揭曉就維持已揭曉 |

跳過不留下作答紀錄。選項出現前後按 `A` 都直接揭曉。

### 快取命中也出題

`handleStreamMessage` 命中快取時用單一 `onDelta` 重播整份 payload，選項與答案零等待抵達，而且跟上次是同一題。仍然出題：第二次回想還是真的回想。

代價是 `quizLog` 裡同一個字、同一組選項的列是重複曝光，不是獨立樣本。日後分析鑑別度時要先去重。

## 決策六：查詞卡的三選一有開關，放在顯示層

`guessFirst` 布林設定，預設開啟，形狀完全比照既有的 `markConjunctions`：`Settings` 欄位、`DEFAULTS`、`loadSettings` 裡的 `typeof === 'boolean'` 守衛、掛在既有的 `getHighlightSettings` 訊息上、options 頁一個勾選框。不新增 message type，不放 popup。

開關不進 prompt。`SYSTEM_RULES.lookup` 一律要求出題，`stripQuiz` 一律剝除，只有三選一的顯示與作答看設定。

理由：`lookupVariant` 把 `SYSTEM_RULES.lookup` 算進快取指紋，prompt 層的開關每切一次就讓全部已快取的字失效，開關開三次就付三輪重問。顯示層的開關切換免費，而且打開時已快取的字立刻有題可出。代價是關閉狀態下仍付兩行輸出 token，相對於一則 350 字的詞典條目可忽略。

`A` 仍然是單次跳過鍵。設定是永久開關，兩者不重疊。

## 決策七：複習語境用 `reps` 取餘數輪替

### 現況

`listReviewItems` 不是「寫死取同一句」，而是三段 fallback：

| 情況 | 今天拿到的語境 |
|---|---|
| 片語 | 最新的一筆 |
| 單字，且 `definition.sentence` 有值 | 逐字相同的那筆語境；找不到就退回合成的 `{ sentence, url: '', title: '' }` |
| 單字，且 `definition.sentence` 缺少 | 完全沒有語境 |

第三段不是假想情況。`sync.ts` 的 `localLookupCache` 不搬 `sentence`，那是本機專屬欄位，所以剛同步完的新裝置上每個單字都會掉語境，打老虎退成「你記得這個字的核心意思嗎？」。本次改動順帶修掉它，第二台裝置的畫面會因此改變。

### 改法

依 `createdAt` 排序後取餘數：

```
list[(fsrsCard?.reps ?? 0) % list.length]
```

`reps` 是 FSRS 卡片既有欄位，每複習一次加一，因此不需要新增任何狀態。三個實作限制：

1. **零筆語境會除以零。** `canAnswer` 對單字的條件是 `hasDefinition && (hasContext || 不含空白)`，右半永遠成立，所以「有詞典、零筆語境」的單字會走到這行。`% 0` 是 `NaN`，`list[NaN]` 是 `undefined`，會靜靜吃掉現有的 `definition.sentence` fallback。要有明確的長度守衛。
2. **`contexts` 不是可以直接輪替的陣列。** `listReviewItems` 裡的 `contexts` 是所有候選字混在一起的扁平陣列，順序是 Dexie 主鍵順序。要先建 `Map<string, ContextRow[]>` 並依 `createdAt` 排序。建完之後現有的 `latest` map 變成 `list.at(-1)`，可以整個刪掉。
3. **片語一起輪替。** 片語一定至少有一筆語境，統一路徑加上長度守衛就同時涵蓋兩者，`isPhrase` 那個分支可以刪掉。

`reps` 只有在 `recordReview` 成功時才前進。`fsrsCard` 損壞時 `nextReview` 回 `null`，那一列不寫入，那個字會一直拿到同一句。可接受，不另外處理。

### 詞典解釋的是哪一句

`payload` 裡的 `**本句**` 標註指的是 `definition.sentence`，也就是模型當時真正看到的那句。輪替之後題目可能是另一句，所以揭曉時要標明。

- `ReviewItem` 新增選填欄位 `definitionSentence?: string`。
- 只在它與出題語境不同時才顯示，否則單一語境的常見情況會多出一行雜訊。
- 同步下來的裝置上這個欄位不存在，UI 要能不顯示。

標籤講「詞典解釋的是這句」，不要講「你當初是在這句查的」。輪替之後每一句都是當初查它時的句子，那句話沒有區辨力。

## 資料模型

新增 `quizLog`，比照 ADR-0020 的 `reviewLog`：append-only、列不可變、主鍵用 `crypto.randomUUID()`、不設 `deletedAt`、拉取時直接覆寫同一個 `id`。

```ts
interface QuizLogRow {
  id: string;
  word: string;
  /** 洗牌前的原始索引 */
  picked: 0 | 1 | 2;
  right: 0 | 1 | 2;
  /** 供日後回頭檢查題目品質 */
  choices: [string, string, string];
  at: number;
  pending?: 0 | 1;
}
```

Dexie 版本升到 7，只加 `quizLog: 'id, at'` 一張表，不需要 upgrade function。

`supabase/schema.sql` 新增 `quiz_log`：

- 主鍵直接寫 `primary key (user_id, id)`。ADR-0021 存在就是因為單欄 `id` 弄壞過同步。不要抄 `review_log` 那段 `drop constraint / add primary key`，那是已部署資料表的補救碼，新表用不到。
- 不掛 `updated_at` trigger，理由同 `review_log` 上面那段註解：`updated_at` 停在寫入時間，重送同一列時不會被重新 pull 回來。
- `choices` 用 `jsonb`，跟 `fsrs_card` 一致。`localX`／`remoteX` mapper 對 jsonb 是原樣通過，`text[]` 兩邊都要轉換。

`sync.ts` 照抄 `review_log` 的推拉區塊，另外兩個容易漏掉的接點：

- `signIn` 的換帳號區塊要補 `db.quizLog.toCollection().modify({ pending: 1 })`。那段不在 push/pull 裡。
- `syncNow` 的兩個 `db.transaction` 都要把 `db.quizLog` 加進資料表清單。

`messages.ts` 的 `exportData` 與 `ExportBundle` 帶上 `quizLog`。這張表存在的目的就是日後回頭檢查，匯出不帶它等於看不到。

## 四個剝除點

`lookupCache.payload` 有四個消費者，都會 `renderMarkdown(payload)`：

| 位置 | 畫面 |
|---|---|
| `highlight.content.ts` 的 `runLookup` 串流回呼 | 查詞卡串流中的每一幀 |
| `highlight.content.ts` 的 `runLookup` 結果 | 查詞卡完成後 |
| `ReviewSession.vue` | 今晚打老虎 |
| `WordLibrary.vue` | 我的攔路虎 |

第一個最容易漏。串流回呼每收到一段 token 就重畫一次卡片，沒有剝除的話前幾幀會直接印出 `選項｜掐住、扼住…`。

四處都要先 `stripQuiz`，`stripQuiz` 對沒有選項行的舊 payload 必須原樣回傳。剝除與 `guessFirst` 設定無關，關閉時照剝。

打老虎讀的就是 `payload`，因此它會自動取得同一組三選一。本批不接這條線，先讓它只剝除。

## 交付順序

**第一批：複習語境輪替。** 與三選一無關，可獨立驗證與發佈。決策七與 `ReviewItem` 的新欄位。

**第二批：三選一延遲揭曉。** 依序是：

1. `prompt.ts` 的 `extractQuiz` 與 `stripQuiz`，以及 `SYSTEM_RULES.lookup` 的出題規則。
2. 四個剝除點。
3. `quizLog`、Dexie v7、`schema.sql`、`sync.ts` 與 `exportData`。
4. 卡片互動與 `guessFirst` 設定。設定的唯一消費端就是卡片，不獨立成一步。

第 4 步是整條線第一次可以端到端驗證的地方，手動 QA 的預算放那裡。前三步只有單元測試。

## 風險

| 風險 | 處置 |
|---|---|
| 改 `SYSTEM_RULES.lookup` 使既有 lookup 快取指紋全數失效 | 接受。成本是每個字一次額外 API 呼叫，隨著逐字重查分攤，不是一次性清空。`listReviewItems` 不比對 variant，打老虎沿用舊 payload 照常出題 |
| 模型沒有輸出選項行 | `extractQuiz` 回 `null`，直接退回今天的行為 |
| 模型輸出半組選項行 | `stripQuiz` 無條件剝除，壞題不會漏到畫面上 |
| 干擾項品質無法自動驗證 | 目前靠 `quizLog` 觀察。某個字每次都秒答代表該題沒有鑑別度 |
| 使用者養成連按兩次 `A` 跳過的習慣 | 本批不處理。真的發生時再考慮在第一批 token 到達前鎖住揭曉鍵 |

## 測試

- `extractQuiz`：正常、選項不足、選項重複、答案越界、缺行、舊 payload。
- `stripQuiz`：有選項行、無選項行、只有半組選項行、選項行出現在正文中間時不誤刪。
- `listReviewItems`：同一個字連續三輪拿到三個不同語境（直接餵 `fsrsCard.reps` 為 0、1、2）；只有一筆語境時不出錯；**零筆語境**時退回 `definition.sentence`；`definition.sentence` 缺少時仍拿得到語境。
- `definitionSentence`：與出題語境相同時不帶出，不同時帶出。
- `quizLog`：寫入後讀得到；同步推拉後 `id` 不重複。
- `guessFirst`：關閉時卡片不含 `答案｜`，也不顯示選項；開啟時 `A` 跳過不寫入 `quizLog`。
