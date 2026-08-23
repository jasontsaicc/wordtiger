# 英文閱讀生詞擴充功能 設計文件

日期:2026-08-23
狀態:已定案,待進實作規劃

## 目的

一個 Chrome MV3 擴充功能。在任何英文網頁上按快捷鍵開啟高亮,標記生詞,自動保存生詞所在的整句語境,並在多台電腦之間同步。

對標產品是「个人词库」(`chrome.google.com/webstore/detail/ecneibafmplgkfjomcbbgbajkleanoml`),該產品已轉為付費模式。本專案不是複製它,而是在三個地方做結構性改良:不改寫網頁 DOM、AI 取代字典爬蟲、資料 local-first。

## 範圍

### 做

- 快捷鍵觸發的生詞高亮,基準線來自詞頻排名
- 查詞、整句翻譯、文法分析,全部走使用者自帶的 AI API
- 生詞語境:整句 + 網址 + 標題 + 時間
- 單字發音,用瀏覽器內建 TTS
- Supabase 跨裝置同步
- Chrome Web Store 以 unlisted 方式上架

### 不做

| 項目 | 理由 |
| :--- | :--- |
| 考試等級詞庫(小學到托福) | 改用詞頻排名加滑桿,更貼近真實語言分布,也消除了原版「切換等級要刪資料」的反直覺邏輯 |
| 字典網站爬蟲 | 13 個 parser 會一直壞。AI 一套程式碼取代全部 |
| 自架 NLP 詞法依存服務 | 併進 AI prompt |
| Anki 匯出 | 實際不會用 |
| iOS Safari 擴充功能 | 需要 App Store 上架和每年 99 美元開發者帳號 |
| Android | Chrome on Android 不支援擴充功能。Edge 需要開 flags,不值得投入 |

## 架構

```
content script  ← 按 Alt+U 才動態注入,不常駐
 ├─ 高亮引擎      走訪 text node、詞形還原、比對詞庫
 ├─ 互動層        座標定位、A/S/D/Space 鍵、釋義卡片
 └─ 語境擷取      抓整句 + URL + 標題 + 時間
       ↕ chrome.runtime.sendMessage

background service worker  ← 唯一能對外連線的地方
 ├─ commands 監聽 → chrome.scripting.executeScript
 ├─ AI client     單一 fetch,OpenAI 相容格式
 ├─ 本地資料層    Dexie / IndexedDB
 └─ 同步層        Supabase

options page      設定、詞庫管理、語境瀏覽
```

模組邊界:

- content script 不碰網路,不碰資料庫。只改畫面和發訊息。
- background 不碰 DOM。MV3 的 service worker 本來就沒有 DOM。
- options page 不碰 content script。只讀寫 background 的資料層。

service worker 閒置約 30 秒就被回收,所以任何狀態都不能留在模組層級的變數裡,一律進 IndexedDB。AI 設定每次使用前從 storage 讀,不快取在記憶體。

## 高亮引擎

### 不包 span

用 CSS Custom Highlight API,不改寫 DOM 結構。

```javascript
CSS.highlights.set("pv-unknown", new Highlight(...ranges));
```

```css
::highlight(pv-unknown) { background-color: #c8c0ff; }
```

這消除了原版最大的相容性問題。原版把每個生詞包成 `<span>`,結果是 React 重繪時高亮被洗掉,ChatGPT 偵測到 DOM 被改動而彈出崩潰畫面,最後只能讓使用者自己填 CSS selector 劃出禁區。

代價:`::highlight()` 只支援繪製類屬性,不能設 padding、圓角或 cursor。高亮樣式的可調範圍比原版小。

### 掃描流程

1. `TreeWalker` 配 `NodeFilter.SHOW_TEXT` 走訪文字節點
2. 排除 `script`、`style`、`textarea`、`input`、`code`、`pre`、`contenteditable`
3. 斷詞用 `Intl.Segmenter`(`granularity: 'word'`)
4. 詞形還原:內建不規則變化表加後綴規則。不用 Porter stemmer,它會把 `university` 砍成 `univers`
5. 判定:詞頻排名低於閾值,且不在熟詞集內,就高亮。手動標記的生詞永遠高亮,不受閾值影響
6. 只處理視野內區塊,用 `IntersectionObserver`。頁面動態變動用 `MutationObserver` 補掃

### 詞頻基準線

資料來源 SUBTLEX-US,經由 npm 套件 `subtlex-word-frequencies` 匯出成靜態 JSON,約 200KB。授權近似 CC-BY-SA,`wordfreq` 的維護者已取得 Marc Brysbaert 的商業使用許可。options 頁和商店說明頁需標註來源。

