# Edge Add-ons 送審材料

最後核對：2026-09-18。依 [Microsoft 官方上架說明](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension) 準備。

本文件是送審草稿，不代表帳號、網站或擴充功能已發佈。英文段落供審查員閱讀，中文段落供使用者閱讀。

## 送審前檢查

- [ ] 在 Partner Center 完成開發者註冊，按實際身分選帳號類型與地區。
- [ ] 執行 `pnpm typecheck`、`pnpm test`、`pnpm build`。
- [ ] 用乾淨的 Edge 設定檔載入 `.output/chrome-mv3`，完成本文件末尾的人工驗收。
- [ ] 重拍目前版本截圖。現有 `docs/images/` 為較早版本展示，不直接當成最新送審截圖。
- [ ] 依 Cloudflare Pages CI/CD 文件連接 GitHub，完成預覽驗證後合併至正式分支，確認自動部署成功。
- [ ] 在未登入狀態確認介紹頁、`privacy.html`、`help.html` 與支援入口可存取；填入實際網址。
- [ ] 將隱私頁與此處 Data usage 依 Partner Center 當時欄位逐項對照。
- [ ] 在 Partner Center 的非公開審查備註提供可用的測試端點、模型與限額金鑰；不要提交到 Git。
- [ ] 確認 `package.json` 版本與本次送審版本一致，再執行 `pnpm zip`，上傳剛產生的 ZIP；不要依舊檔名挑封裝。

部署流程與預定網址見 [Cloudflare Pages 部署說明](cloudflare-pages.md)；完成公開連線驗證前，不把預定網址當成已上線。

## Availability 與 Properties

- **Visibility**：首輪建議 Hidden，提供連結給 5–10 位目標使用者。Hidden 不會出現在搜尋或商店瀏覽中，但知道連結的人仍可安裝，不是存取控制。
- **Markets**：依實際支援範圍選擇，首輪以繁體中文使用者為主。
- **Category**：Productivity。
- **Website**：選填。部署介紹站後填入公開首頁網址；尚未部署時先留白，不填不存在的網址。
- **Support contact detail**：`https://github.com/jasontsaicc/wordtiger/issues`，送出前確認未登入也能存取；若 repo 不公開，改用有效的公開支援頁或聯絡信箱。
- **Mature content**：本專案不包含成人內容。

## Privacy

### Single Purpose Description

```text
WordTiger helps Traditional Chinese speakers understand and remember unfamiliar
English words in the web pages they read. It highlights words by a configurable
frequency threshold, explains words and sentences on demand, saves vocabulary
with source context, and schedules saved material for spaced review.
Every feature supports this reading and vocabulary-learning workflow.
```

### Permission justification

**scripting**

```text
Injects the highlighting engine into a supported tab when the user invokes the
keyboard command, toolbar popup or in-page launcher. It also restores highlighting
on sites where the user enabled automatic highlighting. Blocked hosts are rejected
by the activation path. The floating launcher is a separate static content script.
```

**storage**

```text
Stores extension settings locally: the user-supplied AI endpoint and API key,
model, profile, prompts, display preferences, blocked hosts and auto-highlight
origins. Optional Supabase configuration and session credentials are also stored
locally. AI settings are not uploaded as settings to Supabase.
```

**alarms**

```text
Schedules periodic and change-triggered synchronization to the user's own
Supabase project. Synchronization requires explicit setup and sign-in.
```

**Host permission `<all_urls>`**

```text
The in-page launcher is available on supported web pages and can activate the
highlight engine. Host access is needed for injection initiated by that page
control, which does not grant activeTab access. User-supplied AI and Supabase
endpoints are not known at build time.

The launcher makes no network requests. AI requests follow explicit actions,
including lookup, explanation, retry, pronunciation, connection testing, and
creating a dictionary entry after a phrase is saved. Optional sync sends saved
learning data to the user's Supabase project. See the privacy policy for the
specific data sent by each operation.
```

### Remote code

選 **No, I am not using remote code**。AI 回傳文字資料，透過本機 renderer 顯示；沒有下載後執行的遠端 JavaScript。

### Data usage

依實際行為揭露，不因為開發者收不到資料就省略傳輸：

- **Website content**：查詞、句意與拆句可能傳送單字、句子、前一句及頁面標題；同步包含保存的語境與來源。
- **Authentication information**：API 金鑰送到設定的 AI 端點；同步登入將帳密送到所選 Supabase 專案，後續使用工作階段憑證。
- **Personally identifiable information**：同步登入使用 email；使用者填的背景可能含職業或個人資訊，並隨 AI 提示詞送出。
- **Web history**：僅保存與同步學習語境的來源網址、標題，沒有一般瀏覽歷史追蹤。若表單將這類來源列入此分類，應揭露此範圍。
- **User activity**：本機保存查詞猜題與複習作答紀錄；啟用同步時傳送至自己的 Supabase。

依表單當時的分類定義確認勾選；與隱私政策保持一致，不以 Hidden 為省略揭露的理由。不宣稱「所有資料永遠不離開裝置」。

### Privacy policy URL

