/**
 * 不規則變化表。只收高頻的,長尾交給後綴規則加詞典驗證。
 * 這張表刻意保持小,因為每多一筆就多一份維護成本,而規則能處理九成以上的情況。
 */
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

/** 產生候選原形,由呼叫端的詞典決定採用哪一個 */
function candidates(word: string): string[] {
  const out: string[] = [];

  if (word.endsWith('ies') && word.length > 4) {
    out.push(word.slice(0, -3) + 'y');
  }
  if (word.endsWith('es') && word.length > 3) {
    out.push(word.slice(0, -2));
  }
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) {
    out.push(word.slice(0, -1));
  }
  // 動名詞的字根一定含母音。thing -> th、bring -> br 沒有母音,那是原形不是變化形。
  if (word.endsWith('ing') && word.length > 4 && /[aeiou]/.test(word.slice(0, -3))) {
    const stem = word.slice(0, -3);
    out.push(stem + 'e');      // using -> use、hoping -> hope
    out.push(stem);            // deploying -> deploy
    if (stem.length > 2 && stem.at(-1) === stem.at(-2)) {
      out.push(stem.slice(0, -1)); // stopping -> stop
    }
  }
  if (word.endsWith('ed') && word.length > 4) {
    const stem = word.slice(0, -2);
    out.push(stem + 'e');      // used -> use、hoped -> hope
    out.push(stem);            // deployed -> deploy
    if (stem.length > 2 && stem.at(-1) === stem.at(-2)) {
      out.push(stem.slice(0, -1)); // stopped -> stop
    }
  }
  if (word.endsWith('ied') && word.length > 4) {
    out.push(word.slice(0, -3) + 'y'); // carried -> carry
  }

  return out;
}

/**
 * 把一個 token 還原成原形。
 *
 * 策略:不規則表優先,再用後綴規則產生候選,最後由 isKnownWord 決定採用哪個。
 * 沒有任何候選通過驗證時退回原字,這是刻意的保守做法。寧可漏還原一個字
 * (使用者多標記一次),也不要把 university 錯還原成 universit(整個字查不到)。
 */
export function lemmatize(
  token: string,
  isKnownWord: (w: string) => boolean,
): string {
  const word = token.toLowerCase();

  // 不規則表要先查。is、am、be 這類字只有兩個字母,擋在長度判斷後面就永遠查不到。
  const irregular = IRREGULAR[word];
  if (irregular) return irregular;

  if (word.length < 3) return word;

  for (const candidate of candidates(word)) {
    if (candidate.length >= 2 && isKnownWord(candidate)) return candidate;
  }

  return word;
}