使用者用一個滑桿決定閾值,例如「高亮 5000 名以外的字」。往右拉,亮的字變少。

## 互動層

### 按鍵

| 鍵 | 動作 | 前提 |
| :-- | :--- | :--- |
| `Alt+U` | 開關高亮模式 | 全域,`chrome.commands` 註冊 |
| `A` | 第一次:一行中文釋義。第二次:展開完整卡片 | 高亮模式開啟,滑鼠停在字上 |
| `S` | 翻譯滑鼠所在整句 | 同上 |
| `D` | 該句文法分析 | 同上 |
| `Space` | 標記或取消標記生詞 | 卡片開啟中 |
| `Esc` | 關閉卡片 | 卡片開啟中 |

`Alt+U` 之外的鍵只在高亮模式開啟時攔截。焦點位於 `input`、`textarea` 或 `contenteditable` 時一律放行,避免干擾網頁自己的快捷鍵。

### 定位與樣式隔離

滑鼠底下是哪個字,用 `document.caretPositionFromPoint(x, y)` 從座標換算。它支援 Shadow DOM,把 shadow root 傳進第三個參數即可。舊版 Blink 的 `caretRangeFromPoint` 留作 fallback。

卡片定位靠 `range.getBoundingClientRect()`。高亮用的 Range 本來就在手上,不需要額外的 DOM 查詢。

卡片本身是一個掛在 `document.body` 底下的節點,用 Shadow DOM 隔離樣式。原版的 content CSS 有 69KB,大部分是在跟各網站的樣式互相覆蓋。Shadow DOM 的 style encapsulation 讓這個檔案可以縮到幾 KB。

### 漸進揭露

按 A 先給一行中文釋義,再按一次 A 才展開詞性、例句和發音。閱讀節奏被打斷的程度最小。

## AI 層

### Provider

只認 OpenAI 相容格式。使用者自己填 base URL、API key 和 model 名稱。Anthropic、Gemini、DeepSeek、OpenRouter、Ollama 都提供相容端點,一個 fetch 函式吃下全部,零 adapter。

換 provider 不用改程式碼,更不用重新送審。公司電腦若封鎖外部 AI API,可以指向內網或本機 Ollama。

放棄的是各家獨門功能(prompt caching、超長 context 定價)。以查詞、翻譯單句、解釋文法這三個用途來說,用不到。

所有 AI 呼叫都在 background service worker 發出。content script 的 fetch 受 CORS 管,service worker 在持有對應 host permission 時不受管。

### 批次預取

高亮掃描完成後,把畫面內所有已高亮但尚未進快取的字打包成一次請求,上限 30 個,結果全部寫進 `lookupCache`。之後按 A 是讀本地快取,零延遲。

payload 帶上每個字所在的句子:

```json
[
  { "w": "deploy",  "s": "We deploy to production every Friday." },
  { "w": "staging", "s": "Push it to staging first." }
]
```

送句子是為了解決一詞多義。AI 看到句子就知道 deploy 是部署程式不是部署部隊。原版做不到,因為字典只認單字不認句子。

一次問 30 個字大約幾百個 token,比 30 次往返便宜也快得多,而且每次往返都要重付 system prompt。這是 N+1 query problem 在 LLM 呼叫上的版本。

### Prompt 分層

| 層 | 內容 | 可否編輯 |
| :-- | :--- | :--- |
| 系統層 | 輸出 JSON schema、每筆字數上限、用繁體中文、不得夾帶額外說明文字 | 鎖定 |
| 使用者層 | 使用者的職業、領域、想要的解釋風格 | 開放 |

系統層鎖定的理由:批次預取依賴結構化 JSON 回傳,格式一壞,30 筆全部解析失敗,而且失敗訊息很難懂。

使用者層在 P1 只有一個 textarea,內容套用到查詞、翻譯、文法分析三個功能。預設值範例:

```
我是 DevOps 工程師,熟 Python / Shell / AWS。
解釋單字時,如果這個字在軟體工程或維運領域有特定用法,
優先給那個意思,並舉一個技術場景的例句。
```

三個功能各自的完整 template 開放編輯,排在 P3。先讓預設值跑一段時間,確認哪裡不夠用再開放。

結構化輸出用 `response_format: {"type": "json_object"}`,相容端點幾乎都支援。更嚴格的 `json_schema` 不保證,所以額外加一層寬鬆解析,處理 AI 在 JSON 外面包 markdown code fence 的情況。

