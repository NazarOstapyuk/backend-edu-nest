import { BadRequestException } from '@nestjs/common';
import {
  CalendarEntryLike,
  dayInfo,
  dayRange,
  GroupLike,
} from '../attendance/register-calc';
import { addDays, isoDay } from '../tariffs/dates';

export type RoutineItemInput = {
  startTime: string;
  endTime: string;
  title: string;
};

export type VersionLike = { validFrom: Date; validTo: Date | null };

export type RoutineDayView = {
  date: string;
  working: boolean;
  calendarTitle: string | null;
  source: 'template' | 'override' | 'none';
  workingHours: string | null;
  note: string | null;
  items: { startTime: string; endTime: string; title: string }[];
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function normalizeItems<T extends RoutineItemInput>(
  items: T[],
): (T & { sortOrder: number })[] {
  const prepared = items.map((item, index) => {
    if (
      !TIME.test(item.startTime) ||
      !TIME.test(item.endTime) ||
      item.endTime <= item.startTime
    )
      throw new BadRequestException('Invalid time range');
    return { item: { ...item, title: item.title.trim() }, index };
  });
  prepared.sort(
    (a, b) =>
      a.item.startTime.localeCompare(b.item.startTime) ||
      a.item.endTime.localeCompare(b.item.endTime) ||
      a.index - b.index,
  );
  return prepared.map(({ item }, sortOrder) => ({ ...item, sortOrder }));
}

export const versionOn = <T extends VersionLike>(
  versions: T[],
  day: Date,
): T | null =>
  versions.find(
    (v) =>
      v.validFrom.getTime() <= day.getTime() &&
      (v.validTo === null || day.getTime() <= v.validTo.getTime()),
  ) ?? null;

export function versionBounds(
  existing: { id: string; validFrom: Date; validTo: Date | null }[],
  validFrom: Date,
): {
  validTo: Date | null;
  close: { id: string; validTo: Date } | null;
} {
  const next = existing
    .filter((v) => v.validFrom.getTime() > validFrom.getTime())
    .sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime())[0];
  const covering = versionOn(existing, validFrom);
  return {
    validTo: next ? addDays(next.validFrom, -1) : null,
    close: covering
      ? { id: covering.id, validTo: addDays(validFrom, -1) }
      : null,
  };
}

export function resolveRoutine(input: {
  from: Date;
  to: Date;
  group: GroupLike;
  entries: CalendarEntryLike[];
  versions: (VersionLike & {
    workingHours: string | null;
    note: string | null;
    items: (RoutineItemInput & { weekday: number; sortOrder: number })[];
  })[];
  overrides: {
    date: Date;
    note: string | null;
    items: (RoutineItemInput & { sortOrder: number })[];
  }[];
}): RoutineDayView[] {
  const overrides = new Map(input.overrides.map((o) => [o.date.getTime(), o]));
  const byOrder = <T extends { sortOrder: number }>(rows: T[]) =>
    [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
  const shape = (rows: RoutineItemInput[]) =>
    rows.map(({ startTime, endTime, title }) => ({
      startTime,
      endTime,
      title,
    }));

  return dayRange(input.from, input.to).map((day) => {
    const info = dayInfo(day, input.group, input.entries);
    const base = {
      date: isoDay(day),
      working: info.working,
      calendarTitle: info.title,
    };
    const version = versionOn(input.versions, day);
    const override = overrides.get(day.getTime());
    if (override)
      return {
        ...base,
        source: 'override' as const,
        workingHours: version?.workingHours ?? null,
        note: override.note,
        items: shape(byOrder(override.items)),
      };
    if (!info.working)
      return {
        ...base,
        source: 'none' as const,
        workingHours: null,
        note: null,
        items: [],
      };
    const weekday = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
    const items = version
      ? byOrder(version.items.filter((i) => i.weekday === weekday))
      : [];
    return {
      ...base,
      source: items.length ? ('template' as const) : ('none' as const),
      workingHours: version?.workingHours ?? null,
      note: version?.note ?? null,
      items: shape(items),
    };
  });
}
