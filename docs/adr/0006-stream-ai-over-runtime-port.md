# ADR-0006: 用 runtime Port 傳送 AI 串流結果

Date: 2026-08-25 | Status: accepted

## Context

`runtime.sendMessage` 只能回傳一次結果。查詞、翻譯或文法分析在 AI 完整回答以前，
卡片只能顯示「查詢中」，即使 OpenAI 已經開始產生文字，使用者仍要乾等。
content script 又不得直接連外，AI 請求必須留在 background。

## Decision

background 呼叫 Chat Completions 時設定 `stream: true`，用瀏覽器原生
`ReadableStream` 與 `TextDecoder` 解析 SSE，不加入 OpenAI SDK。
content script 與 background 之間使用具名 `runtime.Port`；每個文字 delta 立刻送到卡片，
完成後才寫入既有快取。快取命中則透過同一通道一次送出完整內容。

## Alternatives

- **維持 `sendMessage` 等完整結果**：程式最少，但無法改善等待體感。
- **content script 直接呼叫 OpenAI**：會打破既有網路與憑證邊界，也讓每個網頁環境都碰到 API 設定。
- **加入 OpenAI SDK**：SDK 能處理串流，但目前只需要解析 Chat Completions 的文字 delta，原生 API 已足夠。
- **同時遷移 Responses API**：可行，但與改善等待體感無直接關係，留待模型或功能需求真的需要時再做。

## Consequences

使用者會在第一個 token 到達後立即看到內容；失敗或空回答不會污染快取。
代價是多一條長連線訊息路徑與一個 SSE 解析器，解析器已有跨網路區塊的測試。
目前按 Esc 只阻止舊結果重繪，不會取消已送出的 API 請求；需要節省中途取消的費用時，
再把 port disconnect 接到 `AbortController`。
