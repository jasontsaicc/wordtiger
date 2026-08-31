# 先猜再揭曉：三選一延遲揭曉 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 查詞卡先出一題三選一，答對或跳過才揭曉完整定義，並把每次作答記錄成 `quizLog` 供日後檢查題目品質。

**Architecture:** 模型在 `lookup` 回應最前兩行夾帶三選一（`選項｜`／`答案｜`），`prompt.ts` 提供 `extractQuiz`（嚴格抽取）與 `stripQuiz`（無條件剝除）兩個純函式。剝除套用在四個消費 `lookupCache.payload` 的畫面，抽取只在 content script 的查詞卡使用；正解位置由畫面端洗牌，只存在 session 狀態。作答結果寫入新的 `quizLog` 表（Dexie v7 + Supabase），比照既有 `reviewLog` 的 append-only 同步模式。`guessFirst` 開關放在顯示層，不進 prompt，因此關閉時不會讓既有 lookup 快取失效。

**Tech Stack:** TypeScript、Vue 3、Dexie（IndexedDB）、Supabase（Postgres + RLS）、Vitest + fake-indexeddb + jsdom。

**Spec:** `docs/superpowers/specs/2026-08-30-guess-first-design.md`（決策一到決策六、「資料模型」、「四個剝除點」三節；決策七屬於第一批，不在本計畫範圍）

## Global Constraints

- 只做 spec 的「第二批：三選一延遲揭曉」。不碰決策七、不修改 `listReviewItems` 的語境選擇邏輯、不新增或修改 `ReviewItem.definitionSentence` 欄位。
- 不新增第四個 `PromptKind`，不新增快取表，不新增 variant 指紋。
- 三選一的對錯不影響 FSRS 排程；`recordReview`／`nextReview` 不變。
- 打老虎（`ReviewSession.vue`）本批只讓它剝除選項行，不出三選一、不接 `quizLog`。
- 分隔符號一律用全形｜（U+FF5C），不是半形 `|`。
- Dexie 新版號固定 `this.version(7).stores({ quizLog: 'id, at' })`，不需要 upgrade function。
- `guessFirst` 開關只影響顯示與作答；`SYSTEM_RULES.lookup` 一律要求出題，`stripQuiz` 一律剝除，不受開關影響。
- 不修改 `entrypoints/popup/App.vue`。
- git commit：一行 subject，不加 body、不加 `Co-Authored-By`、不加任何 AI 署名。訊息用中文，照 `git log --oneline` 既有風格（例如 `feat: 查詞卡加上三選一延遲揭曉`）。
- 每個任務完成後執行對應測試指令並確認通過，再進下一步；型別檢查用 `pnpm typecheck`。

---

## Task 1: `extractQuiz`（prompt.ts）

**Files:**
- Modify: `src/lib/prompt.ts`（新函式加在 `extractTakeaway` 之後，檔案最尾端）
- Test: `src/lib/prompt.test.ts`

**Interfaces:**
- Produces：`export interface QuizExtract { choices: [string, string, string]; right: 0 | 1 | 2; }` 與 `export function extractQuiz(text: string): QuizExtract | null`。後續 Task 3、Task 11 都依賴這個型別與函式名稱，`right` 是**原始索引**（0-based），不是畫面位置。

- [ ] **Step 1: 寫失敗測試**

在 `src/lib/prompt.test.ts` 的 `extractTakeaway` describe 區塊後面加入：

```ts
describe('extractQuiz', () => {
  it('正常時回傳選項與正確答案的原始索引', () => {
    expect(extractQuiz('選項｜掐住、扼住｜被服務端限流擋下｜主動調降發送速率\n答案｜2\n## 詞性與釋義'))
      .toEqual({ choices: ['掐住、扼住', '被服務端限流擋下', '主動調降發送速率'], right: 1 });
  });

  it('開頭空行不影響判定', () => {
    expect(extractQuiz('\n\n選項｜A｜B｜C\n答案｜1'))
      .toEqual({ choices: ['A', 'B', 'C'], right: 0 });
  });

  it('選項不是剛好三個時回 null', () => {
    expect(extractQuiz('選項｜A｜B\n答案｜1')).toBeNull();
    expect(extractQuiz('選項｜A｜B｜C｜D\n答案｜1')).toBeNull();
  });

  it('任一選項為空字串時回 null', () => {
    expect(extractQuiz('選項｜A｜｜C\n答案｜1')).toBeNull();
  });

  it('選項有重複時回 null', () => {
    expect(extractQuiz('選項｜A｜A｜B\n答案｜1')).toBeNull();
  });

  it('答案越界時回 null', () => {
    expect(extractQuiz('選項｜A｜B｜C\n答案｜0')).toBeNull();
    expect(extractQuiz('選項｜A｜B｜C\n答案｜4')).toBeNull();
  });

  it('缺少選項行或答案行時回 null', () => {
    expect(extractQuiz('選項｜A｜B｜C')).toBeNull();
    expect(extractQuiz('答案｜1')).toBeNull();
  });

  it('選項行不在開頭時視為內容,不算出題', () => {
    expect(extractQuiz('## 本句用法\n選項｜A｜B｜C\n答案｜1')).toBeNull();
  });

  it('舊 payload 沒有選項行時回 null', () => {
    expect(extractQuiz('## 詞性與釋義\n- 部署')).toBeNull();
  });
});
```

同時把檔案頂端的 import 改成：

```ts
import { renderTemplate, extractTakeaway, extractQuiz, DEFAULT_TEMPLATES, SYSTEM_RULES } from './prompt';
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm vitest run src/lib/prompt.test.ts -t "extractQuiz"`
Expected: FAIL，因為 `extractQuiz` 尚未定義（`prompt.ts` 沒有匯出這個名字）。

- [ ] **Step 3: 實作 `extractQuiz`**

在 `src/lib/prompt.ts` 檔案最尾端（`extractTakeaway` 函式之後）加入：

```ts
export interface QuizExtract {
  choices: [string, string, string];
  right: 0 | 1 | 2;
}

/**
 * 只認回應開頭兩行的選項與答案；任一條件不成立就回 null，寧可不出題。
 * `right` 是選項在原始順序裡的索引（0-based），畫面洗牌後的位置由呼叫端另外算。
 */
export function extractQuiz(text: string): QuizExtract | null {
  const lines = text.split(/\r?\n/);
  let start = 0;
  while (start < lines.length && lines[start]!.trim() === '') start++;

  const optionLine = lines[start]?.trim();
  const answerLine = lines[start + 1]?.trim();
  if (!optionLine?.startsWith('選項｜') || !answerLine?.startsWith('答案｜')) return null;

  const choices = optionLine.slice('選項｜'.length).split('｜').map((s) => s.trim());
  if (choices.length !== 3 || choices.some((c) => !c)) return null;
  if (new Set(choices).size !== 3) return null;

  const answer = Number(answerLine.slice('答案｜'.length).trim());
  if (!Number.isInteger(answer) || answer < 1 || answer > 3) return null;

  return { choices: choices as [string, string, string], right: (answer - 1) as 0 | 1 | 2 };
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `pnpm vitest run src/lib/prompt.test.ts -t "extractQuiz"`
Expected: PASS，全部 9 個案例通過。

- [ ] **Step 5: Commit**

```bash
git add src/lib/prompt.ts src/lib/prompt.test.ts
git commit -m "feat: 新增 extractQuiz 抽取查詞卡的三選一"
```

---

## Task 2: `stripQuiz`（prompt.ts）

**Files:**
- Modify: `src/lib/prompt.ts`
- Test: `src/lib/prompt.test.ts`

**Interfaces:**
- Consumes：無（純函式，不依賴 Task 1）。
- Produces：`export function stripQuiz(text: string): string`。Task 4、Task 11、`ReviewSession.vue`、`WordLibrary.vue` 都會呼叫這個函式。

- [ ] **Step 1: 寫失敗測試**

在 `src/lib/prompt.test.ts` 加入（放在 `extractQuiz` describe 之後）：

```ts
describe('stripQuiz', () => {
  it('選項與答案都在開頭時整份剝除', () => {
    expect(stripQuiz('選項｜A｜B｜C\n答案｜1\n## 詞性與釋義\n- 部署'))
      .toBe('## 詞性與釋義\n- 部署');
  });

  it('沒有選項行時原樣回傳', () => {
    const text = '## 詞性與釋義\n- 部署';
    expect(stripQuiz(text)).toBe(text);
  });

  it('只有選項行沒有答案行時仍要剝除,避免壞題漏到畫面上', () => {
    expect(stripQuiz('選項｜A｜B｜C\n## 詞性與釋義')).toBe('## 詞性與釋義');
  });

  it('選項行出現在正文中間時不誤刪', () => {
    const text = '## 本句用法\n選項｜A｜B｜C\n答案｜1';
    expect(stripQuiz(text)).toBe(text);
  });
});
```

import 改成：

```ts
import { renderTemplate, extractTakeaway, extractQuiz, stripQuiz, DEFAULT_TEMPLATES, SYSTEM_RULES } from './prompt';
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm vitest run src/lib/prompt.test.ts -t "stripQuiz"`
Expected: FAIL，`stripQuiz` 尚未定義。

- [ ] **Step 3: 實作 `stripQuiz`**

在 `src/lib/prompt.ts` 的 `extractQuiz` 之後加入：

```ts
/**
 * 無條件剝除開頭的選項／答案行，不管抽取有沒有成功。
 * 模型只吐了選項沒吐答案時，extractQuiz 會回 null，但那行仍必須剝掉，
 * 否則壞題直接印在卡片上。只認開頭的行，正文中間的同名行視為內容不動它。
 */