## 資料模型

本地(IndexedDB,經由 Dexie):

```
words        word(PK) | status('unknown'|'known') | createdAt | updatedAt | deletedAt
contexts     id(PK)   | word | sentence | url | title | createdAt | updatedAt | deletedAt
settings     key(PK)  | value | updatedAt
lookupCache  word(PK) | payload | fetchedAt          ← 本地限定,不同步
```

`deletedAt` 軟刪除從第一天就要有。沒有它,在 A 機刪掉一個字,同步之後會從 B 機被推回來。刪除必須是可同步的事件,不能是「這筆不見了」。這個標記的通用名稱是 tombstone。

`updatedAt` 是 last-write-wins 的唯一依據。

`lookupCache` 不同步。它只是為了省 AI 費用的本地快取,兩台各自建立即可。

### 高亮判定的三種狀態

`words` 表只記錄例外。一個字在表裡沒有記錄,是正常情況而不是缺漏。

| 該字在 `words` 表的狀態 | 高亮與否 |
| :--- | :--- |
| 沒有記錄 | 由詞頻閾值決定。排名低於閾值就高亮 |
| `status = 'unknown'` | 一律高亮,即使它是常見字 |
| `status = 'known'` | 一律不高亮,即使它排名很後面 |

這個設計讓詞庫大小只跟「你標記過幾個字」成正比,跟詞頻表大小無關。滑桿拉動時不需要重寫任何資料,只是換一個比較用的數字。原版之所以要在切換等級時刪除記錄,正是因為它把基準線和例外混在同一份資料裡。

### 主鍵產生

`contexts.id` 由本地用 `crypto.randomUUID()` 產生,不依賴伺服器。這讓離線狀態下仍能建立語境,連上線後直接 upsert,不需要處理「本地暫時 id 換成伺服器 id」這種映射。

語境保存規則:

- 標記成生詞的當下,連同整句、網址、標題、時間寫入 `contexts`
- 同一個字最多留 5 條,超過汰換最舊
- 句子短於 26 字元不存,沒有語境價值

## 同步

### Schema

```sql
create table words (
  user_id    uuid references auth.users not null,
  word       text not null,
  status     text not null check (status in ('unknown','known')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, word)
);

create table contexts (
  id         uuid primary key,
  user_id    uuid references auth.users not null,
  word       text not null,
  sentence   text not null,
  url        text,
  title      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table settings (
  user_id    uuid primary key references auth.users,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table words    enable row level security;
alter table contexts enable row level security;
alter table settings enable row level security;

create policy "own rows" on words
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- contexts、settings 同上
```

RLS 不是選配。anon key 會被打包進擴充功能,任何人解開 zip 都拿得到。沒開 RLS 的表等於公開讀寫,而且外洩當下沒有任何錯誤訊息。anon key 相當於一個誰都拿得到的 role 識別碼,RLS policy 才是實際的權限邊界。

### Auth

email + password,在 options 頁登入一次。只有單一使用者,不需要 OAuth,也不需要 `chrome.identity.launchWebAuthFlow`。

Supabase JS client 預設把 session 存 `localStorage`,但 MV3 的 service worker 沒有 `localStorage`。必須傳自訂 storage adapter,選項名是 `auth.storage`,三個方法允許 async:

```javascript
createClient(url, anonKey, {
  auth: {
    storage: {
      getItem:    (k) => chrome.storage.local.get(k).then(r => r[k] ?? null),
      setItem:    (k, v) => chrome.storage.local.set({ [k]: v }),
      removeItem: (k) => chrome.storage.local.remove(k),
    },
  },
});
```

### 策略

增量拉取,不是全量:

```
拉:select * from words where updated_at > :last_sync_at
推:本地 updated_at > last_sync_at 的列,upsert
```

`last_sync_at` 存在本地 settings。衝突用 last-write-wins,比較 `updated_at`。

時鐘偏移由資料庫解決。upsert 時不送 `updated_at`,讓欄位的 `default now()` 生效,推送後用 `.select()` 把資料庫實際寫入的值取回寫進本地。所有時間戳出自同一個時鐘。

觸發時機:

1. `chrome.alarms` 每 5 分鐘一次
2. 本地變更後 30 秒 debounce 推送
3. options 頁的手動同步按鈕

### 免費版限制

Supabase 免費專案閒置一週後暫停,暫停後 90 天內可從 dashboard 還原。出差或放長假會踩到。

三個應對:

1. `chrome.alarms` 每 24 小時打一個最輕的查詢,專案不會進入閒置狀態
2. 本地永遠是 source of truth。同步只負責傳遞。Supabase 暫停、掛掉或斷網,資料完整躺在 IndexedDB,功能照常
3. 同步失敗要明顯。擴充功能圖示加紅點,options 頁顯示「上次成功同步:N 天前」。無聲失敗會讓兩台電腦的資料在毫不知情的狀況下分家

第 2 點是整個同步設計的立場,叫 local-first。雲端是傳遞管道,不是真相來源。這直接回應了原版的問題:原版是雲端優先,伺服器一旦收費或關閉,資料跟著走。

## 權限與上架

### manifest 權限

```json
"permissions": ["activeTab", "scripting", "storage", "tts", "alarms"],
"host_permissions": [],
"optional_host_permissions": ["<all_urls>"],
"commands": {
  "highlight": { "suggested_key": { "default": "Alt+U" } }
}
```

Chrome 官方文件明列四種授予 `activeTab` 的使用者手勢,其中包含「Executing a keyboard shortcut from the commands API」。所以 `Alt+U` 本身就足以取得當前分頁的注入權限,不需要 `<all_urls>` 的常駐 content script。

| | 原版 | 本專案 |
| :-- | :--- | :--- |
| 安裝時權限警告 | 讀取及變更你在所有網站上的資料 | 幾乎沒有 |
| 商店審核 | 廣泛權限,最慢的一級 | 阻力最低的一級 |
| 自動高亮白名單 | 內建 | 移到 `optional_host_permissions`,使用者自行授權 |

`activeTab` 在跨網域導航時撤銷,所以換網站要重按 `Alt+U`。產品定位本來就是按快捷鍵才啟動,這不算退步。

AI provider 的 base URL 由使用者填寫,網域不固定,同樣走 `optional_host_permissions` 動態授權。

### 上架

以 unlisted 方式上架,只有拿到連結的人能安裝。開發者帳號一次性 5 美元,現在就該辦,不要等到最後。

首次審核最慢可能兩到三週,新開發者會被歸類為需要較深入的審查。審核文件明訂 obfuscation 不允許,minify 可以。

### 公司電腦的資安考量

這個擴充功能會把瀏覽的網頁內容送到外部 AI API。如果公司有 DLP 政策,這件事本身可能違規,跟有沒有權限安裝擴充功能是兩回事。

設計上必須有網域黑名單,讓內網頁面永不觸發 API 呼叫。這是功能需求,不是選配。

## 子專案切割

| 階段 | 內容 | 完成後 |
| :-- | :--- | :--- |
| P1 核心閉環 | Alt+U 高亮、詞頻基準線加滑桿、A 鍵查詞、Space 標記、自動存語境、IndexedDB、陽春詞庫列表頁 | 單機完整可用 |
| P2 同步 | Supabase schema、登入、增量拉推、衝突處理、失敗提示 | 公司電腦與家裡互通 |
| P4 上架(提前) | 權限驗收、隱私政策頁、網域黑名單、unlisted 送審 | 公司電腦裝得起來 |
| P3 加值 | S 鍵翻譯整句、D 鍵文法分析、TTS 朗讀、完整詞庫管理 UI、prompt template 編輯 | 功能對等原版 |

P4 排在 P3 之前。首次審核耗時不可控,先用 P1 加 P2 的功能送出去踩一次流程,拿到已上架狀態,後續更新的審核會快很多。這是 walking skeleton 的思路:先讓一條最細的路徑從頭通到尾,再往裡面填功能。

## 技術選型

| 項目 | 選擇 | 理由 |
| :--- | :--- | :--- |
| 擴充功能框架 | WXT | MV3 支援完整,有 HMR。對標產品也用它 |
| 本地資料庫 | Dexie | IndexedDB 的薄封裝,不自己寫 transaction |
| UI 框架 | Vue 3 | options 頁需要表格、篩選、分頁。WXT 對 Vue 支援良好 |
| 詞頻資料 | SUBTLEX-US | 授權允許商業使用,約 200KB |
| 後端 | Supabase | 免費額度足夠,資料可隨時完整匯出 |

## 待實作規劃階段解決

- 詞形還原的不規則變化表從哪裡取得,以及它的實際覆蓋率
- 批次預取的 30 個上限是否合理,需要用真實網頁測量
- 網域黑名單的預設值(至少要含常見內網網段和 localhost)
- 專案正式名稱。目前目錄名 `vocab-ext` 是暫定,不影響商店上架的顯示名稱
