# ADR-0018: AI 語音由 background 產生並保留裝置 fallback

Date: 2026-08-26 | Status: accepted

## Context

單字、句子與複習題需要比裝置 TTS 更自然且一致的英文發音。API Key 不可進入 content script，
而 API 回應完成後才呼叫 `HTMLMediaElement.play()`，可能因瀏覽器自動播放政策遭拒。

## Decision

- background 使用既有 AI 設定呼叫 `/audio/speech`，固定採用 `gpt-4o-mini-tts` 與 `marin`。
- 語音指示採親切自然、略慢於日常對話且容易讓非母語者跟讀的美式英文。
- content script 在使用者操作時先啟動 `AudioContext`，收到 MP3 後再解碼播放。
- 新的朗讀會取消上一筆未完成請求與既有播放；AI 不可用時改用裝置英文語音。
- 介面明確標示 AI 語音，API Key 只由 background 使用。

## Alternatives

- **直接使用裝置 TTS**：零成本且離線，但聲線與品質依作業系統而異。
- **使用 `HTMLAudioElement`**：實作較短，但非同步 API 回應可能失去使用者播放授權。
- **使用 offscreen document**：可集中播放，但增加權限、生命週期與 Chrome 專屬程式碼。

## Consequences

發音品質與教學語速較一致，但每次 AI 朗讀都會產生 API 用量。裝置 fallback 維持基本可用性；
若未來需要長篇或即時語音，再評估串流格式，不為目前的單字與短句增加複雜度。
