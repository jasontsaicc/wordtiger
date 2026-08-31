# 複習語境輪替 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 今晚打老虎的複習題目改用 `fsrsCard.reps` 取餘數輪替該字的語境，同一個字連續幾輪就換幾種句子，不再永遠卡在同一句或整批單字都退化成零語境。

**Architecture:** `listReviewItems` 目前用一個扁平陣列建 `latest: Map<word, ContextRow>`，片語走「最新一筆」、單字走「逐字比對 `definition.sentence`」兩條分岔路徑，且沒有處理零筆語境的除以零。改成先把 `contexts` 依字分組並依 `createdAt` 排序成 `Map<word, ContextRow[]>`，片語與單字統一走 `list[(reps ?? 0) % list.length]`，並在 `list.length === 0` 時退回既有的 `definition.sentence` fallback。額外新增 `ReviewItem.definitionSentence` 欄位，只在詞典解釋當時看到的句子跟本次出題語境不同時才帶出，`ReviewSession.vue` 在揭曉區塊顯示這個提示。

**Tech Stack:** TypeScript、Dexie（IndexedDB）、Vue 3、Vitest + fake-indexeddb + jsdom。

**Spec:** `docs/superpowers/specs/2026-08-30-guess-first-design.md`（本計畫只實作「決策七：複習語境用 `reps` 取餘數輪替」與它提到的 `ReviewItem.definitionSentence` 欄位、UI）

## Global Constraints

- 只做決策七與 `ReviewItem.definitionSentence`，不動決策一到六（三選一延遲揭曉、`quizLog`、`prompt.ts`、`guessFirst` 設定）的任何程式碼，那是第二批。
- 不新增 Dexie schema 版本，不新增任何資料表，本批不改 `db.ts` 的 `version()` 宣告。
- 不改 `sync.ts`；`definition.sentence` 缺少（模擬同步裝置）時仍要能輪替語境，這件事完全靠 `listReviewItems` 內部邏輯修正，不靠搬運欄位。
- `reps` 只有在 `recordReview` 成功時才前進；`fsrsCard` 損壞時該字會一直拿到同一句，這是已知且可接受的行為，不用特別處理。
- git commit 訊息只有一行 subject，不加 body、不加 `Co-Authored-By`、不加任何 AI 署名。
- 驗證指令：`pnpm test`（全部）、`pnpm vitest run src/lib/db.test.ts`（單檔）、`pnpm vitest run src/lib/db.test.ts -t "測試名稱"`（單一測試）、`pnpm typecheck`（型別檢查）。

---

## File Structure

- `src/lib/db.ts`：`ReviewItem` 介面新增 `definitionSentence?: string`；重寫 `listReviewItems` 的語境選取邏輯。這是本批唯一的邏輯變更點，其餘檔案都是消費它的輸出。
- `src/lib/db.test.ts`：在既有的 `describe('今晚打老虎', ...)` 區塊內新增測試，緊接在既有 `listReviewItems` 測試（第 296-369 行）之後、`recordReview` 測試（第 371 行起）之前。
- `entrypoints/options/ReviewSession.vue`：揭曉區塊加一行「詞典解釋的是這句」提示，只在 `item.definitionSentence` 有值時顯示。

## Task 1: `listReviewItems` 改用 `reps` 輪替語境，新增 `definitionSentence`

**Files:**
- Modify: `src/lib/db.ts:33-41`（`ReviewItem` 介面）
- Modify: `src/lib/db.ts:238-296`（`listReviewItems`）
- Test: `src/lib/db.test.ts`（插入點：第 369 行 `});` 之後、第 371 行 `it('自評後寫入 FSRS 卡片...'` 之前）

