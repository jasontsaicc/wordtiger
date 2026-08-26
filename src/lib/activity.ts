export interface ActivityWord {
  word: string;
  createdAt: number;
  contexts: Array<{ createdAt: number; url: string; title: string }>;
}

export interface DayActivity {
  date: string;
  newWords: string[];
  pages: Array<{ url: string; title: string; words: string[] }>;
}

export function localDay(time: number): string {
  const date = new Date(time);
  const part = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}`;
}

export function groupActivity(words: ActivityWord[]): DayActivity[] {
  const days = new Map<string, {
    newWords: Set<string>;
    pages: Map<string, { title: string; words: Set<string> }>;
  }>();
  const day = (date: string) => {
    if (!days.has(date)) days.set(date, { newWords: new Set(), pages: new Map() });
    return days.get(date)!;
  };

  for (const item of words) {
    day(localDay(item.createdAt)).newWords.add(item.word);
    for (const context of item.contexts) {
      if (!context.url) continue;
      const current = day(localDay(context.createdAt));
      const page = current.pages.get(context.url)
        ?? { title: context.title, words: new Set<string>() };
      page.words.add(item.word);
      current.pages.set(context.url, page);
    }
  }

  return [...days].map(([date, activity]) => ({
    date,
    newWords: [...activity.newWords].sort(),
    pages: [...activity.pages].map(([url, page]) => ({
      url, title: page.title, words: [...page.words].sort(),
    })),
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
