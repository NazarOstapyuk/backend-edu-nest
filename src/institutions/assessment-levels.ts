export type LevelInput = { name: string; code: string; minPercent: number };

export const MAX_LEVELS = 10;

export function validateLevels(levels: LevelInput[]): string | null {
  if (levels.length > MAX_LEVELS) return 'Too many levels';
  const bounds = new Set<number>();
  for (const level of levels) {
    const name = level.name.trim();
    const code = level.code.trim();
    if (
      name.length < 1 ||
      name.length > 50 ||
      code.length < 1 ||
      code.length > 5 ||
      !Number.isInteger(level.minPercent) ||
      level.minPercent < 0 ||
      level.minPercent > 100
    ) {
      return 'Invalid level';
    }
    if (bounds.has(level.minPercent)) return 'Duplicate level bound';
    bounds.add(level.minPercent);
  }
  return null;
}

export function levelFor(
  levels: { name: string; code: string; minPercent: number }[],
  percent: number,
): { name: string; code: string } | null {
  let best: { name: string; code: string; minPercent: number } | null = null;
  for (const level of levels) {
    if (
      level.minPercent <= percent &&
      (!best || level.minPercent > best.minPercent)
    ) {
      best = level;
    }
  }
  return best ? { name: best.name, code: best.code } : null;
}
