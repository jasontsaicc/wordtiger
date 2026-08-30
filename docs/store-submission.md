# Edge Add-ons 送審材料

Partner Center 每個欄位的稿子，照著複製貼上。規格取自 [Publish a Microsoft Edge extension](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)。

語言分工：審查員看的欄位（Single Purpose、權限說明、certification notes）用英文，使用者看的欄位（Description）用中文。

## 送審前檢查

| 項目 | 狀態 |
| :--- | :--- |
| 帳號類型選 Individual（驗證較快，且免費） | 待辦 |
| 截圖重拍成 1.8.0 的介面 | 待辦 |
| `pnpm zip` 產出最新封裝 | `.output/wordtiger-1.8.0-chrome.zip` |
| 隱私政策可公開存取 | <https://github.com/jasontsaicc/wordtiger/blob/master/docs/privacy.md> |

帳號的 **country/region** 與 **account type** 註冊後不能改，選之前先確認。

## Step 4　Availability

- **Visibility**：`Hidden`。只有拿到連結的人能安裝，符合先在公司電腦內部使用的目標。
- **Markets**：維持預設全部市場。Hidden 已經擋掉搜尋與瀏覽，市場再限縮沒有意義。

## Step 5　Properties

| 欄位 | 值 |
| :--- | :--- |
| Category | Productivity |
| Website | `https://github.com/jasontsaicc/wordtiger` |
| Support contact detail | `https://github.com/jasontsaicc/wordtiger/issues` |
| Mature content | 不勾 |

## Step 6　Privacy

### Single Purpose Description

```
WordTiger is a reading assistant for English web pages. It has one purpose:
help the reader understand and remember unfamiliar English words in the pages
they are already reading.

It marks words above a frequency threshold the user sets, looks a word up on
demand, explains the sentence it appears in, saves the word with its source
sentence, and schedules those saved words for spaced review.

Every feature serves that one loop: notice a word, understand it in context,
save it, review it later.
```

### Permission justification

`scripting`

```
The highlight engine is injected on demand, not kept resident. When the user
presses Alt+U, clicks the toolbar popup, or clicks the in-page launcher, the
background service worker injects the highlight content script into that tab
only. Without this permission the extension cannot start highlighting.
```

`storage`

```
Stores the user's own settings: the AI endpoint URL and API key they supply,
the word frequency threshold, highlight colours, the blocked-host list, and
which origins highlight automatically. All values stay in the browser.
```

`alarms`

```
Schedules the periodic incremental sync to the user's own Supabase project.
Sync is off unless the user sets it up and signs in. MV3 service workers are
evicted when idle, so a timer inside the worker cannot survive; alarms is the
only way to schedule this.
```

Host permission `<all_urls>`

```
Two independent reasons.

1. The floating launcher is a static content script on all URLs. Its purpose
   is to be available while the user reads any English page, so restricting it
   to a preset list of sites would remove the entry point. Clicking it triggers
   the same injection path described under "scripting", which needs host access
   to the current tab. The activeTab permission does not cover this, because
   activeTab is granted by clicking the toolbar action or invoking a keyboard
   command, not by clicking an element inside the page.

2. The AI endpoint and the Supabase project URL are supplied by the user at
   runtime. They are not known when the package is built, so they cannot be
   enumerated in the manifest.

The launcher itself makes no network requests. Data leaves the device only
after the user starts highlighting and presses A, S, D, or F. Hosts on the
user's blocked list never receive an injection at all.
```

### Are you using remote code?

選 **No, I am not using remote code**。

擴充功能會向使用者設定的 AI 端點取得文字回應，那是資料不是程式碼。回應經過 `renderMarkdown()` 跳脫後才插入畫面，`src/content/markdown.test.ts` 有對應的 XSS 測試。沒有任何遠端載入的腳本。

### Data usage

勾選這些：

- **Website content**：按 `A`／`S`／`D` 時，目標單字與它所在的那一句會送到使用者設定的端點。
- **Authentication information**：使用者填的 API 金鑰會放在 `Authorization` 標頭送給那個端點。

金鑰只送到它本來就屬於的服務，跟 FTP client 送 FTP 密碼是同一件事。開發者收不到。即使如此還是照勾，因為商店把 collect 定義成包含 transmit，**少揭露是違規，多揭露只是標籤難看一點**。這個擴充功能走 Hidden，標籤難看沒有成本。

