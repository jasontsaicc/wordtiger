# ADR-0034: 靜態介紹站使用 Cloudflare Pages 原生 Git 建置

Date: 2026-09-19 | Status: accepted

## Context

攔詞虎已具備閱讀、查詞、收藏與複習流程，上架前需要對外介紹、使用指南與可公開存取的隱私政策。使用者擁有 Cloudflare 管理的 jasondevops.space，並要求持續部署，避免每次手動上傳 ZIP。

介紹站只需要靜態內容，不需要會員、後端或新的前端框架。網站與擴充功能必須使用一致的隱私說明。

## Decision

- 介紹站來源放在 site/，輸出為 dist/site/；沿用現有圖片，舊版畫面標明差異。
- Cloudflare Pages 連接 GitHub；master 為正式分支，其他符合設定的分支提供 Preview。建置命令先執行 scripts/check-site.mjs，再執行 scripts/build-site.mjs。
- 建置只依賴 Node 標準函式庫與既有 Markdown renderer，使用 .node-version 固定 Node 22.22.1；Cloudflare 設定 SKIP_DEPENDENCY_INSTALL=true。
- docs/privacy.md 是隱私政策的唯一來源，建置產生 public/privacy.html 並複製到網站；public/help.html 是共用使用指南。
- 部署前在無 node_modules 的臨時目錄驗證建置、頁面資源、本機連結、舊產物移除及隱私頁一致性。失敗即停止部署。
- 建議自訂網域為 wordtiger.jasondevops.space。網域綁定與 GitHub 授權在 Cloudflare 帳號完成，不把帳號 Token 寫入 repository。

## Alternatives

- 手動 ZIP：保留為備用交付，不作日常部署。
- GitHub Actions 加 Wrangler：目前原生 Git 整合足夠，避免多維護一套部署流程與憑證。
- 建置時安裝整套擴充功能依賴：網站不需要 Vue、WXT 或 tsx，因此略過。
- 網站與擴充功能各寫一份隱私頁：容易產生不同版本，改為單一來源建置。

## Consequences

Pages 的首次帳號設定、分支與監看路徑記錄在 docs/cloudflare-pages.md；設定完成後推送即可觸發相應部署。建置依賴新增時，需同步更新驗證與監看路徑。

既有 Direct Upload 專案不能原地改成 Git 整合，必要時另建專案並移轉自訂網域。網站部署與 Edge 擴充功能封裝／送審是獨立流程。
