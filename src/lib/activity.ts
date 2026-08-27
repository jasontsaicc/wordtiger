export interface ActivityWord {
  word: string;
  /** known 是「我認得，別再標」的排除記號，不是收藏。 */
  status: 'unknown' | 'known';
  createdAt: number;
  contexts: Array<{ createdAt: number; url: string; title: string }>;
}

export interface ReviewEvent {
  word: string;
  remembered: boolean;
  at: number;
}

export interface DayActivity {
  date: string;
  newWords: string[];
  pages: Array<{ url: string; title: string; words: string[] }>;
  /** 當天打老虎的成績；total 是練習次數，caught 是答對次數。 */
  reviews: Array<{ word: string; caught: number; total: number }>;
}

export function localDay(time: number): string {
  const date = new Date(time);
  const part = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}`;
}

export function groupActivity(
  words: ActivityWord[],
  events: ReviewEvent[] = [],
): DayActivity[] {
  const days = new Map<string, {
    newWords: Set<string>;
    pages: Map<string, { title: string; words: Set<string> }>;
    reviews: Map<string, { caught: number; total: number }>;
  }>();
  const day = (date: string) => {
    if (!days.has(date)) {
      days.set(date, { newWords: new Set(), pages: new Map(), reviews: new Map() });
    }
    return days.get(date)!;
  };

  for (const item of words) {
    // 標成已馴服的字不算收藏，否則按 X 排除生詞反而會多一筆「新收藏」。
    if (item.status === 'unknown') day(localDay(item.createdAt)).newWords.add(item.word);
    for (const context of item.contexts) {
      if (!context.url) continue;
      const current = day(localDay(context.createdAt));
      const page = current.pages.get(context.url)
        ?? { title: context.title, words: new Set<string>() };
      page.words.add(item.word);
      current.pages.set(context.url, page);
    }
  }

  for (const event of events) {
    const current = day(localDay(event.at)).reviews;
    const score = current.get(event.word) ?? { caught: 0, total: 0 };
    score.total += 1;
    if (event.remembered) score.caught += 1;
    current.set(event.word, score);
  }

  return [...days].map(([date, activity]) => ({
    date,
    newWords: [...activity.newWords].sort(),
    pages: [...activity.pages].map(([url, page]) => ({
      url, title: page.title, words: [...page.words].sort(),
    })),
    reviews: [...activity.reviews]
      .map(([word, score]) => ({ word, ...score }))
      .sort((a, b) => a.word.localeCompare(b.word)),
  })).sort((a, b) => b.date.localeCompare(a.date));
}

export function monthCells(month: string): Array<{ date: string; day: number } | null> {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return [];
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return [];
  const cells: Array<{ date: string; day: number } | null> =
    Array.from({ length: new Date(year, monthIndex, 1).getDay() }, () => null);
  const total = new Date(year, monthIndex + 1, 0).getDate();
  for (let day = 1; day <= total; day++) {
    cells.push({ date: `${month}-${String(day).padStart(2, '0')}`, day });
  }
  return cells;
}
