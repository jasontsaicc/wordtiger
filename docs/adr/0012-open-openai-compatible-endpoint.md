# ADR-0012: 服務端點開放自由輸入，不內建供應商清單

Date: 2026-08-26 | Status: accepted

## Context

options 的「服務」原本是只有一個 option 的 `<select>`，鎖死 OpenAI。但引擎層本來就是廠商中立的：
`ai.ts` 用 `${baseUrl}/chat/completions` 加 `Bearer`，那是 OpenAI 相容協議不是 OpenAI 專屬，
`loadSettings()` 也沒有白名單。使用者本來就要自備 key，不同相容供應商的模型、價格與額度也不同；
被擋住的只有 UI。

## Decision

服務與 Model 欄位都改成自由輸入，接受任何 OpenAI 相容端點與模型名稱。
`OPENAI_MODELS` 保留，改當作可點的建議 chip 顯示在欄位下方。

## Alternatives

- **內建供應商清單（DeepSeek、Groq、OpenRouter…）**：使用者少打字，但每加一家就是一次改 code
  加發版，而且清單一定會過期。這個誘惑會反覆出現，記在這裡是為了下次擋住它。
- **維持鎖定 OpenAI**：商店審查說明最單純，但把測試門檻壓在使用者身上，也擋掉便宜模型。
- **只開放 Model、服務仍鎖定**：解決不了「想用別家便宜端點」這個真正的需求。
- **只用 datalist 當提示**：實作過，選項要點開才看得到，看起來像只剩 placeholder 那一個，
  等於把原本一眼可見的四個選項藏起來。改成 chip。

## Consequences

使用者可以自由選供應商，測試與日常成本都能壓低；不同模型的差異也因此變成使用者可自行處理的事。

代價有三個。輸入錯誤的網址要到查詞時才會失敗，靠既有的 `originPattern()` 警告與授權提示接住。
換端點必須重新授權新網域，這在 UI 有明講。商店審查會看到一個能連任意網域的擴充功能，
權限說明必須寫清楚那是使用者自帶的 endpoint，不是開發者營運的服務。

模型行為的差異也一併變成產品要面對的事。`reasoning_effort` 就必須依模型 family 分段送出，
因為 `gpt-5.6` 系列吃 `'none'`，其餘 gpt-5 系列傳 `'none'` 會回 400，只吃到 `'minimal'`。
這項相容處理與測試保留在 `src/lib/ai.ts` 的 `reasoningEffort()` 及其單元測試。
