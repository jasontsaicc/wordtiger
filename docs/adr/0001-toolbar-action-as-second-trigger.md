# ADR-0001: 用工具列圖示當第二個觸發入口

Date: 2026-08-24 | Status: superseded by [ADR-0005](0005-toolbar-popup-control-center.md)

## Context

原本只有 Alt+U 一個入口。Mac 的 Edge 上按了沒反應時,無法判斷是快捷鍵那一層沒觸發,
還是注入那一層爆掉。擴充也沒有宣告 `action`,工具列上完全看不到它,
使用者沒有任何「它還活著」的訊號。

## Decision

manifest 加 `action: {}`,不給 `default_popup`。
`action.onClicked` 和 `commands.onCommand` 呼叫同一個 `toggle()` 函式。

## Alternatives

- **只留快捷鍵**:失敗時無法二分。Mac 上 Option 組合鍵容易被系統輸入層或網頁吃掉,
  這一層本身就是可疑對象,不該是唯一入口。
- **給 `default_popup`**:有 popup 就不會觸發 `onClicked`,還要多維護一個頁面。
  開 popup 也不等於在當前分頁執行注入,反而多一層要驗證的東西。
- **右鍵選單 `contextMenus`**:要多一個權限,滑鼠操作比按鍵慢,
  跟這個工具「手不離鍵盤」的用法不合。

## Consequences

多一個不用記快捷鍵的入口,同時是活著的視覺訊號。兩個入口共用 `toggle()`,
以後改注入邏輯只改一處。代價是工具列多一個圖示;目前沒有 `default_icon`,
瀏覽器會顯示佔位圖。點圖示和按快捷鍵一樣都是使用者手勢,兩者都會授予 `activeTab`,
所以權限模型沒有變。
