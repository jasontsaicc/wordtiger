import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

export interface FreqEntry {
  word: string;
  count: number;
}

/** 輸入依 count 降冪；輸出名次供詞頻門檻使用。 */
export function buildFreqMap(
  entries: FreqEntry[],
  limit: number,
): Record<string, number> {
  const map: Record<string, number> = {};
  let rank = 0;
  for (const entry of entries) {
    if (rank >= limit) break;
    if (!/^[a-zA-Z]+$/.test(entry.word)) continue;
    const key = entry.word.toLowerCase();
    if (key in map) continue;
    map[key] = ++rank;
  }
  return map;
}

// 測試 import 時不產檔。
if (process.argv[1]?.endsWith('build-freq.ts')) {
  // createRequire 直接載入套件 JSON。
  const entries: FreqEntry[] = createRequire(import.meta.url)('subtlex-word-frequencies');
  const map = buildFreqMap(entries, 30000);
  writeFileSync('public/freq.json', JSON.stringify(map));
  console.log(`寫入 ${Object.keys(map).length} 筆到 public/freq.json`);
}
