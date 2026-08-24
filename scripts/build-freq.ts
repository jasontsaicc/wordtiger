import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

export interface FreqEntry {
  word: string;
  count: number;
}

/**
 * entries 必須已按 count 由大到小排序(subtlex-word-frequencies 本來就是)。
 * rank 直接取名次,不取 count,因為使用者調的是「前幾名」不是「出現幾次」。
 */
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

// 只有直接執行這支腳本時才產檔。被 test import 時不執行。
if (process.argv[1]?.endsWith('build-freq.ts')) {
  // 套件是純 JSON,ESM 下的 import 需要 import attribute,用 createRequire 省事
  const entries: FreqEntry[] = createRequire(import.meta.url)('subtlex-word-frequencies');
  const map = buildFreqMap(entries, 30000);
  writeFileSync('public/freq.json', JSON.stringify(map));
  console.log(`寫入 ${Object.keys(map).length} 筆到 public/freq.json`);
}