**Interfaces:**
- Consumes：`ContextRow`（`src/lib/db.ts:43-53`，含 `sentence`、`url`、`title`、`createdAt`）、`CacheRow.sentence?: string`（`src/lib/db.ts:85`）、`StoredFsrsCard.reps: number`（`src/lib/review.ts:19`）、`canAnswer(word, hasDefinition, hasContext)`（`src/lib/review.ts:112`）。
- Produces：`ReviewItem.definitionSentence?: string`，第二批的 `ReviewSession.vue` 與其他 `ReviewItem` 消費端都讀這個欄位；`listReviewItems(limit = 5, now = Date.now()): Promise<ReviewItem[]>` 簽名不變。

- [ ] **Step 1: 在 `src/lib/db.ts` 的 `ReviewItem` 介面新增 `definitionSentence` 欄位**

```ts
export interface ReviewItem {
  word: string;
  surface?: string;
  isPhrase: boolean;
  isPattern: boolean;
  canMaster: boolean;
  definition: string;
  context?: Pick<ContextRow, 'sentence' | 'url' | 'title'>;
  /**
   * 詞典解釋當時看到的原句（`definition.sentence`）。
   * 只在跟輪替後的出題語境不同時才有值；同步下來的裝置上可能缺少。
   */
  definitionSentence?: string;
}
```

- [ ] **Step 2: 寫失敗測試，插入 `src/lib/db.test.ts` 第 369 行之後**

在既有的 `describe('今晚打老虎', ...)` 區塊內，緊接著第 369 行的 `});`（「單字題使用產生答案時的句子，不混用最新語境」測試結尾）之後插入：

```ts
  it('複習語境依 reps 取餘數輪替，同一個字連續三輪拿到三個不同語境', async () => {
    await markWord('deploy', 'unknown');
    await putCached([{ word: 'deploy', payload: '部署' }]);
    const sentences = [
      'We deploy to production every single Friday night.',
      'They deploy the service to staging first every morning.',
      'The team will deploy a hotfix within the hour tonight.',
    ];
    for (const sentence of sentences) {
      await addContext({ word: 'deploy', sentence, url: 'u', title: 't' });
    }

    for (let reps = 0; reps < 3; reps++) {
      await db.words.update('deploy', { fsrsCard: card(0, { reps }) });
      const [item] = await listReviewItems();
      expect(item!.context?.sentence).toBe(sentences[reps]);
    }
  });

  it('只有一筆語境時不出錯', async () => {
    await markWord('deploy', 'unknown');
    await putCached([{ word: 'deploy', payload: '部署' }]);
    await addContext({
      word: 'deploy', sentence: 'We deploy to production every single Friday night.',
      url: 'u', title: 't',
    });
    // reps 遠大於語境筆數也要能正確取餘數，不能整個掛掉。
    await db.words.update('deploy', { fsrsCard: card(0, { reps: 5 }) });

    const [item] = await listReviewItems();
    expect(item!.context?.sentence).toBe('We deploy to production every single Friday night.');
  });

  it('零筆語境時退回 definition.sentence，不會因為除以零而消失', async () => {
    await markWord('deploy', 'unknown');
    await putCached([{
      word: 'deploy', payload: '部署',
      sentence: 'We deploy to production every single Friday night.',
    }]);

    const [item] = await listReviewItems();
    expect(item!.context).toEqual({
      sentence: 'We deploy to production every single Friday night.', url: '', title: '',
    });
  });

  it('definition.sentence 缺少時（模擬同步裝置）仍拿得到語境', async () => {
    await markWord('deploy', 'unknown');
    await putCached([{ word: 'deploy', payload: '部署' }]);
    await addContext({
      word: 'deploy', sentence: 'We deploy to production every single Friday night.',
      url: 'u', title: 't',
    });

    const [item] = await listReviewItems();
    expect(item!.context?.sentence).toBe('We deploy to production every single Friday night.');
  });

  it('definitionSentence 只在跟出題語境不同時才帶出', async () => {
    const contextSentence = 'We deploy to production every single Friday night.';
    await markWord('deploy', 'unknown');
    await addContext({ word: 'deploy', sentence: contextSentence, url: 'u', title: 't' });

    await putCached([{ word: 'deploy', payload: '部署', sentence: contextSentence }]);
    expect((await listReviewItems())[0]!.definitionSentence).toBeUndefined();

    await putCached([{
      word: 'deploy', payload: '部署',
      sentence: 'The certificate authority will issue a new certificate tomorrow.',
    }]);
    expect((await listReviewItems())[0]!.definitionSentence)
      .toBe('The certificate authority will issue a new certificate tomorrow.');
  });

  it('片語也依 reps 輪替語境', async () => {
    await markWord('roll back', 'unknown');
    await putCached([{ word: 'roll back', payload: '## 核心意思\n- 回滾變更' }]);
    const sentences = [
      'We should roll back this release right now.',
      'They rolled back the migration after the outage.',
    ];
    for (const sentence of sentences) {
      await addContext({ word: 'roll back', sentence, url: 'u', title: 't' });
    }

    await db.words.update('roll back', { fsrsCard: card(0, { reps: 0 }) });
    expect((await listReviewItems())[0]!.context?.sentence).toBe(sentences[0]);
    await db.words.update('roll back', { fsrsCard: card(0, { reps: 1 }) });
    expect((await listReviewItems())[0]!.context?.sentence).toBe(sentences[1]);
  });

```