export function stripQuiz(text: string): string {
  const lines = text.split(/\r?\n/);
  let start = 0;
  while (start < lines.length && lines[start]!.trim() === '') start++;

  let end = start;
  if (lines[end]?.trim().startsWith('選項｜')) end++;
  if (lines[end]?.trim().startsWith('答案｜')) end++;
  if (end === start) return text;

  return lines.slice(end).join('\n');
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `pnpm vitest run src/lib/prompt.test.ts -t "stripQuiz"`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/prompt.ts src/lib/prompt.test.ts
git commit -m "feat: 新增 stripQuiz 無條件剝除查詞卡的三選一"
```

---

## Task 3: `SYSTEM_RULES.lookup` 的出題規則（prompt.ts）

**Files:**
- Modify: `src/lib/prompt.ts:11-18`
- Test: `src/lib/prompt.test.ts`

**Interfaces:**
- Consumes：無。
- Produces：`SYSTEM_RULES.lookup` 字串內容變更。`src/lib/messages.ts` 的 `lookupVariant` 已經把 `SYSTEM_RULES.lookup` 算進快取指紋，這個改動會讓既有 lookup 快取全數失效（spec 接受的代價，不用額外處理）。

- [ ] **Step 1: 寫失敗測試（防止規則被誤刪）**

在 `src/lib/prompt.test.ts` 加入（放在 `DEFAULT_TEMPLATES` describe 附近即可）：

```ts
describe('SYSTEM_RULES.lookup 的出題規則', () => {
  it('要求輸出選項與答案兩行,並帶反例避免義項型出題', () => {
    expect(SYSTEM_RULES.lookup).toContain('選項｜');
    expect(SYSTEM_RULES.lookup).toContain('答案｜');
    expect(SYSTEM_RULES.lookup).toContain('throttled');
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm vitest run src/lib/prompt.test.ts -t "出題規則"`
Expected: FAIL，目前 `SYSTEM_RULES.lookup` 沒有這些字串。

- [ ] **Step 3: 修改 `SYSTEM_RULES.lookup`**

把 `src/lib/prompt.ts:11-18` 的內容：

```ts
  lookup: [
    '用繁體中文回答。',
    '直接輸出內容本身,不要開場白、不要結語、不要說明你要做什麼。',
    '不要用 ``` 把整份回應包起來。',
    '支援的排版只有:## 標題、- 清單、**粗體**、`行內程式碼`。不要用表格。',
    '查詢項目是多字片語或含 + 的句型時,不要列 KK 音標和詞性；改用 ## 核心意思、## 結構與限制、## 使用場景、## 例句,確有需要再加 ## 常見錯誤。',
    '片語的使用場景要說清楚何時自然、正式或口語語域、常見搭配與不適用情況。',
  ].join('\n'),
```

改成：

```ts
  lookup: [
    '用繁體中文回答。',
    '直接輸出內容本身,不要開場白、不要結語、不要說明你要做什麼。',
    '不要用 ``` 把整份回應包起來。',
    '回應的第一、二行固定輸出三選一小題,格式:',
    '選項｜干擾項A｜干擾項B｜干擾項C',
    '答案｜正確選項是第幾個(1-3)',
    '三個選項必須互相推不出來:知道其中任一個,都不能推得出另外兩個。',
    '字義本身猜得到、但語態、施事者或範圍容易讀錯時,問「這句在說誰對誰做了什麼」。',
    '一般義與技術義真的無關時,才問「這個字在這句是哪一個意思」。',
    '每個干擾項要對應一個真實誤讀,不放明顯錯誤來湊數。',
    '三個選項的長度、詞性與具體程度要接近。',
    '反例:throttled 不可用義項型出題,因為「掐住」直接推得出「被限流擋下」。',
    '支援的排版只有:## 標題、- 清單、**粗體**、`行內程式碼`。不要用表格。',
    '查詢項目是多字片語或含 + 的句型時,不要列 KK 音標和詞性；改用 ## 核心意思、## 結構與限制、## 使用場景、## 例句,確有需要再加 ## 常見錯誤。三選一規則不因為是片語而改變,出題單位是查詢項目在出處句裡的意思。',
    '片語的使用場景要說清楚何時自然、正式或口語語域、常見搭配與不適用情況。',
  ].join('\n'),
```

- [ ] **Step 4: 執行測試確認通過**

Run: `pnpm vitest run src/lib/prompt.test.ts`
Expected: PASS，整個檔案（含前兩個 Task 的測試）全部通過。

- [ ] **Step 5: Commit**

```bash
git add src/lib/prompt.ts src/lib/prompt.test.ts
git commit -m "feat: SYSTEM_RULES.lookup 要求輸出三選一小題"
```

---

## Task 4: 四個剝除點（highlight.content.ts、ReviewSession.vue、WordLibrary.vue）

**Files:**
- Modify: `entrypoints/highlight.content.ts:6, 149-195`
- Modify: `entrypoints/options/ReviewSession.vue:2-4, 127`
- Modify: `entrypoints/options/WordLibrary.vue:2-5, 268`
- Test: `src/content/highlight-content.test.ts`

**Interfaces:**
- Consumes：`stripQuiz` from `src/lib/prompt.ts`（Task 2）。
- Produces：`currentDefinition`（`highlight.content.ts` 內的 module 變數）從此永遠是**剝除後**的文字，Task 11 會延續這個不變式。

**注意：** 這個任務只做剝除，不接三選一 UI（Task 11 才接）。`runLookup` 的 `onText` 回呼是串流每一幀的渲染點，最容易漏掉剝除。

- [ ] **Step 1: 寫失敗測試（highlight.content.ts 的串流剝除）**

在 `src/content/highlight-content.test.ts` 的 `describe('highlight content 快捷鍵', ...)` 區塊內，既有的 `it('查詞後按 X 再按 Space 仍保留定義', ...)` 之後加入：

```ts
  it('串流與結果都會剝除選項與答案行,不外流到畫面上', async () => {
    const listeners: Array<(event: any) => void> = [];
    vi.spyOn(fakeBrowser.runtime, 'connect').mockReturnValue({
      onMessage: { addListener: (listener: (event: any) => void) => listeners.push(listener) },
      onDisconnect: { addListener: vi.fn() },
      postMessage: () => queueMicrotask(() => {
        listeners.forEach((listener) => listener({
          type: 'delta', delta: '選項｜A｜B｜C\n答案｜1\n忙翻',
        }));
        listeners.forEach((listener) => listener({
          type: 'done', result: { ok: true, text: '選項｜A｜B｜C\n答案｜1\n忙翻' },
        }));
      }),
      disconnect: vi.fn(),
    } as any);

    await contentScript.main(new ContentScriptContext('test'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));

    await vi.waitFor(() => expect(card.body).toBe('忙翻'));
    expect(card.body).not.toContain('選項｜');
  });
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm vitest run src/content/highlight-content.test.ts -t "串流與結果都會剝除"`
Expected: FAIL，`card.body` 會是 `'選項｜A｜B｜C\n答案｜1\n忙翻'`。

- [ ] **Step 3: 修改 `highlight.content.ts`**

第 6 行的 import：

```ts
import { extractTakeaway } from '@/src/lib/prompt';
```

改成：

```ts
import { extractTakeaway, stripQuiz } from '@/src/lib/prompt';
```

`runLookup` 內（149-195 行）的串流回呼，把：

```ts
      }, (body) => {
        if (seq === explainSeq) {
          currentDefinition = body;
          showCard({
            title: wordTitle(hover), body, rect: hover.rect,
            hint, marked, loading: true, onClose: closeAiCard, onRetry: retry(previous),
          });
        }
      });
```

改成：

```ts
      }, (body) => {
        if (seq === explainSeq) {
          currentDefinition = stripQuiz(body);
          showCard({
            title: wordTitle(hover), body: currentDefinition, rect: hover.rect,
            hint, marked, loading: true, onClose: closeAiCard, onRetry: retry(previous),
          });
        }
      });
```

成功分支，把：

```ts
      if (result?.ok) {
        currentDefinition = result.text;
        showCard({
          title: wordTitle(hover), body: result.text, rect: hover.rect,
          hint, marked, onClose: closeAiCard, onRetry: retry(result.text),
        });
        return;
      }
```

改成：

```ts
      if (result?.ok) {
        currentDefinition = stripQuiz(result.text);
        showCard({
          title: wordTitle(hover), body: currentDefinition, rect: hover.rect,
          hint, marked, onClose: closeAiCard, onRetry: retry(currentDefinition),
        });
        return;
      }
```

（`onRetry` 改傳剝除後的 `currentDefinition`，否則重試失敗時的 fallback 文字會帶著選項行閃一下。）

- [ ] **Step 4: 執行測試確認通過**

Run: `pnpm vitest run src/content/highlight-content.test.ts`
Expected: PASS，含既有的「查詞後按 X 再按 Space 仍保留定義」測試。

- [ ] **Step 5: 修改 `ReviewSession.vue`**

第 3 行 import：

```ts
import { renderMarkdown } from '@/src/content/markdown';
```

改成：

```ts
import { renderMarkdown } from '@/src/content/markdown';
import { stripQuiz } from '@/src/lib/prompt';
```

第 127 行：

```html
        <div v-html="renderMarkdown(item.definition)" />
```

改成：

```html
        <div v-html="renderMarkdown(stripQuiz(item.definition))" />
```

- [ ] **Step 6: 修改 `WordLibrary.vue`**

第 3 行 import：

```ts
import { renderMarkdown } from '@/src/content/markdown';
```

改成：

```ts
import { renderMarkdown } from '@/src/content/markdown';
import { stripQuiz } from '@/src/lib/prompt';
```

第 268 行：

```html
              <div v-html="renderMarkdown(dictionaries[w.word]!.payload)" />
```

改成：

```html
              <div v-html="renderMarkdown(stripQuiz(dictionaries[w.word]!.payload))" />
```

這兩個 Vue 檔案沒有既有的元件測試（repo 目前沒有 `@vue/test-utils` 設定），用型別檢查與 build 驗證。

- [ ] **Step 7: 型別檢查與全測試**

Run: `pnpm typecheck`
Expected: 無錯誤。

Run: `pnpm test`
Expected: 全部通過。

- [ ] **Step 8: Commit**

```bash
git add entrypoints/highlight.content.ts entrypoints/options/ReviewSession.vue entrypoints/options/WordLibrary.vue src/content/highlight-content.test.ts
git commit -m "feat: 四個查詞卡消費點都剝除三選一選項行"
```

---

## Task 5: `quizLog` 資料表（db.ts）

**Files:**
- Modify: `src/lib/db.ts`
- Test: `src/lib/db.test.ts`

**Interfaces:**
- Consumes：無。
- Produces：
  - `export interface QuizLogRow { id: string; word: string; picked: 0 | 1 | 2; right: 0 | 1 | 2; choices: [string, string, string]; at: number; pending?: 0 | 1; }`
  - `export async function recordQuiz(word: string, picked: 0 | 1 | 2, right: 0 | 1 | 2, choices: [string, string, string], now = Date.now()): Promise<void>`
  - `export function listQuizLog(): Promise<QuizLogRow[]>`
  - `db.quizLog: Table<QuizLogRow, string>`

  Task 6（schema.sql）、Task 7（sync.ts）、Task 8（messages.ts）、Task 11（content script）都依賴這些名字與型別，欄位名稱 `picked`／`right`／`choices`／`at` 不可改動。

- [ ] **Step 1: 寫失敗測試**

在 `src/lib/db.test.ts` 的 import 加上 `recordQuiz, listQuizLog, type QuizLogRow`：

```ts
import { db, markWord, unmarkWord, deleteWord, loadMarks, addContext, listContexts, listReviewItems, listReviewLog, inferCollectedAt, masterWord, recordReview, recordQuiz, listQuizLog, putCached, deleteCached, sentenceKey, getSentence, putSentence, type WordRow, type QuizLogRow } from './db';
```

`beforeEach` 加一行清表：

```ts
beforeEach(async () => {
  await db.words.clear();
  await db.contexts.clear();
  await db.lookupCache.clear();
  await db.sentenceCache.clear();
  await db.reviewLog.clear();
  await db.quizLog.clear();
  vi.restoreAllMocks();
});
```

在檔案最尾端加入：

```ts
describe('quizLog', () => {
  it('寫入後讀得到', async () => {
    await recordQuiz('throttled', 1, 1, ['掐住、扼住', '被服務端限流擋下', '主動調降發送速率'], 100);
    expect(await listQuizLog()).toMatchObject([
      { word: 'throttled', picked: 1, right: 1, choices: ['掐住、扼住', '被服務端限流擋下', '主動調降發送速率'] },
    ]);
  });

  it('每筆用 uuid 當主鍵,同一個字可以留下多筆', async () => {
    await recordQuiz('slam', 0, 2, ['忙翻', '被投訴', '被裁員'], 10);
    await recordQuiz('slam', 2, 2, ['忙翻', '被投訴', '被裁員'], 20);
    const log = await listQuizLog();
    expect(log).toHaveLength(2);
    expect(new Set(log.map((row) => row.id)).size).toBe(2);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm vitest run src/lib/db.test.ts -t "quizLog"`
Expected: FAIL，`recordQuiz`／`listQuizLog` 尚未定義，且 `db.quizLog` 表不存在。

- [ ] **Step 3: 實作**

在 `src/lib/db.ts` 的 `ReviewLogRow` interface（69-77 行）之後加入：

```ts
/** 查詞時三選一的逐次結果。只新增不修改，因此用 uuid 主鍵就能跨裝置合併。 */
export interface QuizLogRow {
  id: string;
  word: string;
  /** 洗牌前的原始索引。 */
  picked: 0 | 1 | 2;
  right: 0 | 1 | 2;
  /** 供日後回頭檢查題目品質。 */
  choices: [string, string, string];
  at: number;
  /** 本機改動尚未被雲端確認；舊資料缺少此欄時也視為待同步。 */
  pending?: 0 | 1;
}
```

`WordTigerDb` class（96-141 行）的欄位宣告加一行：

```ts
class WordTigerDb extends Dexie {
  words!: Table<WordRow, string>;
  contexts!: Table<ContextRow, string>;
  lookupCache!: Table<CacheRow, string>;
  sentenceCache!: Table<SentenceRow, string>;
  reviewLog!: Table<ReviewLogRow, string>;
  quizLog!: Table<QuizLogRow, string>;
```

constructor 最後（`this.version(6).upgrade(...)` 之後）加一版：

```ts
    this.version(7).stores({
      quizLog: 'id, at',
    });
```

在 `listReviewLog` 函式（332-335 行）之後加入：

```ts
/** 查詞三選一的逐次紀錄，只新增不修改。 */
export async function recordQuiz(
  word: string,
  picked: 0 | 1 | 2,
  right: 0 | 1 | 2,
  choices: [string, string, string],
  now = Date.now(),
): Promise<void> {
  await db.quizLog.add({ id: crypto.randomUUID(), word, picked, right, choices, at: now, pending: 1 });
}

/** 由舊到新。 */
export function listQuizLog(): Promise<QuizLogRow[]> {
  return db.quizLog.orderBy('at').toArray();
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `pnpm vitest run src/lib/db.test.ts`
Expected: PASS，整個檔案都通過（Dexie migration chain 不影響既有測試，因為新版只加表不改既有表）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.ts src/lib/db.test.ts
git commit -m "feat: 新增 quizLog 表記錄查詞三選一的作答"
```

---

## Task 6: `quiz_log`（supabase/schema.sql）

**Files:**
- Modify: `supabase/schema.sql`

**Interfaces:**
- Consumes：無。
- Produces：Supabase 資料表 `public.quiz_log`，欄位 `id, user_id, word, picked, right_choice, choices, at, updated_at`。Task 7 的 `RemoteQuizLog` 型別要跟這裡的欄位名稱逐一對應。

**注意：** `right` 是 PostgreSQL 保留字（`RIGHT JOIN`），欄位改叫 `right_choice`，對應到 TS 端的 `QuizLogRow.right`（Task 7 的 mapper 負責轉換，TS 端欄位名不變）。這張表沒有部署過，不用抄 `review_log` 那段 `drop constraint / add primary key` 補救碼，直接在 `create table` 寫複合主鍵。這個檔案沒有自動化測試，靠人工比對 `review_log` 區塊確認結構一致。

- [ ] **Step 1: 在 `review_log` 的 RLS policy 之後加入新表**

在 `supabase/schema.sql` 第 117 行（`-- own review log` policy 結束）之後，`sync_clock` function 定義（119 行）之前，插入：

```sql
-- 查詞時的三選一逐次結果，只新增不修改，所以沒有 deleted_at，也不掛 updated_at trigger：
-- updated_at 停在寫入時間，重送同一列時不會被重新 pull 回來。
-- right 是 PostgreSQL 保留字，欄位改叫 right_choice。
create table if not exists public.quiz_log (
  id uuid not null,
  user_id uuid references auth.users on delete cascade not null,
  word text not null,
  picked smallint not null check (picked between 0 and 2),
  right_choice smallint not null check (right_choice between 0 and 2),
  choices jsonb not null,
  at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.quiz_log enable row level security;

drop policy if exists "own quiz log" on public.quiz_log;
create policy "own quiz log" on public.quiz_log for all to authenticated
using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

- [ ] **Step 2: 人工比對**

對照 `public.review_log` 的區塊（43-53 行）與 `own review log` policy（115-117 行），確認新區塊的結構一致：複合主鍵、沒有 `deleted_at`、沒有 `updated_at` trigger、RLS policy 用同樣的 `auth.uid() = user_id` 條件。

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat: 新增 quiz_log 資料表"
```

---

## Task 7: 同步 `quizLog`（sync.ts）

**Files:**
- Modify: `src/lib/sync.ts`
- Test: `src/lib/sync.test.ts`

**Interfaces:**
- Consumes：`QuizLogRow` from `src/lib/db.ts`（Task 5）；`quiz_log` 資料表結構（Task 6）。
- Produces：`sync.ts` 內部的 `RemoteQuizLog` 型別、`localQuizLog`／`remoteQuizLog` mapper（不匯出，跟既有的 `localReviewLog`／`remoteReviewLog` 一樣是模組內函式）。`performSync` 的 `pulled`／`pushed` 計數把 quizLog 算進去。

**注意（陷阱）：** `pull()` 對每張表一定會發一次 fetch（即使結果是空陣列），`push()` 只有在有 pending 列時才會發 fetch。這個任務新增一個一定會發生的 `pull` 呼叫，會讓 `sync.test.ts` 裡所有既有的 `syncNow` 測試的 `fetchMock.mock.calls[N]` 索引往後多一格（因為 quiz_log 的 pull 排在 review_log 的 pull 之後、所有 push 之前）。必須同步修正這些既有測試，否則它們會炸開。

- [ ] **Step 1: 修改 `sync.ts` 的型別與 mapper**

第 1 行 import 加上 `QuizLogRow`：

```ts
import { db, type CacheRow, type ContextRow, type QuizLogRow, type ReviewLogRow, type WordRow } from './db';
```

`RemoteReviewLog` 型別（65-71 行）之後加入：

```ts
type RemoteQuizLog = {
  id: string;
  user_id: string;
  word: string;
  picked: number;
  right_choice: number;
  choices: [string, string, string];
  at: string;
};
```

`localReviewLog` 函式（260-268 行）之後加入：

```ts
function localQuizLog(row: RemoteQuizLog): QuizLogRow {
  return {
    id: row.id,
    word: row.word,
    picked: row.picked as 0 | 1 | 2,
    right: row.right_choice as 0 | 1 | 2,
    choices: row.choices,
    at: Date.parse(row.at),
    pending: 0,
  };
}
```

`remoteReviewLog` 函式（335-343 行）之後加入：

```ts
function remoteQuizLog(row: QuizLogRow, userId: string) {
  return {
    id: row.id,
    user_id: userId,
    word: row.word,
    picked: row.picked,
    right_choice: row.right,
    choices: row.choices,
    at: iso(row.at),
  };
}
```

- [ ] **Step 2: `signIn` 換帳號區塊補上 quizLog**

第 144-152 行的：

```ts
  if (changedAccount) {
    await Promise.all([
      db.words.toCollection().modify({ pending: 1 }),
      db.contexts.toCollection().modify({ pending: 1 }),
      db.reviewLog.toCollection().modify({ pending: 1 }),
      // 切換帳號時不將原帳號 cache 上傳至新帳號。
      db.lookupCache.toCollection().modify({ pending: 0 }),
    ]);
  }
```

改成：

```ts
  if (changedAccount) {
    await Promise.all([
      db.words.toCollection().modify({ pending: 1 }),
      db.contexts.toCollection().modify({ pending: 1 }),
      db.reviewLog.toCollection().modify({ pending: 1 }),
      db.quizLog.toCollection().modify({ pending: 1 }),
      // 切換帳號時不將原帳號 cache 上傳至新帳號。
      db.lookupCache.toCollection().modify({ pending: 0 }),
    ]);
  }
```

- [ ] **Step 3: `performSync` 的 pull／merge／push／acknowledge 四段都加上 quizLog**

把整個 `performSync` 函式（431-518 行）換成：

```ts
async function performSync(): Promise<SyncResult> {
  const stored = await load();
  try {
    const active = await session(stored);
    const cutoff = await request<string>(stored, active, 'rpc/sync_clock', {
      method: 'POST', body: '{}',
    });
    const [remoteWords, remoteContexts, remoteLookupCaches, remoteReviewLogs, remoteQuizLogs] =
      await Promise.all([
        pull<RemoteWord>(stored, active, 'words', cutoff),
        pull<RemoteContext>(stored, active, 'contexts', cutoff),
        pull<RemoteLookupCache>(stored, active, 'lookup_cache', cutoff),
        pull<RemoteReviewLog>(stored, active, 'review_log', cutoff),
        pull<RemoteQuizLog>(stored, active, 'quiz_log', cutoff),
      ]);

    await db.transaction(
      'rw', db.words, db.contexts, db.lookupCache, db.reviewLog, db.quizLog, async () => {
        for (const row of remoteWords) {
          const remote = localWord(row);
          const local = await db.words.get(remote.word);
          await db.words.put(mergeCollectedAt(local, remote, resolveRow(local, remote)));
        }
        for (const row of remoteContexts) {
          const remote = localContext(row);
          await db.contexts.put(resolveRow(await db.contexts.get(remote.id), remote));
        }
        for (const row of remoteLookupCaches) {
          const remote = localLookupCache(row);
          const local = await db.lookupCache.get(remote.word);
          await db.lookupCache.put(preserveLocalLookupMetadata(local, resolveRow(local, remote)));
        }
        // 成績只新增不修改，同一個 id 兩邊內容一定相同，不需要衝突解析。
        for (const row of remoteReviewLogs) await db.reviewLog.put(localReviewLog(row));
        for (const row of remoteQuizLogs) await db.quizLog.put(localQuizLog(row));
      },
    );

    const [pendingWords, pendingContexts, pendingLookupCaches, pendingReviewLogs, pendingQuizLogs] =
      await Promise.all([
        db.words.filter((row) => row.pending !== 0).toArray(),
        db.contexts.filter((row) => row.pending !== 0).toArray(),
        db.lookupCache.filter((row) => row.pending !== 0).toArray(),
        db.reviewLog.filter((row) => row.pending !== 0).toArray(),
        db.quizLog.filter((row) => row.pending !== 0).toArray(),
      ]);
    const [savedWords, savedContexts, savedLookupCaches, savedReviewLogs, savedQuizLogs] =
      await Promise.all([
        push<RemoteWord>(stored, active, 'words', 'user_id,word',
          pendingWords.map((row) => remoteWord(row, active.userId))),
        push<RemoteContext>(stored, active, 'contexts', 'user_id,id',
          pendingContexts.map((row) => remoteContext(row, active.userId))),
        push<RemoteLookupCache>(stored, active, 'lookup_cache', 'user_id,word',
          pendingLookupCaches.map((row) => remoteLookupCache(row, active.userId))),
        push<RemoteReviewLog>(stored, active, 'review_log', 'user_id,id',
          pendingReviewLogs.map((row) => remoteReviewLog(row, active.userId))),
        push<RemoteQuizLog>(stored, active, 'quiz_log', 'user_id,id',
          pendingQuizLogs.map((row) => remoteQuizLog(row, active.userId))),
      ]);
    const sentWords = new Map(pendingWords.map((row) => [row.word, row]));
    const sentContexts = new Map(pendingContexts.map((row) => [row.id, row]));
    const sentLookupCaches = new Map(pendingLookupCaches.map((row) => [row.word, row]));
    await db.transaction(
      'rw', db.words, db.contexts, db.lookupCache, db.reviewLog, db.quizLog, async () => {
        for (const row of savedWords.map(localWord)) {
          await db.words.put(acknowledgeRow(
            await db.words.get(row.word), sentWords.get(row.word), row,
          ));
        }
        for (const row of savedContexts.map(localContext)) {
          await db.contexts.put(acknowledgeRow(
            await db.contexts.get(row.id), sentContexts.get(row.id), row,
          ));
        }
        for (const row of savedLookupCaches.map(localLookupCache)) {
          const current = await db.lookupCache.get(row.word);
          await db.lookupCache.put(preserveLocalLookupMetadata(current, acknowledgeRow(
            current, sentLookupCaches.get(row.word), row,
          )));
        }
        for (const row of savedReviewLogs.map(localReviewLog)) await db.reviewLog.put(row);
        for (const row of savedQuizLogs.map(localQuizLog)) await db.quizLog.put(row);
      },
    );

    const finishedAt = Date.now();
    delete stored.lastError;
    await save({ ...stored, session: active, cursor: Date.parse(cutoff), lastSuccessAt: finishedAt });
    return {
      pulled: remoteWords.length + remoteContexts.length
        + remoteLookupCaches.length + remoteReviewLogs.length + remoteQuizLogs.length,
      pushed: savedWords.length + savedContexts.length
        + savedLookupCaches.length + savedReviewLogs.length + savedQuizLogs.length,
      finishedAt,
    };
  } catch (error) {
    await save({ ...stored, lastError: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
```

- [ ] **Step 4: `pnpm typecheck` 確認編譯通過**

Run: `pnpm typecheck`
Expected: 無錯誤（此時測試還沒改，會炸，先只看型別）。

- [ ] **Step 5: 修正 `sync.test.ts` 的 `beforeEach`**

第 13-20 行加一行清表：

```ts
beforeEach(async () => {
  fakeBrowser.reset();
  await db.words.clear();
  await db.contexts.clear();
  await db.lookupCache.clear();
  await db.reviewLog.clear();
  await db.quizLog.clear();
  vi.restoreAllMocks();
});
```

- [ ] **Step 6: 在既有 4 個 `syncNow` 測試裡插入 quiz_log 的 pull mock，並修正索引**

**測試「登入後拉回 tombstone 並只推送本機待同步列」（87-135 行）：** 把 112-121 行的：

```ts
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([{
        user_id: 'user-1', word: 'local', status: 'unknown',
        created_at: '1970-01-01T00:00:00.030Z',
        collected_at: '1970-01-01T00:00:00.035Z',
        updated_at: '1970-01-01T00:00:00.040Z', deleted_at: null,
        review_step: 2, review_due_at: '1970-01-01T00:00:00.050Z',
      }]));
```

改成（在 pull review_log 之後、push words 之前插入一個空陣列的 quiz_log pull）：

```ts
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([{
        user_id: 'user-1', word: 'local', status: 'unknown',
        created_at: '1970-01-01T00:00:00.030Z',
        collected_at: '1970-01-01T00:00:00.035Z',
        updated_at: '1970-01-01T00:00:00.040Z', deleted_at: null,
        review_step: 2, review_due_at: '1970-01-01T00:00:00.050Z',
      }]));
```

第 131-134 行的三個 `fetchMock.mock.calls[6]!` 改成 `fetchMock.mock.calls[7]!`。

**測試「FSRS 卡片整組往返 Supabase，沒有卡片的列明確送出 null」（137-191 行）：** 同樣在 164-166 行（三個空陣列 pull mock）之後再插入一個 `.mockResolvedValueOnce(response([]))`，即把：

```ts
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([
```

改成：

```ts
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([
```

第 187 行 `fetchMock.mock.calls[6]!` 改成 `fetchMock.mock.calls[7]!`。

**測試「同一帳號會拉回別台裝置的詞典 cache 並推送本機 cache」（193-237 行）：** 219-223 行的：

```ts
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([remote]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([saved]));
```

改成：

```ts
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([remote]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([saved]));
```

第 233-236 行的四個 `fetchMock.mock.calls[6]!` 改成 `fetchMock.mock.calls[7]!`。

**測試「遠端還沒回填時，不會用 null 蓋掉本機的 collectedAt」（239-278 行）：** 262-270 行的：

```ts
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([{
        user_id: 'user-1', word: 'deploy', status: 'unknown',
        created_at: '1970-01-01T00:00:00.010Z',
        collected_at: '1970-01-01T00:00:00.010Z',
        updated_at: '1970-01-01T00:00:00.030Z', deleted_at: null,
      }]));
```

改成：

```ts
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([{
        user_id: 'user-1', word: 'deploy', status: 'unknown',
        created_at: '1970-01-01T00:00:00.010Z',
        collected_at: '1970-01-01T00:00:00.010Z',
        updated_at: '1970-01-01T00:00:00.030Z', deleted_at: null,
      }]));
```

第 276 行 `fetchMock.mock.calls[6]!` 改成 `fetchMock.mock.calls[7]!`。

- [ ] **Step 7: 修正「切換不同帳號時不會把舊帳號 cache 標成待上傳」測試，補上 quizLog 斷言**

第 280-299 行的測試不呼叫 `syncNow`，不受索引位移影響，但要補上 `signIn` 換帳號時 `quizLog` 也要重新標成待推送的斷言（Task 7 Step 2 的行為）。把：

```ts
    await signIn('https://project.supabase.co', 'anon', 'one@example.com', 'password');
    await putCached([{ word: 'private', payload: '舊帳號內容' }]);
    await db.reviewLog.add({ id: 'log-1', word: 'deploy', remembered: true, at: 10, pending: 0 });
    await signIn('https://project.supabase.co', 'anon', 'two@example.com', 'password');
    expect((await db.lookupCache.get('private'))!.pending).toBe(0);
    // 打老虎成績屬於學習歷程，跟著人走，切換帳號要重新上傳。
    expect((await db.reviewLog.get('log-1'))!.pending).toBe(1);
  });
```

改成：

```ts
    await signIn('https://project.supabase.co', 'anon', 'one@example.com', 'password');
    await putCached([{ word: 'private', payload: '舊帳號內容' }]);
    await db.reviewLog.add({ id: 'log-1', word: 'deploy', remembered: true, at: 10, pending: 0 });
    await db.quizLog.add({
      id: 'quiz-1', word: 'deploy', picked: 0, right: 0,
      choices: ['甲', '乙', '丙'], at: 10, pending: 0,
    });
    await signIn('https://project.supabase.co', 'anon', 'two@example.com', 'password');
    expect((await db.lookupCache.get('private'))!.pending).toBe(0);
    // 打老虎成績屬於學習歷程，跟著人走，切換帳號要重新上傳。
    expect((await db.reviewLog.get('log-1'))!.pending).toBe(1);
    expect((await db.quizLog.get('quiz-1'))!.pending).toBe(1);
  });
```

- [ ] **Step 8: 修正「打老虎成績會拉回別台裝置的紀錄」測試的索引**

第 301-353 行，326-329 行的：

```ts
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([remote]))
```

改成：

```ts
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([remote]))
      .mockResolvedValueOnce(response([]))
```

第 348-352 行：

```ts
    expect(fetchMock.mock.calls[7]![1]?.body).toContain('"remembered":true');
    expect(fetchMock.mock.calls[7]![1]?.body).toContain('"id":"local-1"');
    // 主鍵只有 id 時，換帳號重傳會撞到別的帳號的列而被 RLS 擋下。
    expect(fetchMock.mock.calls[6]![0]).toContain('contexts?on_conflict=user_id%2Cid');
    expect(fetchMock.mock.calls[7]![0]).toContain('review_log?on_conflict=user_id%2Cid');
```

改成：

```ts
    expect(fetchMock.mock.calls[8]![1]?.body).toContain('"remembered":true');
    expect(fetchMock.mock.calls[8]![1]?.body).toContain('"id":"local-1"');
    // 主鍵只有 id 時，換帳號重傳會撞到別的帳號的列而被 RLS 擋下。
    expect(fetchMock.mock.calls[7]![0]).toContain('contexts?on_conflict=user_id%2Cid');
    expect(fetchMock.mock.calls[8]![0]).toContain('review_log?on_conflict=user_id%2Cid');
```

- [ ] **Step 9: 新增 quizLog 自己的同步測試**

在 `describe('syncNow', ...)` 區塊最後（Step 8 修正的測試之後、`});` 收尾之前）加入：

```ts
  it('quizLog 會拉回別台裝置的紀錄，並用複合主鍵推送本機紀錄', async () => {
    await db.quizLog.add({
      id: 'local-quiz-1', word: 'throttled', picked: 1, right: 1,
      choices: ['掐住、扼住', '被服務端限流擋下', '主動調降發送速率'], at: 30, pending: 1,
    });
    const response = (body: unknown) => ({
      ok: true, status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response);
    const remote = {
      id: 'remote-quiz-1', user_id: 'user-1', word: 'slammed',
      picked: 0, right_choice: 2, choices: ['忙翻', '被投訴', '被裁員'],
      at: '1970-01-01T00:00:00.010Z',
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({
        access_token: 'access', refresh_token: 'refresh', expires_in: 3600,
        user: { id: 'user-1', email: 'me@example.com' },
      }))
      .mockResolvedValueOnce(response('1970-01-01T00:00:01.000Z'))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([remote]))
      .mockResolvedValueOnce(response([{
        id: 'local-quiz-1', user_id: 'user-1', word: 'throttled',
        picked: 1, right_choice: 1,
        choices: ['掐住、扼住', '被服務端限流擋下', '主動調降發送速率'],
        at: '1970-01-01T00:00:00.030Z',
      }]));

    await signIn('https://project.supabase.co', 'anon', 'me@example.com', 'password');
    expect(await syncNow()).toMatchObject({ pulled: 1, pushed: 1 });
    expect(await db.quizLog.get('remote-quiz-1')).toEqual({
      id: 'remote-quiz-1', word: 'slammed', picked: 0, right: 2,
      choices: ['忙翻', '被投訴', '被裁員'], at: 10, pending: 0,
    });
    expect((await db.quizLog.get('local-quiz-1'))!.pending).toBe(0);
    expect(fetchMock.mock.calls[7]![1]?.body).toContain('"right_choice":1');
    expect(fetchMock.mock.calls[7]![0]).toContain('quiz_log?on_conflict=user_id%2Cid');
  });
```

- [ ] **Step 10: 執行測試確認全部通過**

Run: `pnpm vitest run src/lib/sync.test.ts`
Expected: PASS，所有 describe 區塊（含既有的 `resolveRow`／`acknowledgeRow`／`mergeCollectedAt`／`syncNow`）都通過。

- [ ] **Step 11: Commit**

```bash
git add src/lib/sync.ts src/lib/sync.test.ts
git commit -m "feat: quizLog 加入同步的拉推與換帳號重置"
```

---

## Task 8: `messages.ts` 的 quizLog 訊息與 exportData

**Files:**
- Modify: `src/lib/messages.ts:1, 9-14, 28-53, 182-189`
- Test: `src/lib/messages.test.ts`

**Interfaces:**
- Consumes：`recordQuiz`、`listQuizLog`、`QuizLogRow` from `src/lib/db.ts`（Task 5）。
- Produces：新 `Msg` 變體 `{ type: 'recordQuiz'; word: string; picked: 0 | 1 | 2; right: 0 | 1 | 2; choices: [string, string, string] }`；`ExportBundle.quizLog: QuizLogRow[]`。Task 11 的 content script 會用 `browser.runtime.sendMessage({ type: 'recordQuiz', ... })` 呼叫這個訊息。

- [ ] **Step 1: 寫失敗測試**

`src/lib/messages.test.ts` 第 4 行 import 加上 `listQuizLog`：

```ts
import { db, markWord, sentenceKey } from './db';
```

改成：

```ts
import { db, markWord, sentenceKey, listQuizLog } from './db';
```

`beforeEach`（9-25 行）加一行清表，並在 `loadSettings` mock 物件加上 `guessFirst: true`（這個欄位由 Task 9 定義；先加在這裡是因為 mock 物件必須符合完整的 `Settings` 型別，Task 9 完成前 `pnpm typecheck` 會先卡在這裡，這是預期中的暫時狀態，Task 9 會補上 `Settings.guessFirst` 定義）：

```ts
beforeEach(async () => {
  await db.words.clear();
  await db.contexts.clear();
  await db.lookupCache.clear();
  await db.sentenceCache.clear();
  await db.reviewLog.clear();
  await db.quizLog.clear();
  vi.restoreAllMocks();
  vi.spyOn(settings, 'loadSettings').mockResolvedValue({
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'k', model: 'm', profile: '', threshold: 5000, blockedHosts: [],
    highlightColors: settings.DEFAULT_HIGHLIGHT_COLORS, autoOrigins: [],
    highlightTextColors: settings.DEFAULT_HIGHLIGHT_TEXT_COLORS,
    highlightUnderlineColors: settings.DEFAULT_HIGHLIGHT_UNDERLINE_COLORS,
    markConjunctions: true,
    guessFirst: true,
    templates: DEFAULT_TEMPLATES,
  });
});
```

在 `describe('handleMessage', ...)` 區塊裡的 `exportData` 測試（499-521 行）之後加入一個新的 describe：

```ts
describe('recordQuiz 訊息', () => {
  it('寫入三選一的作答紀錄', async () => {
    await handleMessage({
      type: 'recordQuiz', word: 'throttled', picked: 1, right: 1,
      choices: ['掐住、扼住', '被服務端限流擋下', '主動調降發送速率'],
    });
    expect(await listQuizLog()).toMatchObject([{ word: 'throttled', picked: 1, right: 1 }]);
  });

  it('exportData 帶出 quizLog', async () => {
    await handleMessage({
      type: 'recordQuiz', word: 'throttled', picked: 1, right: 1,
      choices: ['掐住、扼住', '被服務端限流擋下', '主動調降發送速率'],
    });
    const bundle = await handleMessage({ type: 'exportData' }) as any;
    expect(bundle.quizLog).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm vitest run src/lib/messages.test.ts -t "recordQuiz"`
Expected: FAIL，`recordQuiz` 訊息型別不存在，`handleMessage` 沒有對應的 case。

- [ ] **Step 3: 修改 `messages.ts`**

第 1 行 import 加上 `listQuizLog`、`recordQuiz`、`QuizLogRow`：

```ts
import { db, loadMarks, markWord, unmarkWord, deleteWord, addContext, listContexts, listReviewItems, listReviewLog, listQuizLog, masterWord, recordReview, recordQuiz, putCached, deleteCached, getSentence, putSentence, type WordRow, type ContextRow, type ReviewLogRow, type QuizLogRow } from './db';
```

`ExportBundle`（9-14 行）加一個欄位：

```ts
export interface ExportBundle {
  exportedAt: number;
  words: WordRow[];
  contexts: ContextRow[];
  reviewLog: ReviewLogRow[];
  quizLog: QuizLogRow[];
}
```

`Msg` union（28-53 行）加一個變體，放在 `reviewWord` 之後：

```ts
  | { type: 'reviewWord'; word: string; remembered: boolean }
  | {
    type: 'recordQuiz'; word: string;
    picked: 0 | 1 | 2; right: 0 | 1 | 2; choices: [string, string, string];
  }
```

`handleMessage` 的 switch（56-219 行），在 `case 'reviewWord':` 之後加入：

```ts
    case 'reviewWord':
      return recordReview(msg.word, msg.remembered);

    case 'recordQuiz':
      await recordQuiz(msg.word, msg.picked, msg.right, msg.choices);
      return null;
```

`exportData` case（182-189 行）：

```ts
    case 'exportData': {
      const [words, contexts, reviewLog] = await Promise.all([
        db.words.filter((r) => r.deletedAt === null).toArray(),
        db.contexts.filter((r) => r.deletedAt === null).toArray(),
        listReviewLog(),
      ]);
      return { exportedAt: Date.now(), words, contexts, reviewLog } satisfies ExportBundle;
    }
```

改成：

```ts
    case 'exportData': {
      const [words, contexts, reviewLog, quizLog] = await Promise.all([
        db.words.filter((r) => r.deletedAt === null).toArray(),
        db.contexts.filter((r) => r.deletedAt === null).toArray(),
        listReviewLog(),
        listQuizLog(),
      ]);
      return { exportedAt: Date.now(), words, contexts, reviewLog, quizLog } satisfies ExportBundle;
    }
```

- [ ] **Step 4: 執行測試確認通過**

Run: `pnpm vitest run src/lib/messages.test.ts`
Expected: PASS。若 `guessFirst` 型別仍未定義（Task 9 尚未做）會出現 `pnpm typecheck` 錯誤，屬預期中的暫時狀態，Vitest 執行不受 TS 型別檢查阻擋，測試本身應正常通過。

- [ ] **Step 5: Commit**

```bash
git add src/lib/messages.ts src/lib/messages.test.ts
git commit -m "feat: 新增 recordQuiz 訊息並讓 exportData 帶出 quizLog"
```

---

## Task 9: `guessFirst` 設定（settings.ts、messages.ts、options/App.vue）

**Files:**
- Modify: `src/lib/settings.ts:6-26, 68-82, 109-111`
- Modify: `src/lib/messages.ts:61-70`
- Modify: `entrypoints/options/App.vue:188-191`
- Modify: `src/lib/messages.test.ts:16-24`（Task 8 已加 `guessFirst: true`，本任務確認一致）
- Modify: `src/content/highlight-content.test.ts:39-51`
- Test: `src/lib/settings.test.ts`

**Interfaces:**
- Produces：`Settings.guessFirst: boolean`，`DEFAULTS.guessFirst = true`，`loadSettings()` 對 storage 壞資料的型別守衛。`getHighlightSettings` 訊息回傳值多一個 `guessFirst` 欄位。Task 11 的 content script 會從這個訊息解構出 `guessFirst`。

- [ ] **Step 1: 寫失敗測試**

在 `src/lib/settings.test.ts` 的 `describe('loadSettings 的 template 合併', ...)` 區塊裡，第 170 行 `expect(s.markConjunctions).toBe(true);` 之後加一行：

```ts
    expect(s.guessFirst).toBe(true);
```

在檔案最後加入新 describe：

```ts
describe('guessFirst', () => {
  beforeEach(() => fakeBrowser.reset());

  it('storage 存壞資料時退回預設值', async () => {
    await fakeBrowser.storage.local.set({ settings: { guessFirst: 'yes' } });
    expect((await loadSettings()).guessFirst).toBe(true);
  });

  it('可以關閉並持久化', async () => {
    await saveSettings({ guessFirst: false });
    expect((await loadSettings()).guessFirst).toBe(false);
  });
});
```

（檔案已 import `loadSettings`、`saveSettings`、`fakeBrowser`，沿用既有 import。）

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm vitest run src/lib/settings.test.ts -t "guessFirst"`
Expected: FAIL，`s.guessFirst` 是 `undefined`。

- [ ] **Step 3: 修改 `settings.ts`**

`Settings` interface（6-26 行），`markConjunctions` 欄位之後加入：

```ts
  /** 以不同底線標示對等連接詞與從屬連接詞。 */
  markConjunctions: boolean;
  /** 查詞卡先出三選一,答對或跳過才看完整答案;開關只影響顯示與作答,不影響出題 prompt。 */
  guessFirst: boolean;
```

`DEFAULTS`（68-82 行），`markConjunctions: true,` 之後加入：

```ts
  markConjunctions: true,
  guessFirst: true,
```

`loadSettings`（87-125 行）裡 `markConjunctions` 的守衛（109-111 行）之後加入：

```ts
    markConjunctions: typeof stored.markConjunctions === 'boolean'
      ? stored.markConjunctions
      : DEFAULTS.markConjunctions,
    guessFirst: typeof stored.guessFirst === 'boolean'
      ? stored.guessFirst
      : DEFAULTS.guessFirst,
```

- [ ] **Step 4: 執行測試確認通過**

Run: `pnpm vitest run src/lib/settings.test.ts`
Expected: PASS。

- [ ] **Step 5: 修改 `messages.ts` 的 `getHighlightSettings`**

第 61-70 行：

```ts
    case 'getHighlightSettings': {
      const {
        threshold, highlightColors, highlightTextColors,
        highlightUnderlineColors, markConjunctions,
      } = await loadSettings();
      return {
        threshold, highlightColors, highlightTextColors,
        highlightUnderlineColors, markConjunctions,
      };
    }
```

改成：

```ts
    case 'getHighlightSettings': {
      const {
        threshold, highlightColors, highlightTextColors,
        highlightUnderlineColors, markConjunctions, guessFirst,
      } = await loadSettings();
      return {
        threshold, highlightColors, highlightTextColors,
        highlightUnderlineColors, markConjunctions, guessFirst,
      };
    }
```

- [ ] **Step 6: 修改 `options/App.vue`**

第 188-191 行：

```html
      <label class="switch">
        <input v-model="settings.markConjunctions" type="checkbox" @change="persist" />
        連詞標記：並列連詞用點線，從句連詞用雙線
      </label>
```

改成：

```html
      <label class="switch">
        <input v-model="settings.markConjunctions" type="checkbox" @change="persist" />
        連詞標記：並列連詞用點線，從句連詞用雙線
      </label>
      <label class="switch">
        <input v-model="settings.guessFirst" type="checkbox" @change="persist" />
        查詞先猜再揭曉：查詞卡先出三選一，答對或跳過才看完整答案
      </label>
```

- [ ] **Step 7: 修改 `highlight-content.test.ts` 的共用 mock**

第 39-51 行的 `fakeBrowser.runtime.onMessage.addListener(...)`：

```ts
    fakeBrowser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === 'getMarks') sendResponse([]);
      else if (msg.type === 'getHighlightSettings') sendResponse({
        threshold: 5000,
        highlightColors: {},
        highlightTextColors: {},
        highlightUnderlineColors: {},
        markConjunctions: false,
      });
      else if (msg.type === 'toggleMark') sendResponse(msg.status ?? 'unknown');
      else sendResponse(true);
      return true;
    });
```

改成（用一個外層可變變數 `guessFirst`，讓 Task 11 的個別測試可以在呼叫 `contentScript.main()` 前覆寫它）：

```ts
    fakeBrowser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === 'getMarks') sendResponse([]);
      else if (msg.type === 'getHighlightSettings') sendResponse({
        threshold: 5000,
        highlightColors: {},
        highlightTextColors: {},
        highlightUnderlineColors: {},
        markConjunctions: false,
        guessFirst,
      });
      else if (msg.type === 'toggleMark') sendResponse(msg.status ?? 'unknown');
      else sendResponse(true);
      return true;
    });
```

在 `describe('highlight content 快捷鍵', ...)` 區塊最頂端（`beforeEach` 之前）宣告這個變數，並在 `beforeEach` 開頭重設：

```ts
describe('highlight content 快捷鍵', () => {
  let guessFirst = true;

  beforeEach(() => {
    fakeBrowser.reset();
    card.body = '';
    guessFirst = true;
    document.body.textContent = 'We got slammed with alerts.';
```

- [ ] **Step 8: 執行測試與型別檢查**

Run: `pnpm vitest run src/lib/settings.test.ts src/lib/messages.test.ts src/content/highlight-content.test.ts`
Expected: PASS。

Run: `pnpm typecheck`
Expected: 無錯誤（Task 8 遺留的 `guessFirst` 型別缺口在這一步補齊）。

- [ ] **Step 9: Commit**

```bash
git add src/lib/settings.ts src/lib/settings.test.ts src/lib/messages.ts entrypoints/options/App.vue src/content/highlight-content.test.ts
git commit -m "feat: 新增 guessFirst 設定並掛在查詞卡的顯示層"
```

---

## Task 10: 卡片三選一按鈕（card.ts）

**Files:**
- Modify: `src/content/card.ts:3-16, 35-149, 175-225`
- Test: `src/content/card.test.ts`

**Interfaces:**
- Consumes：無（`renderCardHtml`／`showCard` 是既有的純函式與 DOM 掛載函式）。
- Produces：`CardOptions.choices?: [string, string, string]`、`CardOptions.onPick?: (position: 0 | 1 | 2) => void`。`position` 是**畫面位置索引**（0、1、2），不是原始索引；Task 11 的 `onQuizPick(position)` 負責把它換算回原始索引。`renderCardHtml` 在有 `choices` 時多畫一個 `class="quiz"` 容器，裡面三個 `class="quiz-choice"` 按鈕，`data-position` 屬性存位置索引。

- [ ] **Step 1: 寫失敗測試**

在 `src/content/card.test.ts` 的 `describe('renderCardHtml', ...)` 區塊最後加入：

```ts
  it('有選項時渲染三個按鈕,沒有就不畫', () => {
    expect(renderCardHtml({ title: 'a', body: 'b' })).not.toContain('class="quiz"');
    const html = renderCardHtml({ title: 'a', body: 'b', choices: ['甲', '乙', '丙'] });
    expect(html).toContain('class="quiz"');
    expect((html.match(/class="quiz-choice"/g) ?? []).length).toBe(3);
    expect(html).toContain('甲');
    expect(html).toContain('乙');
    expect(html).toContain('丙');
    expect(html).toContain('data-position="0"');
    expect(html).toContain('data-position="1"');
    expect(html).toContain('data-position="2"');
  });

  it('選項按鈕的文字要跳脫,不能真的變成節點', () => {
    const html = renderCardHtml({
      title: '', body: 'b', choices: ['<img src=x onerror=alert(1)>', '乙', '丙'],
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `pnpm vitest run src/content/card.test.ts -t "有選項時"`
Expected: FAIL，`renderCardHtml` 目前不認得 `choices`。

- [ ] **Step 3: 修改 `CardOptions` 與 `renderCardHtml`**

第 3-16 行的 `CardOptions`：

```ts
export interface CardOptions {
  /** 空字串代表不顯示標題。 */
  title: string;
  /** 以 Markdown 渲染；渲染器負責跳脫 AI 內容。 */
  body: string;
  rect: DOMRect;
  hint?: string;
  marked?: boolean;
  loading?: boolean;
  celebrate?: boolean;
  onClose?: () => void;
  /** 只有 AI 卡片給;沒給就不畫重試鈕。 */
  onRetry?: () => void;
}
```

改成：

```ts
export interface CardOptions {
  /** 空字串代表不顯示標題。 */
  title: string;
  /** 以 Markdown 渲染；渲染器負責跳脫 AI 內容。 */
  body: string;
  rect: DOMRect;
  hint?: string;
  marked?: boolean;
  loading?: boolean;
  celebrate?: boolean;
  onClose?: () => void;
  /** 只有 AI 卡片給;沒給就不畫重試鈕。 */
  onRetry?: () => void;
  /** 三選一畫面顯示順序;給了才畫按鈕,只有題目 pending 時才傳。 */
  choices?: [string, string, string];
  /** 點第 i 個按鈕時呼叫,i 是畫面位置索引,不是洗牌前的原始索引。 */
  onPick?: (position: 0 | 1 | 2) => void;
}
```

`renderCardHtml`（175-192 行）：

```ts
export function renderCardHtml(opts: Omit<CardOptions, 'rect'>): string {
  const parts: string[] = [];

  if (opts.title) {
    const cls = opts.marked ? 'title marked' : 'title';
    const icon = browser.runtime.getURL('/icons/32.png');
    const retry = opts.onRetry
      ? `<button class="retry" type="button" aria-label="重問一次"${opts.loading ? ' disabled' : ''}>↻</button>`
      : '';
    parts.push(`<div class="header"><img class="brand" src="${icon}" alt="" aria-hidden="true"><div class="${cls}">${escapeHtml(opts.title)}</div>${retry}<button class="close" type="button" aria-label="關閉">×</button></div>`);
  }
  parts.push(`<div class="body">${renderMarkdown(opts.body)}</div>`);
  if (opts.hint) {
    parts.push(`<div class="hint">${opts.hint.split(' · ').map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>`);
  }

  return parts.join('');
}
```

改成：

```ts
export function renderCardHtml(opts: Omit<CardOptions, 'rect'>): string {
  const parts: string[] = [];

  if (opts.title) {
    const cls = opts.marked ? 'title marked' : 'title';
    const icon = browser.runtime.getURL('/icons/32.png');
    const retry = opts.onRetry
      ? `<button class="retry" type="button" aria-label="重問一次"${opts.loading ? ' disabled' : ''}>↻</button>`
      : '';
    parts.push(`<div class="header"><img class="brand" src="${icon}" alt="" aria-hidden="true"><div class="${cls}">${escapeHtml(opts.title)}</div>${retry}<button class="close" type="button" aria-label="關閉">×</button></div>`);
  }
  parts.push(`<div class="body">${renderMarkdown(opts.body)}</div>`);
  if (opts.choices) {
    parts.push(`<div class="quiz">${opts.choices.map((choice, i) =>
      `<button class="quiz-choice" type="button" data-position="${i}">${escapeHtml(choice)}</button>`,
    ).join('')}</div>`);
  }
  if (opts.hint) {
    parts.push(`<div class="hint">${opts.hint.split(' · ').map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div>`);
  }

  return parts.join('');
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `pnpm vitest run src/content/card.test.ts`
Expected: PASS。

- [ ] **Step 5: `showCard` 綁定按鈕事件**

第 214-218 行：

```ts
  card.querySelector('.close')?.addEventListener('click', () => {
    hideCard();
    opts.onClose?.();
  }, { once: true });
  card.querySelector('.retry')?.addEventListener('click', () => opts.onRetry?.(), { once: true });
```

改成：

```ts
  card.querySelector('.close')?.addEventListener('click', () => {
    hideCard();
    opts.onClose?.();
  }, { once: true });
  card.querySelector('.retry')?.addEventListener('click', () => opts.onRetry?.(), { once: true });
  card.querySelectorAll<HTMLButtonElement>('.quiz-choice').forEach((btn) => {
    const position = Number(btn.dataset.position) as 0 | 1 | 2;
    btn.addEventListener('click', () => opts.onPick?.(position), { once: true });
  });
```

- [ ] **Step 6: 加上選項按鈕樣式**

在 `ensureRoot`（30-155 行）的 `<style>` 內，`.hint span { ... }`（104 行）之後加入（沿用既有 token，遵守 ADR-0026「一張卡只有一個重點色」，平時中性、hover／focus 才用 `--accent`）：

```css
      .quiz { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
      .quiz-choice {
        padding: 8px 10px; text-align: left; color: var(--body); background: var(--chip);
        border: 1px solid var(--chip-border); border-radius: 8px; cursor: pointer; font: inherit;
      }
      .quiz-choice:hover { background: var(--chip-hover); }
      .quiz-choice:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
```

深色模式區塊（138-148 行）只換 token，`.quiz-choice` 沿用 `--chip`／`--chip-hover`／`--body`／`--accent`，不需要另外覆寫規則。

- [ ] **Step 7: 型別檢查與全測試**

Run: `pnpm typecheck`
Expected: 無錯誤。

Run: `pnpm vitest run src/content/card.test.ts`
Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add src/content/card.ts src/content/card.test.ts
git commit -m "feat: 查詞卡加上三選一選項按鈕"
```

---

## Task 11: 查詞卡狀態機、鍵盤與 `guessFirst` 消費（highlight.content.ts）+ 端到端手動 QA

**Files:**
- Modify: `entrypoints/highlight.content.ts`
- Test: `src/content/highlight-content.test.ts`

**Interfaces:**
- Consumes：`extractQuiz`、`QuizExtract`（Task 1）、`stripQuiz`（Task 2，已在 Task 4 引入）、`CardOptions.choices`／`onPick`（Task 10）、`getHighlightSettings` 回傳的 `guessFirst`（Task 9）、`recordQuiz` 訊息（Task 8）。
- Produces：這是最終消費端，之後沒有任務依賴它的內部型別。

**這是整條線第一次可以端到端驗證的地方，手動 QA 的預算放在這個任務最後一步。**

- [ ] **Step 1: 匯入與新增 session 狀態**

第 6 行 import（Task 4 已加入 `stripQuiz`）：

```ts
import { extractTakeaway, stripQuiz } from '@/src/lib/prompt';
```

改成：

```ts
import { extractQuiz, extractTakeaway, stripQuiz } from '@/src/lib/prompt';
```

`getHighlightSettings` 的回傳型別（52-58 行）與解構（60-63 行）：

```ts
      browser.runtime.sendMessage({ type: 'getHighlightSettings' }) as Promise<{
        threshold: number;
        highlightColors: Record<HighlightTier, string>;
        highlightTextColors: Record<HighlightTier, string>;
        highlightUnderlineColors: Record<HighlightTier, string>;
        markConjunctions: boolean;
      }>,
    ]);
    const {
      threshold, highlightColors, highlightTextColors,
      highlightUnderlineColors, markConjunctions,
    } = highlightSettings;
```

改成：

```ts
      browser.runtime.sendMessage({ type: 'getHighlightSettings' }) as Promise<{
        threshold: number;
        highlightColors: Record<HighlightTier, string>;
        highlightTextColors: Record<HighlightTier, string>;
        highlightUnderlineColors: Record<HighlightTier, string>;
        markConjunctions: boolean;
        guessFirst: boolean;
      }>,
    ]);
    const {
      threshold, highlightColors, highlightTextColors,
      highlightUnderlineColors, markConjunctions, guessFirst,
    } = highlightSettings;
```

`let currentDefinition = '';`（103 行）之後加入 quiz 狀態：

```ts
    let currentDefinition = '';
    interface Quiz {
      choices: [string, string, string];
      right: 0 | 1 | 2;
      /** 畫面第 i 個位置顯示 choices[order[i]]。元素型別是 `0 | 1 | 2`,不是 `number`。 */
      order: [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2];
      state: 'pending' | 'revealed';
      /** 揭曉時的原始索引；A 跳過時為 null。 */
      picked: 0 | 1 | 2 | null;
    }
    let currentQuiz: Quiz | null = null;
    /** A 跳過或選項還沒解析出來就按 A,跳過後不再重新出題,直到換一個字。 */
    let quizSkipped = false;
    /**
     * true 代表目前沒有查詞請求在飛，或飛的那個已經有結果了；用來跟「currentQuiz 還是
     * null 是因為還沒解析出來」（true 的情況不該讓 A 被當成跳過鍵吃掉）分開判斷，
     * 否則一個字如果從頭到尾沒有解析出題目，A 會永遠被誤判成跳過鍵，查不了下一個字。
     */
    let lookupSettled = true;
```

- [ ] **Step 2: 加上 `shuffleOrder` 與狀態機輔助函式**

在檔案最尾端的 `isTypingTarget` 函式（448-454 行）之前，加入模組層級的洗牌函式：

```ts
/**
 * Fisher-Yates,產生 [0,1,2] 的隨機排列。
 * 回傳元素型別必須是 `0 | 1 | 2` 而不是 `number`：`order[position]` 會直接存進
 * `Quiz.picked`（型別 `0 | 1 | 2 | null`）並送進 recordQuiz 訊息，元素型別是 number
 * 就過不了 `pnpm typecheck`。
 */
function shuffleOrder(): [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2] {
  const order = [0, 1, 2];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order as [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2];
}
```

在 `main()` 內，`const wordTitle = ...`（141-142 行）之後、`runLookup` 的 JSDoc 註解（144-148 行）之前，加入：

```ts
    const resetQuiz = () => { currentQuiz = null; quizSkipped = false; };

    const retry = (hover: Hover, from: string) => () => void runLookup(hover, true, from);

    /** 查詞卡現在該顯示什麼；所有查詞卡的 showCard 呼叫都經過這裡,揭曉前絕不外流答案。 */
    const renderQuizCard = (baseHint: string): {
      body: string; hint: string; choices?: [string, string, string];
    } => {
      if (!guessFirst || !currentQuiz) return { body: currentDefinition, hint: baseHint };
      if (currentQuiz.state === 'pending') {
        const displayed = currentQuiz.order.map((i) => currentQuiz!.choices[i]) as [string, string, string];
        return {
          body: '這隻在這句是哪一個意思？選一個最接近的。',
          hint: '1／2／3 選答案 · A 跳過',
          choices: displayed,
        };
      }
      const diagnostic = currentQuiz.picked === null
        ? `略過了,正解是「${currentQuiz.choices[currentQuiz.right]}」。`
        : currentQuiz.picked === currentQuiz.right
          ? '答對了！'
          : `答錯了,正解是「${currentQuiz.choices[currentQuiz.right]}」。`;
      return { body: `${diagnostic}\n\n${currentDefinition}`, hint: baseHint };
    };

    /** 只在還沒有題目、也還沒跳過時抓取；已揭曉或已跳過都不再洗牌或覆蓋。 */
    const applyQuizExtraction = (raw: string) => {
      if (currentQuiz || quizSkipped) return;
      const extracted = extractQuiz(raw);
      if (!extracted) return;
      currentQuiz = { ...extracted, order: shuffleOrder(), state: 'pending', picked: null };
    };

    /** position 是畫面位置索引;換算回原始索引才是 quizLog 要存的值。 */
    const onQuizPick = (position: 0 | 1 | 2) => {
      if (!current || !currentQuiz || currentQuiz.state !== 'pending') return;
      const hover = current;
      const picked = currentQuiz.order[position];
      currentQuiz = { ...currentQuiz, state: 'revealed', picked };
      void browser.runtime.sendMessage({
        type: 'recordQuiz', word: hover.lemma,
        picked, right: currentQuiz.right, choices: currentQuiz.choices,
      });
      const view = renderQuizCard(wordHint(hover.lemma));
      showCard({
        title: wordTitle(hover), rect: hover.rect,
        body: view.body, hint: view.hint, choices: view.choices,
        marked: marks.get(hover.lemma) === 'unknown',
        onClose: closeAiCard, onRetry: retry(hover, currentDefinition),
      });
    };
```

- [ ] **Step 3: `closeAiCard` 與 `Escape` 一併重置 quiz**

第 116-122 行：

```ts
    const closeAiCard = () => {
      current = null;
      currentTakeaway = null;
      currentSpeech = '';
      currentDefinition = '';
      dismissAi();
    };
```

改成：

```ts
    const closeAiCard = () => {
      current = null;
      currentTakeaway = null;
      currentSpeech = '';
      currentDefinition = '';
      resetQuiz();
      dismissAi();
    };
```

第 273-281 行（`Escape` 分支）：

```ts
      if (e.key === 'Escape') {
        hideCard();
        current = null;
        currentTakeaway = null;
        currentSpeech = '';
        currentDefinition = '';
        dismissAi();
        return;
      }
```

改成：

```ts
      if (e.key === 'Escape') {
        hideCard();
        current = null;
        currentTakeaway = null;
        currentSpeech = '';
        currentDefinition = '';
        resetQuiz();
        dismissAi();
        return;
      }
```

- [ ] **Step 4: 改寫 `runLookup`，所有 showCard 呼叫都經過 `renderQuizCard`**

把整個 `runLookup` 函式（149-195 行，含前面的 JSDoc 註解）換成：

```ts
    /**
     * 查詞卡的 AI 部分。重試鈕帶 fresh 繞過快取重問，但不重跑收藏與語境：
     * 收藏是「你遇到這個字」這個事件，重問一次答案並沒有再遇到一次。
     * previous 是重問前畫面上那份答案，重問失敗就退回去，錯誤放進 hint 那一排。
     */
    const runLookup = async (hover: Hover, fresh = false, previous = '') => {
      const hint = wordHint(hover.lemma);
      const marked = marks.get(hover.lemma) === 'unknown';
      // 已揭曉或已跳過的題目不重新武裝；重問只是換一個字的答案,不是重新考一次。
      const keepQuiz = fresh && (currentQuiz?.state === 'revealed' || quizSkipped);
      if (!keepQuiz) resetQuiz();
      // 這個查詞請求還在飛,期間 currentQuiz 是 null 不代表「沒有題目」,
      // 而是「還沒解析出來」，A 鍵要能分辨這兩種情況。
      lookupSettled = false;

      showCard({
        title: wordTitle(hover), rect: hover.rect,
        body: previous || '老虎正在抓這個字…',
        hint: '', marked, loading: true, onClose: closeAiCard, onRetry: retry(hover, previous),
      });

      const seq = ++explainSeq;
      const result = await requestAi({
        type: 'lookup', word: hover.lemma, surface: hover.word, sentence: hover.sentence, fresh,
      }, (body) => {
        if (seq === explainSeq) {
          currentDefinition = stripQuiz(body);
          if (guessFirst) applyQuizExtraction(body);
          const view = renderQuizCard(hint);
          showCard({
            title: wordTitle(hover), body: view.body, rect: hover.rect,
            hint: view.hint, choices: view.choices, marked, loading: true,
            onClose: closeAiCard, onRetry: retry(hover, previous), onPick: onQuizPick,
          });
        }
      });
      if (seq !== explainSeq) return;

      if (result?.ok) {
        currentDefinition = stripQuiz(result.text);
        if (guessFirst) applyQuizExtraction(result.text);
        lookupSettled = true;
        const view = renderQuizCard(hint);
        showCard({
          title: wordTitle(hover), body: view.body, rect: hover.rect,
          hint: view.hint, choices: view.choices, marked,
          onClose: closeAiCard, onRetry: retry(hover, currentDefinition), onPick: onQuizPick,
        });
        return;
      }

      // 重問失敗留住舊答案，錯誤擠進本來就在的 hint 那排，不多佔一行高度。
      lookupSettled = true;
      const error = result?.error ?? '背景程式沒有回應';
      currentDefinition = previous;
      showCard({
        title: wordTitle(hover),
        body: previous || `查詢失敗:${error}`,
        rect: hover.rect,
        hint: previous ? `重問失敗:${error}` : hint,
        marked,
        onClose: closeAiCard,
        onRetry: retry(hover, previous),
      });
    };
```

（原本定義在 `runLookup` 內部的 `const retry = (from: string) => () => void runLookup(hover, true, from);` 已經在 Step 2 提升到 `main()` 層級，這裡改用 `retry(hover, previous)`／`retry(hover, currentDefinition)` 呼叫。）

- [ ] **Step 5: `A` 鍵新增跳過分支，`1`／`2`／`3` 新增作答分支**

第 273-281 行的 `Escape` 分支（Step 3 已改）之後，插入兩個新分支（放在 `f`/`F` 分支之前）：

```ts
      if ((e.key === '1' || e.key === '2' || e.key === '3')
        && guessFirst && current && currentQuiz?.state === 'pending') {
        e.preventDefault();
        onQuizPick((Number(e.key) - 1) as 0 | 1 | 2);
        return;
      }
```

第 320-338 行的既有 `A` 鍵分支：

```ts
      if (e.key === 'a' || e.key === 'A') {
        const hover = hoveredWord();
        if (!hover) return;
        e.preventDefault();
        dismissAi();
        currentTakeaway = null;
        currentSpeech = '';
        currentDefinition = '';
        current = hover;

        // 已收藏單字再次查詢時累積語境；addContext 負責去重。
        if (marks.get(hover.lemma) === 'unknown') void browser.runtime.sendMessage({
          type: 'saveContext', word: hover.lemma, sentence: hover.sentence,
          url: location.href, title: document.title,
        });

        await runLookup(hover);
        return;
      }
```

改成（跳過分支排在前面，直接 `return`，不會落到下面的查詞分支）：

```ts
      if ((e.key === 'a' || e.key === 'A') && guessFirst && current && !quizSkipped
        && (currentQuiz?.state === 'pending' || (currentQuiz === null && !lookupSettled))) {
        e.preventDefault();
        currentQuiz = null;
        quizSkipped = true;
        const hover = current;
        const view = renderQuizCard(wordHint(hover.lemma));
        showCard({
          title: wordTitle(hover), rect: hover.rect,
          body: view.body, hint: view.hint, choices: view.choices,
          marked: marks.get(hover.lemma) === 'unknown',
          onClose: closeAiCard, onRetry: retry(hover, currentDefinition),
        });
        return;
      }

      if (e.key === 'a' || e.key === 'A') {
        const hover = hoveredWord();
        if (!hover) return;
        e.preventDefault();
        dismissAi();
        currentTakeaway = null;
        currentSpeech = '';
        currentDefinition = '';
        current = hover;

        // 已收藏單字再次查詢時累積語境；addContext 負責去重。
        if (marks.get(hover.lemma) === 'unknown') void browser.runtime.sendMessage({
          type: 'saveContext', word: hover.lemma, sentence: hover.sentence,
          url: location.href, title: document.title,
        });

        await runLookup(hover);
        return;
      }
```

（跳過分支的條件特別檢查 `!lookupSettled`，不是只看 `currentQuiz === null`：一個字如果查詢已經完成但從頭到尾沒解析出題目，`currentQuiz` 也會是 `null`，這時候 `lookupSettled` 是 `true`，條件不成立，A 才能正常落到下面的查詞分支去查游標下的新字，不會被誤判成「還在等跳過」而卡死。）

- [ ] **Step 6: `Space` 重畫改走 `renderQuizCard`**

第 397-429 行：

```ts
      // Space 固定操作卡片單字。
      if (e.key === ' ' && current) {
        e.preventDefault();
        const hover = current;
        dismissAi();
        const status = await browser.runtime.sendMessage({
          type: 'toggleMark', word: hover.lemma,
        }) as WordStatus | null;

        if (status === 'unknown') {
          marks.set(hover.lemma, status);
          void browser.runtime.sendMessage({
            type: 'saveContext',
            word: hover.lemma,
            sentence: hover.sentence,
            url: location.href,
            title: document.title,
          });
        } else {
          marks.delete(hover.lemma);
        }
        paintHighlights();

        showCard({
          title: wordTitle(hover),
          body: currentDefinition,
          rect: hover.rect,
          hint: wordHint(hover.lemma),
          marked: status === 'unknown',
          celebrate: status === 'unknown',
          onClose: closeAiCard,
        });
      }
```

改成：

```ts
      // Space 固定操作卡片單字。
      if (e.key === ' ' && current) {
        e.preventDefault();
        const hover = current;
        dismissAi();
        const status = await browser.runtime.sendMessage({
          type: 'toggleMark', word: hover.lemma,
        }) as WordStatus | null;

        if (status === 'unknown') {
          marks.set(hover.lemma, status);
          void browser.runtime.sendMessage({
            type: 'saveContext',
            word: hover.lemma,
            sentence: hover.sentence,
            url: location.href,
            title: document.title,
          });
        } else {
          marks.delete(hover.lemma);
        }
        paintHighlights();

        const view = renderQuizCard(wordHint(hover.lemma));
        showCard({
          title: wordTitle(hover),
          body: view.body,
          rect: hover.rect,
          hint: view.hint,
          choices: view.choices,
          marked: status === 'unknown',
          celebrate: status === 'unknown',
          onClose: closeAiCard,
          onPick: onQuizPick,
        });
      }
```

- [ ] **Step 7: 執行既有測試，確認沒有回歸**

Run: `pnpm vitest run src/content/highlight-content.test.ts`
Expected: PASS，Task 4 加的「串流與結果都會剝除選項與答案行」與既有的「查詞後按 X 再按 Space 仍保留定義」都要通過（後者的 mock AI 回應 `'忙翻'` 沒有選項行，`extractQuiz` 回 `null`，`currentQuiz` 全程維持 `null`，行為應與改動前一致）。

- [ ] **Step 8: 寫三個 `guessFirst` 行為的失敗測試**

在 `src/content/highlight-content.test.ts` 頂端，把 card 的 mock 擴充成也記錄 `choices`：

```ts
const card = vi.hoisted(() => ({ body: '', choices: undefined as string[] | undefined }));
vi.mock('@/src/content/card', () => ({
  showCard: (opts: { body: string; choices?: string[] }) => {
    card.body = opts.body;
    card.choices = opts.choices;
  },
  hideCard: vi.fn(),
}));
```

在 `beforeEach` 內註冊 `onMessage` 監聽器前，加一個共用陣列記錄收到的訊息（放在 `describe` 區塊頂端，跟 `guessFirst` 變數放一起）：

```ts
describe('highlight content 快捷鍵', () => {
  let guessFirst = true;
  let recorded: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    fakeBrowser.reset();
    card.body = '';
    card.choices = undefined;
    guessFirst = true;
    recorded = [];
```

把 `onMessage` 監聽器（Task 9 已改過）的第一行加上記錄：

```ts
    fakeBrowser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      recorded.push(msg);
      if (msg.type === 'getMarks') sendResponse([]);
```

在檔案最後（既有 `it('查詞後按 X 再按 Space 仍保留定義', ...)` 與 Task 4 加的測試之後）加入：

```ts
  it('guessFirst 開啟時,選項出現後可以用數字鍵作答,答對會揭曉完整定義並寫入 quizLog', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // 讓洗牌結果等於原始順序,方便斷言
    const listeners: Array<(event: any) => void> = [];
    vi.spyOn(fakeBrowser.runtime, 'connect').mockReturnValue({
      onMessage: { addListener: (listener: (event: any) => void) => listeners.push(listener) },
      onDisconnect: { addListener: vi.fn() },
      postMessage: () => queueMicrotask(() => {
        const text = '選項｜甲｜乙｜丙\n答案｜2\n忙翻';
        listeners.forEach((listener) => listener({ type: 'delta', delta: text }));
        listeners.forEach((listener) => listener({ type: 'done', result: { ok: true, text } }));
      }),
      disconnect: vi.fn(),
    } as any);

    await contentScript.main(new ContentScriptContext('test'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));

    await vi.waitFor(() => expect(card.choices).toEqual(['甲', '乙', '丙']));
    expect(card.body).not.toContain('答案｜');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }));

    await vi.waitFor(() => expect(card.body).toContain('答對了'));
    expect(card.body).toContain('忙翻');
    expect(recorded.some((m) => m.type === 'recordQuiz' && m.picked === 1 && m.right === 1)).toBe(true);
  });

  it('guessFirst 開啟時,選項出現後按 A 直接跳過,不寫入 quizLog', async () => {
    const listeners: Array<(event: any) => void> = [];
    vi.spyOn(fakeBrowser.runtime, 'connect').mockReturnValue({
      onMessage: { addListener: (listener: (event: any) => void) => listeners.push(listener) },
      onDisconnect: { addListener: vi.fn() },
      postMessage: () => queueMicrotask(() => {
        const text = '選項｜甲｜乙｜丙\n答案｜2\n忙翻';
        listeners.forEach((listener) => listener({ type: 'delta', delta: text }));
        listeners.forEach((listener) => listener({ type: 'done', result: { ok: true, text } }));
      }),
      disconnect: vi.fn(),
    } as any);

    await contentScript.main(new ContentScriptContext('test'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));
    await vi.waitFor(() => expect(card.choices).toBeTruthy());

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));

    await vi.waitFor(() => expect(card.body).toBe('忙翻'));
    expect(card.choices).toBeUndefined();
    expect(recorded.some((m) => m.type === 'recordQuiz')).toBe(false);
  });

  it('guessFirst 關閉時,卡片不含答案｜也不顯示選項', async () => {
    guessFirst = false;
    const listeners: Array<(event: any) => void> = [];
    vi.spyOn(fakeBrowser.runtime, 'connect').mockReturnValue({
      onMessage: { addListener: (listener: (event: any) => void) => listeners.push(listener) },
      onDisconnect: { addListener: vi.fn() },
      postMessage: () => queueMicrotask(() => {
        const text = '選項｜甲｜乙｜丙\n答案｜2\n忙翻';
        listeners.forEach((listener) => listener({ type: 'delta', delta: text }));
        listeners.forEach((listener) => listener({ type: 'done', result: { ok: true, text } }));
      }),
      disconnect: vi.fn(),
    } as any);

    await contentScript.main(new ContentScriptContext('test'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));

    await vi.waitFor(() => expect(card.body).toBe('忙翻'));
    expect(card.body).not.toContain('答案｜');
    expect(card.choices).toBeUndefined();
  });

  it('題目從頭到尾沒有解析出來時,A 仍會對游標下的字重新查詞,不會被誤判成跳過鍵', async () => {
    let lookups = 0;
    const listeners: Array<(event: any) => void> = [];
    vi.spyOn(fakeBrowser.runtime, 'connect').mockImplementation(() => {
      lookups++;
      return {
        onMessage: { addListener: (listener: (event: any) => void) => listeners.push(listener) },
        onDisconnect: { addListener: vi.fn() },
        postMessage: () => queueMicrotask(() => {
          listeners.forEach((listener) => listener({ type: 'delta', delta: '忙翻' }));
          listeners.forEach((listener) => listener({ type: 'done', result: { ok: true, text: '忙翻' } }));
        }),
        disconnect: vi.fn(),
      } as any;
    });

    await contentScript.main(new ContentScriptContext('test'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 1 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));
    await vi.waitFor(() => expect(card.body).toBe('忙翻'));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));

    await vi.waitFor(() => expect(lookups).toBe(2));
  });
