# ADR-0002: storage 只存純資料

Date: 2026-08-24 | Status: accepted

## Context

2026-08-24 首次實機驗證,Edge 上快捷鍵毫無反應,options 頁第二次開啟全白。
根因是 `saveSettings` 把 Vue 的 reactive Proxy 直接交給 `browser.storage.local.set`。
Proxy 蓋住陣列的 exotic-object internal slot,序列化器只看到 own enumerable keys,
`["a","b"]` 被寫成 `{"0":"a","1":"b"}`。Chrome 和 Edge 走不同序列化路徑,
所以同一份程式只有 Edge 壞,看起來像相容性問題,其實是我們自己寫壞資料。

## Decision

`saveSettings` 寫入前用 JSON 來回一趟脫掉 Proxy。
`loadSettings` 對陣列欄位用 `Array.isArray()` 驗證,不合就回預設值。

## Alternatives

- **在 `App.vue` 呼叫端用 `toRaw()`**:只修這一個呼叫端,下一個寫 storage 的人會再踩一次。
  要修就修在共用的寫入函式。
- **只在讀取端驗證**:能擋住 crash,但壞資料還是會持續被寫進去,使用者的設定會默默丟失。
- **`structuredClone(toRaw(x))`**:可行,但 `settings.ts` 是 background 也在用的共用模組,
  不該相依 `vue`。

## Consequences

寫入多一次 JSON 序列化,設定檔很小,代價可忽略。
Settings 從此被限制成純 JSON 資料,不能放 `Date` 或 `Map`。
讀取端的驗證順便修好已經存壞的舊資料,使用者不用手動清 storage。
目前只驗了 `blockedHosts`,以後新增陣列欄位要記得一起加。

更一般的原則:storage 是信任邊界。資料離開過本行程、經過一個我們控制不了的序列化器,
回來時就要當成外部輸入驗證。
