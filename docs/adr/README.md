# Architecture Decision Records

一個 ADR 記一個決定。價值在於「為什麼」以及被否決的選項,那些讀程式碼看不出來。

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [0001](0001-toolbar-action-as-second-trigger.md) | 用工具列圖示當第二個觸發入口 | superseded | 2026-08-24 |
| [0002](0002-storage-holds-plain-data-only.md) | storage 只存純資料 | accepted | 2026-08-24 |
| [0003](0003-message-failure-returns-undefined.md) | 訊息處理失敗時回 undefined,不讓通道懸著 | accepted | 2026-08-24 |
| [0004](0004-lookup-single-word-markdown.md) | 查詞從批次 JSON 改成單字 Markdown | accepted | 2026-08-24 |
| [0005](0005-toolbar-popup-control-center.md) | 工具列 popup 作為目前網站的控制中心 | accepted | 2026-08-25 |
| [0006](0006-stream-ai-over-runtime-port.md) | 用 runtime Port 傳送 AI 串流結果 | accepted | 2026-08-25 |
| [0007](0007-explicit-known-overrides-frequency.md) | 用 known 狀態覆蓋詞頻判定 | accepted | 2026-08-25 |
| [0008](0008-unbounded-deduplicated-contexts.md) | 語境不設筆數上限並做精確去重 | accepted | 2026-08-25 |
| [0009](0009-local-first-supabase-sync.md) | Supabase 只作為 local-first 的同步傳遞層 | accepted | 2026-08-25 |
| [0010](0010-wordtiger-brand-and-restrained-mascot.md) | 統一使用攔詞虎品牌並限制吉祥物的位置 | accepted | 2026-08-25 |
| [0011](0011-contextual-binary-spaced-review.md) | 用真實語境與二選一自評做最小間隔複習 | accepted | 2026-08-25 |
| [0012](0012-open-openai-compatible-endpoint.md) | 服務端點開放自由輸入，不內建供應商清單 | accepted | 2026-08-26 |
| [0013](0013-takeaway-is-not-a-highlight-key.md) | 「帶走」片語只服務教學，不作為高亮比對 key | accepted | 2026-08-26 |
