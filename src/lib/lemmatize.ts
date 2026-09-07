/** 高頻不規則變化；長尾由後綴規則與詞典驗證處理。 */
const IRREGULAR: Record<string, string> = {
  am: 'be', is: 'be', are: 'be', was: 'be', were: 'be', been: 'be', being: 'be',
  has: 'have', had: 'have', having: 'have',
  does: 'do', did: 'do', done: 'do', doing: 'do',
  went: 'go', gone: 'go', goes: 'go',
  made: 'make', making: 'make',
  said: 'say', saying: 'say',
  took: 'take', taken: 'take', taking: 'take',
  came: 'come', coming: 'come',
  saw: 'see', seen: 'see', seeing: 'see',
  got: 'get', gotten: 'get', getting: 'get',
  gave: 'give', given: 'give', giving: 'give',
  found: 'find', finding: 'find',
  thought: 'think', thinking: 'think',
  told: 'tell', telling: 'tell',
  became: 'become', becoming: 'become',
  left: 'leave', leaving: 'leave',
  felt: 'feel', feeling: 'feel',
  put: 'put', putting: 'put',
  brought: 'bring', bringing: 'bring',
  began: 'begin', begun: 'begin', beginning: 'begin',
  kept: 'keep', keeping: 'keep',
  held: 'hold', holding: 'hold',
  wrote: 'write', written: 'write', writing: 'write',
  ran: 'run', running: 'run',
  children: 'child', men: 'man', women: 'woman', people: 'person',
  feet: 'foot', teeth: 'tooth', mice: 'mouse', geese: 'goose',
  better: 'good', best: 'good', worse: 'bad', worst: 'bad',
};

// ponytail: 3 倍頻率比是小型規則法的誤判護欄；案例不足前不引入 POS/NLP。
const MAX_INFLECTION_RANK_RATIO = 3;

// undertaken、withheld 這類字尾規則抓不到,拆掉前綴才對得上不規則表。長前綴優先,避免 undone 先被 un 吃掉。
const PREFIXES = ['under', 'over', 'fore', 'with', 'mis', 'out', 'up', 're', 'un'];

function candidates(word: string): string[] {
  const out: string[] = [];

  if (word.endsWith('ies') && word.length > 4) {
    out.push(word.slice(0, -3) + 'y');
  }
  // 只有嘶音字尾的複數才是補 e，notes、codes 的 e 屬於字幹本身。
  if (/(?:s|x|z|ch|sh)es$/.test(word) && word.length > 3) {
    out.push(word.slice(0, -2));
  }
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) {
    out.push(word.slice(0, -1));
  }
  // 避免將 thing、bring 誤判為 -ing 變化。
  if (word.endsWith('ing') && word.length > 4 && /[aeiou]/.test(word.slice(0, -3))) {
    const stem = word.slice(0, -3);
    if (stem.length > 2 && stem.at(-1) === stem.at(-2)) {
      out.push(stem);              // calling -> call
      out.push(stem.slice(0, -1)); // stopping -> stop、programming -> program
      out.push(stem + 'e');        // programming 需晚於 program 才不會變 programme
    } else {
      out.push(stem + 'e');        // using -> use、hoping -> hope
      out.push(stem);              // deploying -> deploy
    }
  }
  if (word.endsWith('ed') && word.length > 4) {
    const stem = word.slice(0, -2);
    if (stem.length > 2 && stem.at(-1) === stem.at(-2)) {
      out.push(stem);              // added -> add
      out.push(stem.slice(0, -1)); // stopped -> stop、slammed -> slam
      out.push(stem + 'e');
    } else {
      out.push(stem + 'e');        // used -> use、hoped -> hope
      out.push(stem);              // deployed -> deploy
    }
  }
  if (word.endsWith('ied') && word.length > 4) {
    out.push(word.slice(0, -3) + 'y'); // carried -> carry
  }

  return out;
}

/** 不規則表優先，再以詞典驗證後綴候選，最後試前綴不規則；都不成立時保留原字。 */
export function lemmatize(
  token: string,
  rankOf: (w: string) => number | undefined,
): string {
  const word = token.toLowerCase();

  // 短字也可能是不規則變化，必須先於長度檢查。
  const irregular = Object.hasOwn(IRREGULAR, word) ? IRREGULAR[word] : undefined;
  if (irregular) return irregular;

  if (word.length < 3) return word;

  const wordRank = rankOf(word);
  for (const candidate of candidates(word)) {
    const rank = rankOf(candidate);
    if (candidate.length >= 2 && rank !== undefined
      && (wordRank === undefined || rank < wordRank * MAX_INFLECTION_RANK_RATIO)) return candidate;
  }

  // 後綴規則交白卷才試前綴,undertaking 這種既有路徑不受影響。
  // 只信詞表驗證過的結果,unwritten → unwrite 這類偽陽性會在這裡被擋掉。
  for (const prefix of PREFIXES) {
    if (!word.startsWith(prefix)) continue;
    const rest = word.slice(prefix.length);
    if (!Object.hasOwn(IRREGULAR, rest)) continue;
    const lemma = prefix + IRREGULAR[rest];
    if (rankOf(lemma) !== undefined) return lemma;
  }

  return word;
}