```

- [ ] **Step 9: 執行測試確認全部通過**

Run: `pnpm vitest run src/content/highlight-content.test.ts`
Expected: PASS，全部 6 個測試（既有 1 個、Task 4 加的 1 個、本步驟 4 個）都通過。

- [ ] **Step 10: 全專案測試與型別檢查**

Run: `pnpm test`
Expected: PASS。

Run: `pnpm typecheck`
Expected: 無錯誤。

Run: `pnpm build`
Expected: 建置成功，無錯誤。

- [ ] **Step 11: 端到端手動 QA**

Run: `pnpm dev`（啟動 WXT 開發模式），依終端機提示在 Chrome 的 `chrome://extensions` 載入 `.output` 目錄的未封裝擴充功能（或用 WXT 印出的自動載入網址）。

在一個真實網頁上手動驗證：

1. 開著 `guessFirst`（options 頁預設勾選），對一個生詞按 `A`：卡片先出現三個選項按鈕，不含 `答案｜` 字樣。
2. 用滑鼠點一個選項，或按 `1`／`2`／`3`：卡片頂端出現「答對了！」或「答錯了，正解是…」，其下接著完整定義；若此時串流還沒結束，定義內容會持續更新，診斷那行不變。
3. 對另一個生詞按 `A`，選項還沒出現前就按 `A`：直接看到完整定義，沒有選項畫面。
4. 點卡片的重試鈕（↻）：已揭曉的卡片重問後仍維持揭曉狀態，不會退回選擇題。
5. 到 options 頁把「查詞先猜再揭曉」關閉，回頁面對生詞按 `A`：卡片直接顯示完整定義，沒有選項按鈕。
6. 到「今晚打老虎」與「我的攔路虎」分頁確認舊有卡片的內容不含 `選項｜`／`答案｜` 字樣（驗證 Task 4 的剝除仍然生效）。

若任一項不符預期，回頭檢查對應 Step 的程式碼，不要跳過這一步就視為完成。

- [ ] **Step 12: Commit**

```bash
git add entrypoints/highlight.content.ts src/content/highlight-content.test.ts
git commit -m "feat: 查詞卡加上先猜再揭曉的三選一互動"
```

---

## 驗收清單

全部 Task 完成後，執行：

```bash
pnpm test
pnpm typecheck
pnpm build
```

三者都要通過，且步驟 11 的手動 QA 六項都要過一遍，才算這個第二批交付完成。
