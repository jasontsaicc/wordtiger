# ADR-0003: 訊息處理失敗時回 undefined,不讓通道懸著

Date: 2026-08-24 | Status: accepted

## Context

`onMessage` listener 用 `return true` 向瀏覽器承諾「等我回話」,
再 `handleMessage(msg).then(sendResponse)`。少了 `catch`,`handleMessage` 一 reject
就永遠沒人呼叫 `sendResponse`,呼叫端的 `await` 不回應、不拋錯、不逾時。
結果是每一種失敗都長得一模一樣:白畫面加一個乾淨的 console。

## Decision

補 `.catch`,把錯誤印到 service worker console,然後 `sendResponse(undefined)` 關掉通道。
呼叫端負責處理 `undefined`。

## Alternatives

- **回錯誤信封 `{ok:false,error}`**:型別更漂亮,但每個呼叫端都要改判斷,
  而 content script 的三個呼叫點各有各的退化行為。改動遠大於收益。
- **讓它繼續懸著**:這就是 bug 本身。永遠不 settle 的 await 比拋錯更難查。
- **在呼叫端加逾時**:每個呼叫端都要包一層,逾時秒數是猜的,治標不治本。

## Consequences

失敗變成快速失敗而不是卡住,錯誤留在 service worker console。
代價是呼叫端拿到 `undefined` 時分不出「查無資料」和「出錯了」,
所以 `WordLibrary` 兩處加了 `?? []` 保底。以後新增呼叫端要記得同樣的保底。

注意 `explain` 這條路徑不受影響:它自己回 `{ok:false,error}` 信封,
因為那是預期內的失敗(AI 沒設定、網路錯誤),不是 handler crash。
