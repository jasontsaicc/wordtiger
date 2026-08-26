# ADR-0014: 用固定公開 key 維持開發版 extension ID

Date: 2026-08-26 | Status: accepted

## Context

Supabase URL、anon key、登入 session、AI 設定與 IndexedDB 都存在擴充功能自己的本機儲存空間。
開發版若每次把 ZIP 解到不同資料夾再當成新擴充功能載入，Chromium 可能產生不同 ID；使用者看到的
結果就是每次升級都要重填設定、重新登入，而且尚未同步的本機資料也留在舊 ID 底下。

把憑證另做匯出／匯入會擴大敏感資料面；`storage.sync` 同樣依賴 extension ID，也不適合放 refresh token。

## Decision

- manifest 固定一把公開 key，開發版 ID 固定為 `hpimiefbpenmngcfkjcfkakndphhofio`。
- 公開 key 是身份材料，不是 API 或簽署憑證；repo 不保存產生它時使用的私鑰。
- 開發版升級固定覆蓋同一資料夾，再到 `edge://extensions` 按「重新載入」。不得先移除擴充功能，
  因為解除安裝本來就會清掉本機儲存。
- manifest key 不得重新產生或替換。正式商店版本由商店自己的固定 ID 與更新鏈管理。

## Alternatives

- **每次重新登入**：沒有工程成本，但持續浪費使用者時間，也容易讓未同步資料留在舊安裝。
- **同步 Supabase session 或匯出憑證**：能跨安裝還原，但 refresh token 是敏感資料，不該為開發流程增加外流面。
- **只要求固定資料夾、不加 key**：一般情況可行，但身份仍依賴安裝方式；公開 key 把不變式放進產物本身。
- **等 Edge Add-ons 上架後再處理**：商店更新確實會穩定，但會讓目前每一輪實機測試繼續重設。

## Consequences

第一次換到含固定 key 的版本會被視為新 ID，必須最後登入一次；之後只要不解除安裝，原地升級會保留
Supabase session、AI 設定與本機學習資料。固定 ID 不是備份：使用者主動移除擴充功能時，本機資料仍會消失；
重要學習資料仍應先完成 Supabase 同步。
