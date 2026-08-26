# ADR-0005: 工具列 popup 作為目前網站的控制中心

Date: 2026-08-25 | Status: accepted; permission model superseded by [ADR-0016](0016-global-mascot-and-host-access.md) | Supersedes: [ADR-0001](0001-toolbar-action-as-second-trigger.md)

## Context

ADR-0001 讓點擊工具列圖示直接切換標示，適合最初只有一個動作的版本。
現在使用者還需要開啟設定、控制目前網站是否自動標示、調整顏色及查看快捷鍵。
直接點擊只能執行一個動作，無法承載這些控制。

## Decision

工具列圖示改為開啟 WXT popup。popup 顯示目前分頁的開關、每個網站的自動標示、
四種標示色、快捷鍵說明與設定頁入口。`Alt+U` 保留為最快的直接切換方式。

自動標示以 origin 為單位儲存，使用者開啟時才要求該 origin 的 optional host permission；
不新增 `tabs` 權限或固定的全站 host permission。

## Alternatives

- **維持點擊直接切換**：操作最快，但需求已超過單一動作，設定入口仍無處可放。
- **右鍵選單**：需要額外權限，顏色與網站狀態也不適合階層式選單。
- **直接授權 `<all_urls>`**：省掉逐站詢問，但權限過大，也偏離使用者主動選站的預期。

## Consequences

點擊圖示不再直接切換，直接切換改由 popup 按鈕或 `Alt+U` 完成。
popup 可以在同一處說明目前網站的狀態，且自動標示只作用於明確授權的網站。
代價是多一個小型 Vue 入口，以及使用者第一次開啟網站自動標示時會看到權限提示。