隱私政策裡已經把兩者的流向寫清楚，兩邊說法一致。

### Privacy policy URL

```
https://github.com/jasontsaicc/wordtiger/blob/master/docs/privacy.md
```

## Step 7　Store listing

### Description（250 至 10,000 字元）

```
攔詞虎是英文網頁閱讀助手。它依你設定的詞彙程度標出生詞，讓你直接在文章裡查詞、看懂長句、
收藏語境，再用間隔複習把遇過的單字記住。

依程度標出生詞：用詞頻門檻控制難度，門檻以下不標示，以上依難度分成三層。網址、品牌與詞頻表
外的領域術語不會自動標示。

不用離開文章查資料：按 A 查詞、S 看懂句意、D 拆解句型、F 朗讀。查詞會帶入頁面上的實際字形與
所在句子，AI 能解釋 get slammed with 這類完整搭配，不是孤立地解釋原形。

連同語境一起收藏：按 Space 收藏單字時，一併保留所在的整句、來源網址與時間。同一頁的相同句子
不會重複儲存。

今晚打老虎：一輪 5 題，間隔由 FSRS 依每張卡的實際表現決定，常溜掉的字更快回來，記住的字排到
三十天以上。答完整輪才收工，中途離開已作答的成績不會掉。

資料留在本機：離線也能高亮、收藏與複習。查詞與朗讀需要你自行填入 AI 端點與金鑰，可用 OpenAI
或任何相容 OpenAI Chat Completions 格式的服務。要跨裝置時再自行建立 Supabase 專案啟用同步。
開發者不經營伺服器，也收不到任何資料。
```

### 素材

| 欄位 | 檔案 | 規格 |
| :--- | :--- | :--- |
| Extension logo | `store-assets/wordtiger-logo-300.png` | 1:1，300×300，已符合 |
| Screenshots | 待重拍 | **必須剛好** 1280×800 或 640×480，最多 6 張 |
| 促銷圖 | 不提供 | 440×280 與 1400×560，選填 |

截圖重拍後跑這行轉成規格尺寸：

```
convert docs/images/X.png -resize 1280x800^ -gravity center -extent 1280x800 -strip store-assets/screenshots/X-1280x800.png
```

### Search terms

上限 7 個詞、總共 21 字以內、每個詞 30 字元以內。

```
英文閱讀, 生詞高亮, 查單字, 間隔複習, 英文學習, AI 查詞, 詞彙
```

### Short description

這個欄位在 Partner Center 是唯讀，來源是 manifest 的 `description`。要改就先改 `wxt.config.ts` 再重新 `pnpm zip`。目前值：

```
把英文裡的攔路虎，一隻隻抓起來：標出生詞、AI 查詞與拆句
```

## Step 8　Notes for certification

審查員手上沒有 API 金鑰，沒有這段就會卡在「AI 功能測不到」而被退件。

```
Testing notes

The AI features need an API key that the user supplies. The extension ships
with no key and no default provider, so please use the test credentials below.

Test credentials
  Base URL: <填入>
  API Key:  <填入一把限額金鑰，審核通過後撤銷>
  Model:    gpt-4o-mini

Setup
  1. Open the extension options page.
  2. Go to the 設定 tab and paste the three values above.

How to test the AI features
  1. Open any English article.
  2. Press Alt+U to turn highlighting on. Unfamiliar words become marked.
  3. Hover a marked word and press A for a dictionary card, S for a plain
     explanation of the sentence, or D for a sentence breakdown.
  4. Press Space on the card to save the word with its sentence.
  5. Open the options page and choose 今晚打老虎 to run a review round.

What works without any API key
  Highlighting, saving words with their context, the word list, the calendar,
  and the review scheduling all run locally and need no network access.

Sync
  Cross-device sync is optional and off by default. It requires the user to
  create their own Supabase project. No sync account is needed to test the
  features above.

Language
  The interface is Traditional Chinese. The extension is aimed at Chinese
  speakers reading English technical documents.
```

送出後認證最長 7 個工作天。被退一次就重跑一次這段等待，所以送出前把上面每一格都填滿。
