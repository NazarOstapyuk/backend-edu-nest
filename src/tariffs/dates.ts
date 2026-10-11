const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (value: number) => String(value).padStart(2, '0');

export const toDay = (value: Date | string): Date => {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
};

export const addDays = (day: Date, days: number): Date =>
  new Date(day.getTime() + days * DAY_MS);

export const dayCount = (from: Date, to: Date): number =>
  Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;

export const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

export const monthDay = (year: number, month: number, day: number): Date => {
  const normalized = new Date(Date.UTC(year, month, 1));
  const y = normalized.getUTCFullYear();
  const m = normalized.getUTCMonth();
  return new Date(Date.UTC(y, m, Math.min(day, daysInMonth(y, m))));
};

export const firstDayOfMonth = (day: Date): Date =>
  new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));

export const lastDayOfMonth = (day: Date): Date =>
  new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0));

export const maxDay = (a: Date, b: Date): Date =>
  a.getTime() >= b.getTime() ? a : b;

export const minDay = (a: Date, b: Date): Date =>
  a.getTime() <= b.getTime() ? a : b;

export const isoDay = (day: Date): string => day.toISOString().slice(0, 10);

export const uaDay = (day: Date): string =>
  `${pad(day.getUTCDate())}.${pad(day.getUTCMonth() + 1)}.${day.getUTCFullYear()}`;

export const overlaps = (
  aStart: Date,
  aEnd: Date | null,
  bStart: Date,
  bEnd: Date | null,
): boolean =>
  (bEnd === null || aStart.getTime() <= bEnd.getTime()) &&
  (aEnd === null || bStart.getTime() <= aEnd.getTime());

export const kyivToday = (now: Date = new Date()): Date => {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return new Date(`${iso}T00:00:00.000Z`);
};
