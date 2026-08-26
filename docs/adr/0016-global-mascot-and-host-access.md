# ADR-0016: 小虎預設出現並使用全站 host permission

Date: 2026-08-26 | Status: accepted | Supersedes: ADR-0005 的逐網站權限決策

## Context

小虎懸浮球的用途是上班閱讀文件時持續陪伴，若每個網站都要先打開 popup 授權，使用者在看到
小虎之前就已經失去這個入口。32px 圖片放大後在高 DPI 螢幕也不夠清楚。

## Decision

- launcher 改成 `<all_urls>` 的靜態 content script，一般網頁預設顯示小虎。
- manifest 使用必要的 `<all_urls>` host permission，讓小虎點擊後能直接走既有高亮注入流程。
- 懸浮球改用既有 128px 品牌圖，不產生第二套吉祥物資產。
- popup 移除逐網站顯示開關；黑名單仍阻止高亮與 AI，不因全站權限而失效。

## Consequences

安裝或升級時瀏覽器會明確提示可讀取所有網站資料。擴充功能雖具備權限，但小虎本身不連外；
只有使用者啟動高亮並按 A／S／D 時，既有流程才會把目標字句交給背景 AI。瀏覽器內建頁仍無法注入。
