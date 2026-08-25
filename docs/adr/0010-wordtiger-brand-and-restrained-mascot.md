# ADR-0010: 統一使用攔詞虎品牌並限制吉祥物的位置

Date: 2026-08-25 | Status: accepted

## Context

專案已準備從個人開發版進入 Edge Add-ons Hidden 上架，後續再封裝為
macOS Safari Web Extension。原先的暫定名稱、`pv` 前綴與設計文件中的參考產品敘述
無法形成獨立識別，也不適合出現在商店封包。

品牌 icon 很有記憶點，但這是一個閱讀工具。吉祥物若進入卡片正文、作為背景水印
或在閒置時持續循環動畫，會跟 AI 回答搶注意力。

## Decision

- 正式中文名稱為「攔詞虎」，英文名稱為 `WordTiger`，開發者識別為 `JasonDevOps`。
- manifest、popup、options、console 標記與內部通道統一使用 WordTiger 名稱；現行程式與文件
  不保留參考產品名稱、商店 ID 或 `pv` 前綴。
- 品牌母圖只保留一份，擴充功能 icon 與商店圖從同一母圖縮放，避免不同尺寸變成不同角色。
- 閱讀卡片只在標題列放一個 28px、`opacity: .92` 的 icon。未互動時保持靜止；游標移入與
  拖曳按下提供短促回饋，AI 載入中做蹲跳循環，查詢完成、收藏或設為認得時播放一次撲抓
  與落地。`prefers-reduced-motion` 下取消位移。無標題卡片不顯示，圖片為裝飾性，
  不讓輔助技術重複朗讀。
- 卡片優先放在觸發文字的右、左、下、上空白處，同一次 AI 串流固定方向並限制正文高度；
  標題列可直接拖曳，作為自動避讓仍不合適時的退路。
- IndexedDB 改名為 `wordtiger`，資料庫 class 改為 `WordTigerDb`，JSON 匯出檔名也使用 `wordtiger-`。
  目前只有單一測試使用者，明確接受舊測試資料不搬移，因此 production code 不保留 legacy 名稱。

## Alternatives

- **只改 manifest 顯示名稱**：商店表面會改名，但 UI、log 與文件仍會暴露不一致識別。
- **大幅度把老虎放在卡片背景**：品牌更強，但降低文字對比並干擾長文回答。
- **讓 icon 眼睛、尾巴或強調線在閒置時持續動畫**：有趣，但沒有功能回饋，會浪費注意力。
- **保留舊 IndexedDB 名稱**：可繼續讀取測試資料，但與「內外名稱一致」的目標相反。
- **寫一次性搬移**：能保留測試資料，但 production code 必須長期保留 legacy 名稱與額外錯誤路徑。

## Consequences

Edge 與 Safari 封包共用同一套名稱、icon 與 UI，而閱讀卡片仍以文字為主。動畫只回應
直接互動、載入、完成或狀態變更；卡片方向固定，長回答在正文內捲動，使用者也能直接拖開。
IndexedDB 改名後第一次開啟會建立空的 `wordtiger` 資料庫，舊測試資料不會出現；
這是測試階段接受的一次性重置，正式發佈後不可用同一方式任意改名。
`icons/32.png` 必須維持在 `web_accessible_resources`，否則網頁中的 Shadow DOM 卡片無法載入它。
若未來更換品牌母圖，必須重新產生擴充功能與商店的所有尺寸，並在 16px 實際檢查辨識度。