這些測試用到的 `card()` 是這個 `describe` 區塊本來就有的 fixture（`src/lib/db.test.ts:191-203`），不用另外定義。

- [ ] **Step 3: 執行新測試，確認會紅燈的都紅燈**

Run: `pnpm vitest run src/lib/db.test.ts`

Expected：Step 2 新增的六個測試裡，五個 FAIL：
- 「複習語境依 reps 取餘數輪替，同一個字連續三輪拿到三個不同語境」：舊邏輯不看 `reps`，單字沒有 `definition.sentence` 時 `context` 直接是 `undefined`。
- 「只有一筆語境時不出錯」：同上，舊邏輯在 `definition.sentence` 缺席時不會退回那唯一一筆語境。
- 「definition.sentence 缺少時（模擬同步裝置）仍拿得到語境」：這正是 spec 描述的同步裝置退化成零語境的那個 bug，舊邏輯下 `context` 是 `undefined`。
- 「definitionSentence 只在跟出題語境不同時才帶出」：舊版 `listReviewItems` 從不設定這個欄位，第二段斷言會拿到 `undefined` 而不是預期的句子。
- 「片語也依 reps 輪替語境」：舊邏輯片語永遠拿 `latest`（依 `createdAt` 最新那筆），不看 `reps`。

「零筆語境時退回 `definition.sentence`，不會因為除以零而消失」這一個測試會 PASS：舊邏輯在完全沒有語境列時，本來就會落到 `definition?.sentence` 的合成 fallback，跟新邏輯的長度守衛殊途同歸。留著這個測試是為了在 Step 4 重寫時確保這條路徑沒有被改壞，不是每個新測試都必須紅燈。

- [ ] **Step 4: 重寫 `listReviewItems`（`src/lib/db.ts:238-296`）**

把整個函式換成：