填入部署後可公開存取的 `/privacy.html` 完整網址。內容來源是 `docs/privacy.md`，由 `pnpm build:site` 產生網站與擴充功能共用版本。送出前使用未登入瀏覽器測試。

## Store listing

### Description

```text
攔詞虎是給繁體中文使用者的英文網頁閱讀助手。依你的詞彙程度標出生詞，直接在文章裡查詞、
看懂長句、收藏語境，再用間隔複習把讀過的英文慢慢記住。

依程度標出生詞：調整詞頻門檻，控制標示範圍。可收藏想學的字，或把熟悉的字標成已認得。

留在文章裡理解：按 A 查詞、S 快速看懂句意、D 拆懂句型、F 朗讀。AI 可使用目標句、前一句、
頁面標題及你填寫的背景協助解釋；AI 回答可能出錯，重要用法請再核對。

連同語境一起收藏：按 Space 保存單字或片語、原句與來源。之後在詞庫搜尋，或從學習足跡回顧。

今晚打老虎：每輪最多 5 題，先回想、看答案，再自評記得或忘了。間隔依 FSRS 排程，已作答的
成績會保留。卡片需要先有詞典內容，片語還需來源語境。

本機優先：高亮與收藏不需要 AI，已有詞典材料的複習可離線進行。新查詞、句意、拆句與 AI 語音
需自備 API 金鑰，費用由你選擇的服務依方案計算，攔詞虎不附贈額度。支援相容 Chat Completions
的文字服務；AI 語音不可用時會改用系統語音。

跨裝置同步是進階選項，需自行建立 Supabase 專案。也可匯出單字、語境及作答紀錄的 JSON，
目前不提供匯入還原，匯出不含 AI 詞典快取。

適用於一般英文文字網頁；瀏覽器內建頁與部分受保護頁面無法使用，PDF 與圖片文字不保證支援。
```

### 素材與搜尋

- Logo：`store-assets/wordtiger-logo-300.png`。
- 截圖：建議三張最新實機畫面，分別展示閱讀查詞、拆句、複習。官方列為選填，最多六張；提交時須為 1280×800 或 640×480。
- 促銷圖：首輪可略過。
- Search terms：最多七組、合計最多 21 個 words，每組最多 30 字元；以 Partner Center 計數為準。建議：`英文閱讀, 生詞高亮, 查單字, 間隔複習, 英文學習, AI 查詞, 詞彙`。
- Short description：取自 manifest 的 description，需要修改時重新封裝。

## Notes for certification

以下內容貼到 Partner Center，再補入測試憑證。切勿把真實金鑰寫回本文件或其他公開頁面。

```text
Testing notes
WordTiger has a Traditional Chinese interface. AI features require a user-supplied
API key. The default base URL is https://api.openai.com/v1; no key is bundled.

Test credentials (provide here in the private certification notes)
Base URL: [review endpoint]
API Key: [limited-budget review key]
Model: [model confirmed available with this key]

Setup and test
1. Open extension settings. Enter the supplied endpoint, key and model under
   AI 閱讀教練, then click 測試 AI 連線. It sends a short paid-provider request.
2. Open an English text article and press Alt+U to enable highlighting.
3. Hover a word and press A. The default lookup may show a multiple-choice
   question first; answer it or use the card's skip action to reveal the result.
4. Press S for sentence meaning, D for structure, and F for pronunciation.
5. Press Space to save a word with its context. Open 今晚打老虎, click 看答案,
   then 記得 or 忘了 to record a review. Each round has up to five eligible cards.
6. In 我的攔路虎, check the saved word and JSON export. Export is not a complete
   restorable backup; import is not currently provided.

Without AI
Highlighting, saving, word browsing and the activity view work locally. Offline
review requires an existing dictionary entry; phrases also need source context.
Speech falls back to browser/device speech if the configured AI endpoint does
not support the audio API. The connection test only checks text generation.

Optional sync
Expand 進階：跨裝置同步（選用） to configure the user's own Supabase project.
Sync is disabled until configured and signed in. It is not needed for the tests
above. If sync requires separate certification testing, supply a dedicated test
project/account privately, using the full repository schema.

Help and privacy pages are bundled with the extension and linked from settings.
```

## Edge 人工驗收（送審前執行）

- [ ] 全新安裝自動開設定，可看到三步開始；未設定同步也能操作。
- [ ] 空金鑰、錯誤金鑰、錯誤模型、無網路：有可理解的錯誤，測試按鈕恢復可用。
- [ ] 有效設定：連線測試成功，A／S／D 可用，重試不造成卡片卡住。
- [ ] 查詞、收藏、關掉重開、複習一題後中途離開：資料與成績保留。
- [ ] 斷網後可用已存詞典複習；沒有詞典的新收藏顯示需查詞。
- [ ] 一般文章、長篇技術文件、動態載入頁面：沒有明顯卡頓或快捷鍵干擾輸入。
- [ ] 排除網域後重新整理，無法再啟用高亮；開關與工具列入口一致。
- [ ] 所有說明與隱私連結正常，回報入口可公開存取。
- [ ] 如提供同步：測試登入、兩裝置同步、刪除同步與登出。

認證時間依實際審查而定；不要承諾固定上架日期。
