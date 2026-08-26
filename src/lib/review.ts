const DAY = 24 * 60 * 60 * 1000;
const INTERVAL_DAYS = [1, 3, 7, 14, 30] as const;

export function nextReview(
  currentStep: number,
  remembered: boolean,
  now = Date.now(),
): { reviewStep: number; reviewDueAt: number } {
  const reviewStep = remembered
    ? Math.min(Math.max(currentStep, 0) + 1, INTERVAL_DAYS.length)
    : 0;
  const interval = remembered ? INTERVAL_DAYS[reviewStep - 1]! : INTERVAL_DAYS[0];
  return { reviewStep, reviewDueAt: now + interval * DAY };
}
