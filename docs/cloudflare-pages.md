# Cloudflare Pages CI/CD

介紹站使用 Cloudflare Pages 的 GitHub 整合。分支更新產生預覽站；合併到 `master` 後，Cloudflare 執行檢查、建置並更新正式站。不需要額外的 GitHub Actions 部署工作或 Cloudflare API Token。

預定正式網址：`https://wordtiger.jasondevops.space`。程式已推送至 master；使用者於 2026-09-19 回報 Cloudflare 建立成功。正式網域、公開 HTTPS 與實際建置設定尚未由本次工作獨立確認；進度見 [工作紀錄](worklogs/2026-09-19.md)。下列保留首次設定與日後重建流程。

## 一次性連接

1. 先將本次網站來源與建置檔提交並推送至 GitHub。未提交或未追蹤的本機檔案不會出現在 Cloudflare 建置中。
2. 登入管理 `jasondevops.space` 的 Cloudflare 帳號。
3. 到 **Workers & Pages**，建立 **Pages** 專案，選 **Connect to Git**，授權存取 `jasontsaicc/wordtiger`。
4. 使用以下設定，環境變數須套用到 **Production 與 Preview**。

| 欄位 | 值 |
| --- | --- |
| Project name | `wordtiger`（若名稱不可用，另選名稱；自訂網域不受影響） |
| Production branch | `master` |
| Framework preset | None |
| Root directory | 留白，使用 repository root |
| Build command | `node --test scripts/check-site.mjs && node scripts/build-site.mjs` |
| Build output directory | `dist/site` |
| Build system | v3 |
| Environment variable | `SKIP_DEPENDENCY_INSTALL=true` |
| Node version | repository 根目錄的 `.node-version` 已固定為 `22.22.1` |

不要設成 `site/` 為 root：網站還需要其他目錄的圖片、隱私政策與共用 renderer。若帳號已有 `NODE_VERSION` 變數，請移除衝突值或設為 `22.22.1`。

網站建置只使用 Node 標準函式庫，以及專案內的 Markdown renderer。Node 原生處理該檔案的 TypeScript 型別，因此不需安裝 pnpm、tsx、Vue 或 WXT。略過依賴安裝是這套設定的一部分。

網站準備工作在 `feat/guess-first-quiz` 分支完成，正式部署使用 `master`。日後可先推送功能分支檢查 Preview，再合併進 `master`；不要把暫時工作分支誤設為 Production branch。

## 部署前自動檢查

`node --test scripts/check-site.mjs` 在沒有 `node_modules` 的臨時目錄建置網站，檢查：

- 首頁、使用指南及隱私頁都能產生，並有主標題。
- 頁面中的本機連結、圖片與樣式資源存在，且不指向部署目錄之外。
- 重建會移除舊的網站產物，避免已刪除內容繼續被部署。
- 網站與擴充功能使用同一份產生的隱私政策。

檢查失敗時，命令以非零狀態結束，後續建置與部署不會繼續。這是介紹站的檢查，不等同擴充功能全部測試；擴充功能仍需 `pnpm typecheck`、`pnpm test` 與 Edge 人工驗收。

## 分支預覽與正式發佈

在 **Settings → Builds & deployments / Branch control** 保留 `master` 作為正式分支，啟用非正式分支的 Preview deployments。Cloudflare 會為符合設定的分支更新提供預覽網址，GitHub 整合也可顯示部署狀態。

開 PR → 看 Preview → 確認頁面 → 合併 `master` → 檢查成功 → 更新正式站。

沒有設定 GitHub branch protection 時，直接推送 `master` 也會部署；如果希望強制經過 PR，需另外在 GitHub 設定分支保護。

## 只在網站相關檔案變動時建置

到 **Settings → Build → Build watch paths**，Include paths 使用：

```text
site/*
scripts/build-site.mjs
scripts/check-site.mjs
src/content/markdown.ts
docs/privacy.md
docs/images/*
public/help.html
public/icons/128.png
.node-version
```

Exclude paths 保持空白。若日後建置增加新來源，記得把它加入 Include paths；不確定時可保留預設的所有檔案都建置，避免漏部署。

## 綁定你的網域

1. 首次部署成功後，先檢查 Cloudflare 提供的 `*.pages.dev` 網址。
2. 進入 Pages 專案的 **Custom domains → Set up a custom domain**，輸入 `wordtiger.jasondevops.space`。
3. 依 Cloudflare 提示確認 DNS。若已有同名紀錄，先確認用途，不覆蓋其他服務。
4. 等待網域與憑證啟用，使用 HTTPS 檢查首頁、`help.html`、`privacy.html`。

必須在 Pages 綁定自訂網域，不能只建立 CNAME。主網域 `jasondevops.space` 不需改動。

驗證公開連線後，Edge Partner Center 可填入：

- Website：`https://wordtiger.jasondevops.space/`
- Privacy policy：`https://wordtiger.jasondevops.space/privacy.html`
- 使用指南：`https://wordtiger.jasondevops.space/help.html`

GitHub Issues 支援入口也須確認未登入可存取；若 repo 不公開，改用有效的公開支援方式。介紹站部署不會自動完成 Edge 上架。

## 本機重現 Cloudflare 建置

使用 `.node-version` 指定的 Node.js，在專案根目錄執行：

```bash
node --test scripts/check-site.mjs && node scripts/build-site.mjs
python3 -m http.server 8080 --directory dist/site
```

開啟 `http://localhost:8080`。只有 `dist/site/` 是部署內容，不包含 `.env.local` 或擴充功能封裝。網站未加入分析或追蹤腳本；Cloudflare 作為網站主機會依其政策處理連線資訊。

更新網站：修改 `site/`、`public/help.html` 或 `docs/privacy.md`，走分支／合併流程即可。取得 Edge 商店連結後，再更新首頁安裝入口與上架狀態。舊版展示圖已標示來源版本差異，送審前仍應重拍。

## 若先前已建立 Direct Upload 專案

Direct Upload 專案不能原地切換成 Git 整合。可以另外建立 Git 整合專案，確認 Preview 與正式部署正常後再移轉自訂網域；在新站可用前不要刪除舊專案。手動 ZIP 現在只作備用交付，不是日常發佈流程。

## 官方參考

- [Git 整合](https://developers.cloudflare.com/pages/configuration/git-integration/)
- [建置環境與略過依賴安裝](https://developers.cloudflare.com/pages/configuration/build-image/)
- [建置監看路徑](https://developers.cloudflare.com/pages/configuration/build-watch-paths/)
- [自訂網域](https://developers.cloudflare.com/pages/configuration/custom-domains/)
- [Direct Upload 限制](https://developers.cloudflare.com/pages/get-started/direct-upload/)
