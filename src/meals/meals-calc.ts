import { addDays, dayCount } from '../tariffs/dates';
import { isoWeekday } from '../timetable/schedule-calc';

export interface PriceLike {
  complexId: string;
  priceCategoryId: string;
  validFrom: Date;
}

export interface DishLike {
  id: string;
  courseId: string;
}

export type ChoiceError =
  | 'course_missing'
  | 'choice_required'
  | 'invalid_choice';

export type ChoiceResult =
  | { items: { courseId: string; dishId: string }[] }
  | { error: ChoiceError };

export const choiceErrorMessage: Record<ChoiceError, string> = {
  course_missing: 'Complex is not available on this day',
  choice_required: 'Dish choice is required',
  invalid_choice: 'Invalid dish choice',
};

const MINUTE_MS = 60 * 1000;

export function parseTime(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

const kyivOffsetMinutes = (instant: Date): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Kyiv',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
  );
  return Math.round((asUtc - instant.getTime()) / MINUTE_MS);
};

export function deadlineFor(date: Date, hhmm: string): Date {
  const minutes = parseTime(hhmm) ?? 0;
  const guess = new Date(date.getTime() + minutes * MINUTE_MS);
  return new Date(guess.getTime() - kyivOffsetMinutes(guess) * MINUTE_MS);
}

export const isBeforeDeadline = (
  date: Date,
  hhmm: string,
  now: Date,
): boolean => now.getTime() < deadlineFor(date, hhmm).getTime();

export function priceOn<T extends PriceLike>(
  prices: T[],
  complexId: string,
  categoryId: string,
  date: Date,
): T | null {
  let best: T | null = null;
  for (const price of prices) {
    if (
      price.complexId !== complexId ||
      price.priceCategoryId !== categoryId ||
      price.validFrom.getTime() > date.getTime()
    )
      continue;
    if (!best || price.validFrom.getTime() > best.validFrom.getTime())
      best = price;
  }
  return best;
}

export function resolveChoices(
  courseIds: string[],
  dishes: DishLike[],
  picked: string[],
): ChoiceResult {
  const byId = new Map(dishes.map((d) => [d.id, d]));
  const pickedByCourse = new Map<string, string>();
  for (const id of picked) {
    const dish = byId.get(id);
    if (
      !dish ||
      !courseIds.includes(dish.courseId) ||
      pickedByCourse.has(dish.courseId)
    )
      return { error: 'invalid_choice' };
    pickedByCourse.set(dish.courseId, id);
  }
  const items: { courseId: string; dishId: string }[] = [];
  for (const courseId of courseIds) {
    const options = dishes.filter((d) => d.courseId === courseId);
    if (!options.length) return { error: 'course_missing' };
    const pickedId = pickedByCourse.get(courseId);
    if (pickedId) items.push({ courseId, dishId: pickedId });
    else if (options.length === 1)
      items.push({ courseId, dishId: options[0].id });
    else return { error: 'choice_required' };
  }
  return { items };
}

export const mondayOf = (day: Date): Date => addDays(day, 1 - isoWeekday(day));

export function templateWeek(
  from: Date,
  startWeek: number,
  weeks: number,
  day: Date,
): number {
  const diff = Math.round(
    (mondayOf(day).getTime() - mondayOf(from).getTime()) /
      (7 * 24 * 60 * MINUTE_MS),
  );
  return ((((startWeek - 1 + diff) % weeks) + weeks) % weeks) + 1;
}

export const copyTarget = (fromStart: Date, toStart: Date, day: Date): Date =>
  addDays(toStart, dayCount(fromStart, day) - 1);
