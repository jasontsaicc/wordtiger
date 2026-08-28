# ADR-0022: 實際字形是學習呈現單位，lemma 保留為內部身分

Date: 2026-08-28 | Status: accepted

## Context

舊查詞流程會先把頁面上的字還原成 lemma，後續 AI 查詢、快取、收藏、熟詞、卡片標題、語音與複習
全部只使用 lemma。這能讓 `slam/slams/slammed/slamming` 共用收藏與複習，卻把學習者實際遇到的
字形拿掉。

例如 `We got slammed with alerts` 最有價值的學習單位不是孤立的 `slam`，而是：

- 實際字形 `slammed`，在句中是過去分詞。
- 原形 `slam`。
- 決定本句意思的搭配 `get/be slammed (with + noun)`。

AI 原本能從完整句子推斷 `get slammed`，但 UI、語音與複習只呈現 `slam`，造成「回答教對了，
產品卻讓人記錯單位」。另一方面，如果每個表面字形都成為獨立單字，收藏與複習又會大量重複。

## Decision

- `surface` 是學習呈現單位：保留頁面上的實際字形，傳給 AI，卡片在不同時顯示
  `surface → lemma`，語音朗讀 surface。
- `lemma` 是內部身分：收藏、熟詞狀態、詞頻、review key 與目前的 `lookup_cache` 主鍵仍使用 lemma。
- lookup 同時傳 lemma、surface 與來源句，讓 prompt 能先解釋實際字形的功能、原形與完整固定搭配。
- 本機 cache metadata 納入 surface 與 sentence；同步邊界維持不變，不把未收藏頁面的句子擴大上傳。
- 不新增第二套單字表、surface entity 或通用 phrase/morphology 模型。

## Alternatives

- **所有地方繼續只用 lemma**：資料最簡單，但 `slammed`、`reached` 這類實際閱讀訊號消失，
  學習者難以把型態、句法功能與固定搭配連起來。
- **每個 surface 都是獨立 key**：呈現忠實，但 `slam/slams/slammed/slamming` 會分成四份收藏、
  熟詞與複習，舊資料還需要遷移或合併規則。
- **建立完整 morphology／phrase entity**：能表達更多語言學關係，但目前需求只需要一個 surface 欄位；
  新資料表、同步 schema、關聯與 migration 的成本沒有實際使用證據支持。
- **引入 NLP lemmatizer**：可能改善長尾詞形，但不能解決 UI 與資料身分混在一起的根因，
  還增加套件大小與瀏覽器端維護成本。

## Consequences

學習者會同時看到「我遇到的樣子」「它的原形」「本句真正使用的搭配」，更容易理解、記住並遷移。
`F` 也會念眼前的 `slammed`，而不是只念資料庫 key `slam`。

既有收藏、熟詞、複習與同步資料不用 migration；同一 lemma 仍只出現一次，產品不會變成形態清單。

代價是 lookup 不再只靠 lemma 判斷語境。本機回答要連同 surface、sentence 與 prompt variant 驗證；
同步下來或舊版留下的列缺少這些欄位時視同命中，不重查，否則第二台裝置會為同一份定義重複付費；
目前仍依 ADR-0004 每個 lemma 只保留最新一份回答。如果真實使用證明需要同時保留多個語境，
再升級 cache key，而不是現在先建立第二套實體。
