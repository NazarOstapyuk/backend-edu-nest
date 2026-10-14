import { BackupKind } from '@prisma/client';
import {
  type BackupFileInfo,
  backupFileName,
  filesToDelete,
  kyivStamp,
  parseBackupName,
  takenAtOf,
} from './backup-retention';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

const scheduled = (date: string): BackupFileInfo => ({
  name: `edu_db_${date}_020000.dump`,
  kind: BackupKind.scheduled,
  stamp: `${date}_020000`,
});

const dates = (from: string, count: number) =>
  Array.from({ length: count }, (_, i) =>
    new Date(day(from).getTime() + i * 86_400_000).toISOString().slice(0, 10),
  );

describe('names', () => {
  it('stamps in Kyiv summer and winter time', () => {
    expect(kyivStamp(new Date('2026-10-13T23:00:00Z'))).toBe(
      '2026-10-14_020000',
    );
    expect(kyivStamp(new Date('2026-12-01T00:30:15Z'))).toBe(
      '2026-12-01_023015',
    );
  });

  it('builds a file name per kind', () => {
    const now = new Date('2026-10-13T23:00:00Z');
    expect(backupFileName(BackupKind.scheduled, now)).toBe(
      'edu_db_2026-10-14_020000.dump',
    );
    expect(backupFileName(BackupKind.manual, now)).toBe(
      'edu_db_2026-10-14_020000_manual.dump',
    );
    expect(backupFileName(BackupKind.pre_restore, now)).toBe(
      'edu_db_2026-10-14_020000_pre-restore.dump',
    );
  });

  it('parses our names and rejects others', () => {
    expect(parseBackupName('edu_db_2026-10-14_020000.dump')).toEqual({
      name: 'edu_db_2026-10-14_020000.dump',
      kind: BackupKind.scheduled,
      stamp: '2026-10-14_020000',
    });
    expect(parseBackupName('edu_db_2026-10-14_020000_manual.dump')?.kind).toBe(
      BackupKind.manual,
    );
    expect(
      parseBackupName('edu_db_2026-10-14_020000_pre-restore.dump')?.kind,
    ).toBe(BackupKind.pre_restore);
    expect(parseBackupName('edu_db_2026-10-14_020000.dump.part')).toBeNull();
    expect(parseBackupName('edu_db_2026-13-14_020000.dump')).toBeNull();
    expect(parseBackupName('edu_db_2026-10-14_250000.dump')).toBeNull();
    expect(parseBackupName('notes.txt')).toBeNull();
  });

  it('formats the taken-at time', () => {
    expect(takenAtOf('2026-10-14_020509')).toBe('2026-10-14T02:05:09');
  });
});

describe('filesToDelete', () => {
  const today = day('2026-10-13');

  it('keeps the newest 30 scheduled copies', () => {
    const files = dates('2026-09-04', 40).map(scheduled);
    expect(filesToDelete(files, today)).toEqual(
      dates('2026-09-04', 10).map((d) => `edu_db_${d}_020000.dump`),
    );
  });

  it('keeps the newest copy of each of the last 12 months', () => {
    const recent = dates('2026-09-14', 30).map(scheduled);
    const monthly = Array.from({ length: 20 }, (_, i) => {
      const month = new Date(Date.UTC(2025, i, 15)).toISOString().slice(0, 10);
      return scheduled(month);
    });
    const deleted = filesToDelete([...monthly, ...recent], today);
    expect(deleted).toEqual(
      Array.from(
        { length: 10 },
        (_, i) =>
          `edu_db_${new Date(Date.UTC(2025, i, 15)).toISOString().slice(0, 10)}_020000.dump`,
      ),
    );
  });

  it('keeps only the newest copy within an old month', () => {
    const files = [
      ...dates('2026-09-14', 30).map(scheduled),
      scheduled('2026-03-15'),
      scheduled('2026-03-20'),
    ];
    expect(filesToDelete(files, today)).toEqual([
      'edu_db_2026-03-15_020000.dump',
    ]);
  });

  it('deletes manual copies older than 30 days and never pre-restore ones', () => {
    const files: BackupFileInfo[] = [
      {
        name: 'edu_db_2026-09-13_101010_manual.dump',
        kind: BackupKind.manual,
        stamp: '2026-09-13_101010',
      },
      {
        name: 'edu_db_2026-09-12_235959_manual.dump',
        kind: BackupKind.manual,
        stamp: '2026-09-12_235959',
      },
      {
        name: 'edu_db_2020-01-01_000000_pre-restore.dump',
        kind: BackupKind.pre_restore,
        stamp: '2020-01-01_000000',
      },
    ];
    expect(filesToDelete(files, today)).toEqual([
      'edu_db_2026-09-12_235959_manual.dump',
    ]);
  });
});