```ts
export async function listReviewItems(limit = 5, now = Date.now()): Promise<ReviewItem[]> {
  const candidates = (await db.words
    .filter((row) => {
      const due = dueAt(row.fsrsCard);
      return row.deletedAt === null
        && row.status === 'unknown'
        && (due === undefined || due <= now);
    })
    .toArray())
    .sort(byReviewOrder);
  if (!candidates.length) return [];

  const words = candidates.map((row) => row.word);
  const wanted = new Set(words);
  const [contexts, caches] = await Promise.all([
    db.contexts.filter((row) => row.deletedAt === null && wanted.has(row.word)).toArray(),
    db.lookupCache.where('word').anyOf(words)
      .filter((row) => row.deletedAt === null).toArray(),
  ]);
  // 依字分組並由舊到新排序，語境才能用 reps 取餘數輪替；片語與單字共用同一份分組。
  const byWord = new Map<string, ContextRow[]>();
  for (const row of contexts) {
    const list = byWord.get(row.word);
    if (list) list.push(row); else byWord.set(row.word, [row]);
  }
  for (const list of byWord.values()) list.sort((a, b) => a.createdAt - b.createdAt);
  const definitions = new Map(caches.map((row) => [row.word, row]));

  const items: ReviewItem[] = [];
  for (const row of candidates) {
    const isPhrase = /\s/.test(row.word);
    const definition = definitions.get(row.word);
    const list = byWord.get(row.word) ?? [];
    // canAnswer 已保證有詞典，但 TS 追不進函式，之後的 definition 用 ! 取用。
    if (!canAnswer(row.word, Boolean(definition), list.length > 0)) continue;

    // 零筆語境時 % 0 會是 NaN，用長度守衛退回 definition.sentence。
    const rotated = list.length ? list[(row.fsrsCard?.reps ?? 0) % list.length] : undefined;
    const reviewContext = rotated
      ? { sentence: rotated.sentence, url: rotated.url, title: rotated.title }
      : definition?.sentence
        ? { sentence: definition.sentence, url: '', title: '' }
        : undefined;
    const isPattern = Boolean(isPhrase && reviewContext
      && !reviewContext.sentence.toLowerCase().includes(row.word.toLowerCase()));
    // 詞典解釋的是 definition.sentence；只在跟輪替後的出題語境不同時才帶出，
    // 否則單一語境的常見情況會多出一行雜訊。
    const definitionSentence = definition?.sentence && definition.sentence !== reviewContext?.sentence
      ? definition.sentence
      : undefined;
    items.push({
      word: row.word,
      surface: definition!.surface,
      isPhrase,
      isPattern,
      canMaster: (row.fsrsCard?.scheduled_days ?? 0) >= MASTER_INTERVAL_DAYS
        || (row.reviewStep ?? 0) >= LEGACY_MASTER_STEP,
      definition: definition!.payload,
      context: reviewContext,
      definitionSentence,
    });
    if (items.length === limit) break;
  }
  return items;
}
```

這個改動刪掉了舊版的 `latest` map（`src/lib/db.ts:257-261`）與 `isPhrase` 分支（舊版 `src/lib/db.ts:270-275`），統一走 `list[(reps ?? 0) % list.length]` 一條路徑；`isPattern` 的算法原樣保留。

- [ ] **Step 5: 改寫既有測試「單字題使用產生答案時的句子，不混用最新語境」**

`src/lib/db.test.ts:348-369` 這個測試在新邏輯下**會通過，但是通過的理由是錯的**。它先加 `answerSentence` 再加另一句，所以 `answerSentence` 剛好是 `createdAt` 最舊的那筆，`reps` 預設 0 時 `list[0]` 正好命中。也就是說它現在靠 fixture 的順序巧合而綠燈，測試名稱宣告的契約（「使用產生答案時的句子」）卻正是新設計刻意放棄的那條。留著它，下一個人只要對調兩個 `addContext` 就會看到一個名稱完全解釋不了的紅燈。

把 `src/lib/db.test.ts:348-369` 整段換成：

```ts
  it('reps 為 0 時取最舊的語境，不是最新的', async () => {
    const oldest = 'The certificate authority will issue a new certificate tomorrow.';
    await markWord('issue', 'unknown');
    await putCached([{
      word: 'issue', surface: 'issued', payload: '核發', sentence: oldest,
    }]);
    await addContext({
      word: 'issue', sentence: oldest,
      url: 'https://example.com/cert', title: 'Certificate guide',
    });
    await addContext({
      word: 'issue', sentence: 'A production issue interrupted the deployment this morning.',
      url: 'https://example.com/incident', title: 'Incident',
    });

    expect(await listReviewItems()).toEqual([
      expect.objectContaining({
        word: 'issue', surface: 'issued', definition: '核發',
        context: expect.objectContaining({ sentence: oldest, title: 'Certificate guide' }),
        // 出題語境剛好就是詞典看到的那句，不必多印一行提示。
        definitionSentence: undefined,
      }),
    ]);
  });
```

