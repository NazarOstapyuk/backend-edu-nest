import { BackupKind } from '@prisma/client';
import { addDays, isoDay } from '../tariffs/dates';

export interface BackupFileInfo {
  name: string;
  kind: BackupKind;
  stamp: string;
}

const KEEP_DAILY = 30;
const KEEP_MONTHS = 12;
const MANUAL_DAYS = 30;

const SUFFIX: Record<BackupKind, string> = {
  [BackupKind.scheduled]: '',
  [BackupKind.manual]: '_manual',
  [BackupKind.pre_restore]: '_pre-restore',
};

const PATTERN =
  /^edu_db_(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])_(?:[01]\d|2[0-3])[0-5]\d[0-5]\d)(_manual|_pre-restore)?\.dump$/;

export function kyivStamp(now: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Kyiv',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}_${parts.hour}${parts.minute}${parts.second}`;
}

export const backupFileName = (kind: BackupKind, now: Date): string =>
  `edu_db_${kyivStamp(now)}${SUFFIX[kind]}.dump`;

export function parseBackupName(name: string): BackupFileInfo | null {
  const match = PATTERN.exec(name);
  if (!match) return null;
  const kind =
    match[2] === '_manual'
      ? BackupKind.manual
      : match[2] === '_pre-restore'
        ? BackupKind.pre_restore
        : BackupKind.scheduled;
  return { name, kind, stamp: match[1] };
}

export const takenAtOf = (stamp: string): string =>
  `${stamp.slice(0, 10)}T${stamp.slice(11, 13)}:${stamp.slice(13, 15)}:${stamp.slice(15, 17)}`;

const newestFirst = (a: BackupFileInfo, b: BackupFileInfo) =>
  b.stamp.localeCompare(a.stamp);

export function filesToDelete(files: BackupFileInfo[], today: Date): string[] {
  const keep = new Set<string>();
  const scheduled = files
    .filter((f) => f.kind === BackupKind.scheduled)
    .sort(newestFirst);
  for (const file of scheduled.slice(0, KEEP_DAILY)) keep.add(file.name);
  const months = new Map<string, BackupFileInfo>();
  for (const file of scheduled) {
    const month = file.stamp.slice(0, 7);
    if (!months.has(month)) months.set(month, file);
  }
  [...months.keys()]
    .sort((a, b) => b.localeCompare(a))
    .slice(0, KEEP_MONTHS)
    .forEach((month) => keep.add(months.get(month)!.name));
  const manualLimit = isoDay(addDays(today, -MANUAL_DAYS));
  const deleted = files.filter((file) => {
    if (file.kind === BackupKind.pre_restore) return false;
    if (file.kind === BackupKind.manual)
      return file.stamp.slice(0, 10) < manualLimit;
    return !keep.has(file.name);
  });
  return deleted.map((f) => f.name).sort();
}
