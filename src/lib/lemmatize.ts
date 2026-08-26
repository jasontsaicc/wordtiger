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
  // 避免將 thing、bring 誤判為 -ing 變化。
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

/** 不規則表優先，再以詞典驗證後綴候選；無有效候選時保留原字。 */
export function lemmatize(
  token: string,
  isKnownWord: (w: string) => boolean,
): string {
  const word = token.toLowerCase();

  // 短字也可能是不規則變化，必須先於長度檢查。
  const irregular = IRREGULAR[word];
  if (irregular) return irregular;

  if (word.length < 3) return word;

  for (const candidate of candidates(word)) {
    if (candidate.length >= 2 && isKnownWord(candidate)) return candidate;
  }

  return word;
}