Fixture 保持兩筆語境不變，那正是「最舊」與「最新」唯一能分辨的地方。

- [ ] **Step 6: 執行新測試，確認全部通過**

Run: `pnpm vitest run src/lib/db.test.ts`

Expected: PASS，包含 Step 2 新增的六個測試、Step 5 改寫的那個測試，以及檔案裡原有的其餘測試。其餘既有測試不需要改動：它們的字要嘛零筆語境、要嘛只有一筆，`reps` 預設 0 時取到的結果跟舊邏輯相同。

- [ ] **Step 7: 跑全專案測試與型別檢查**

Run: `pnpm test`

Expected: 全部 PASS，無新增失敗。

Run: `pnpm typecheck`

Expected: 無錯誤（`ReviewItem.definitionSentence` 是選填欄位，既有建構 `ReviewItem` 的地方不用逐一補上這個欄位也能通過型別檢查；本函式內已明確賦值）。

- [ ] **Step 8: Commit**

```bash
git add src/lib/db.ts src/lib/db.test.ts
git commit -m "feat: 打老虎的語境依複習次數輪替"
```

## Task 2: `ReviewSession.vue` 顯示「詞典解釋的是這句」提示

**Files:**
- Modify: `entrypoints/options/ReviewSession.vue:125-131`（揭曉區塊）
- Modify: `entrypoints/options/ReviewSession.vue:154-200`（`<style scoped>`）
- Test: 無自動化元件測試（repo 內沒有 `.vue` 測試基礎設施，既有的 `ReviewSession.vue` 從未被任何 `*.test.ts` 覆蓋），本任務用 `pnpm typecheck` 與手動檢視作為驗證，不新增測試框架。

**Interfaces:**
- Consumes：Task 1 產生的 `ReviewItem.definitionSentence?: string`（`src/lib/db.ts`）。

- [ ] **Step 1: 在揭曉區塊加上提示行**

修改 `entrypoints/options/ReviewSession.vue` 第 125-131 行，在 `<div v-html="renderMarkdown(item.definition)" />` 之前插入一行：

```html
      <div v-else class="answer" aria-live="polite">
        <p v-if="item.isPhrase" class="answer-label">老師回饋</p>
        <p v-if="item.definitionSentence" class="definition-note">
          詞典解釋的是這句：{{ item.definitionSentence }}
        </p>
        <div v-html="renderMarkdown(item.definition)" />

        <a v-if="item.context?.url" :href="item.context.url" target="_blank" rel="noreferrer">
          {{ item.context.title || '查看來源' }}
        </a>
```

只在 `item.definitionSentence` 有值時顯示；`db.ts` 已經保證它只在跟出題語境不同時才有值，同步裝置上沒有這個欄位時 `v-if` 直接不渲染，不用另外判斷。

- [ ] **Step 2: 加上對應樣式**

在 `<style scoped>` 區塊裡，緊接在 `.answer-label` 那行（`entrypoints/options/ReviewSession.vue:181`）之後加入：

```css
.definition-note { margin: 0 0 .6rem; padding: .6rem .8rem; border-left: 3px solid #94a3b8; border-radius: 0 8px 8px 0; color: #475569; background: #f1f5f9; font-size: 13px; }
```

用灰色系與既有的 `blockquote`（青色左邊框，用來標示出題語境）區隔，避免使用者把兩種語境搞混。

- [ ] **Step 3: 型別檢查**

Run: `pnpm typecheck`

Expected: 無錯誤。

- [ ] **Step 4: 跑全專案測試，確認沒有連帶弄壞其他東西**

Run: `pnpm test`

Expected: 全部 PASS（這一步不新增測試案例，純粹回歸確認）。

- [ ] **Step 5: Commit**

```bash
git add entrypoints/options/ReviewSession.vue
git commit -m "feat: 複習卡片標出詞典解釋的原句跟輪替後的出題語境不同"
```
