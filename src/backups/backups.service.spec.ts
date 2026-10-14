import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { BackupKind, BackupStatus } from '@prisma/client';
import { basename } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { BackupStorage } from './backup-storage';
import { BackupsService } from './backups.service';
import { ProcessRunner } from './process-runner';

const DB_URL = 'postgresql://postgres:secret@localhost:5432/edu_db';

const env: Record<string, string | undefined> = {};

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  kind: BackupKind.manual,
  status: BackupStatus.running,
  fileName: null,
  sizeBytes: null,
  error: null,
  startedAt: new Date('2026-10-13T10:00:00Z'),
  finishedAt: null,
  createdById: 'a1',
  createdBy: { id: 'a1', firstName: 'Адмін', lastName: 'Головний' },
  ...over,
});

const mockPrisma = {
  backupRun: {
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
};
const mockConfig = { get: jest.fn((key: string) => env[key]) };
const mockRunner = { run: jest.fn() };
const mockStorage = {
  ensureDir: jest.fn(),
  list: jest.fn(),
  size: jest.fn(),
  rename: jest.fn(),
  remove: jest.fn(),
};

const ok = { code: 0, stderr: '', timedOut: false };

interface UpdateArgs {
  data: { status: BackupStatus; error?: string; fileName?: string };
}
const lastUpdate = () =>
  (mockPrisma.backupRun.update.mock.calls.at(-1) as [UpdateArgs])[0].data;

describe('BackupsService', () => {
  let service: BackupsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    env.BACKUP_DIR = 'C:/backups';
    env.BACKUP_PG_CONTAINER = undefined;
    env.DATABASE_URL = DB_URL;
    mockPrisma.backupRun.create.mockResolvedValue(row());
    mockPrisma.backupRun.update.mockImplementation(
      (args: { data: Record<string, unknown> }) =>
        Promise.resolve(row({ ...args.data })),
    );
    mockRunner.run.mockResolvedValue(ok);
    mockStorage.ensureDir.mockResolvedValue(undefined);
    mockStorage.size.mockResolvedValue(2048);
    mockStorage.rename.mockResolvedValue(undefined);
    mockStorage.remove.mockResolvedValue(undefined);
    mockStorage.list.mockResolvedValue([]);
    const module = await Test.createTestingModule({
      providers: [
        BackupsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
        { provide: ProcessRunner, useValue: mockRunner },
        { provide: BackupStorage, useValue: mockStorage },
      ],
    }).compile();
    service = module.get(BackupsService);
  });

  describe('create', () => {
    it('rejects when backups are not configured', async () => {
      env.BACKUP_DIR = '  ';
      await expect(service.create(BackupKind.manual, 'a1')).rejects.toThrow(
        new BadRequestException('Backups are not configured'),
      );
      expect(mockPrisma.backupRun.create).not.toHaveBeenCalled();
    });

    it('dumps through docker into a .part file and renames it', async () => {
      const view = await service.create(BackupKind.manual, 'a1');

      expect(mockPrisma.backupRun.create).toHaveBeenCalledWith({
        data: {
          kind: BackupKind.manual,
          status: BackupStatus.running,
          createdById: 'a1',
        },
      });
      const [spec, options] = mockRunner.run.mock.calls[0] as [
        { command: string; args: string[] },
        { stdoutFile: string; timeoutMs: number },
      ];
      expect(spec.command).toBe('docker');
      expect(spec.args).toContain('edu_postgres');
      expect(spec.args.join(' ')).not.toContain('secret');
      expect(basename(options.stdoutFile)).toMatch(
        /^edu_db_\d{4}-\d{2}-\d{2}_\d{6}_manual\.dump\.part$/,
      );
      expect(options.timeoutMs).toBe(600_000);
      const [from, to] = mockStorage.rename.mock.calls[0] as [string, string];
      expect(from).toBe(options.stdoutFile);
      expect(to).toBe(options.stdoutFile.replace(/\.part$/, ''));
      expect(lastUpdate()).toMatchObject({
        status: BackupStatus.succeeded,
        fileName: basename(to),
        sizeBytes: BigInt(2048),
      });
      expect(view.status).toBe(BackupStatus.succeeded);
      expect(view.sizeBytes).toBe(2048);
      expect(view.createdBy).toEqual({
        id: 'a1',
        firstName: 'Адмін',
        lastName: 'Головний',
      });
    });

    it('uses a local pg_dump when the container is empty', async () => {
      env.BACKUP_PG_CONTAINER = '';
      await service.create(BackupKind.scheduled);
      const [spec, options] = mockRunner.run.mock.calls[0] as [
        { command: string },
        { stdoutFile?: string },
      ];
      expect(spec.command).toBe('pg_dump');
      expect(options.stdoutFile).toBeUndefined();
    });

    it('removes the partial file and stores a masked error on failure', async () => {
      mockRunner.run.mockResolvedValue({
        code: 1,
        stderr: 'FATAL: password secret rejected\n',
        timedOut: false,
      });

      const view = await service.create(BackupKind.manual, 'a1');

      expect(mockStorage.remove).toHaveBeenCalled();
      expect(mockStorage.rename).not.toHaveBeenCalled();
      expect(lastUpdate()).toMatchObject({
        status: BackupStatus.failed,
        error: 'FATAL: password *** rejected',
      });
      expect(view.status).toBe(BackupStatus.failed);
    });

    it('fails on timeout and on an empty dump', async () => {
      mockRunner.run.mockResolvedValue({
        code: null,
        stderr: '',
        timedOut: true,
      });
      await service.create(BackupKind.manual, 'a1');
      expect(lastUpdate()).toMatchObject({
        status: BackupStatus.failed,
        error: 'Timed out',
      });

      mockRunner.run.mockResolvedValue(ok);
      mockStorage.size.mockResolvedValue(0);
      await service.create(BackupKind.manual, 'a1');
      expect(lastUpdate()).toMatchObject({
        status: BackupStatus.failed,
        error: 'Empty dump',
      });
    });

    it('records an OS error and is usable again afterwards', async () => {
      mockStorage.ensureDir.mockRejectedValueOnce(
        new Error('EACCES: permission denied'),
      );
      await service.create(BackupKind.manual, 'a1');
      expect(lastUpdate()).toMatchObject({
        status: BackupStatus.failed,
        error: 'EACCES: permission denied',
      });

      await service.create(BackupKind.manual, 'a1');
      expect(mockRunner.run).toHaveBeenCalledTimes(1);
      expect(lastUpdate().status).toBe(BackupStatus.succeeded);
    });

    it('allows only one run at a time', async () => {
      let release: (value: typeof ok) => void = () => undefined;
      mockRunner.run.mockReturnValueOnce(
        new Promise((resolve) => {
          release = resolve;
        }),
      );
      const first = service.create(BackupKind.manual, 'a1');
      await new Promise((resolve) => setImmediate(resolve));

      await expect(service.create(BackupKind.manual, 'a1')).rejects.toThrow(
        new ConflictException('Backup is already running'),
      );
      release(ok);
      await expect(first).resolves.toMatchObject({
        status: BackupStatus.succeeded,
      });
    });

    it('applies retention only to our files and ignores deletion errors', async () => {
      mockStorage.list.mockResolvedValue([
        { name: 'edu_db_2025-01-01_020000_manual.dump', size: 1 },
        { name: 'notes.txt', size: 1 },
        { name: 'edu_db_2025-01-02_020000.dump.part', size: 1 },
      ]);
      mockStorage.remove.mockRejectedValueOnce(new Error('EBUSY'));

      const view = await service.create(BackupKind.manual, 'a1');

      const removed = mockStorage.remove.mock.calls.map((call: [string]) =>
        basename(call[0]),
      );
      expect(removed).toEqual(['edu_db_2025-01-01_020000_manual.dump']);
      expect(view.status).toBe(BackupStatus.succeeded);
    });
  });

  describe('status and runs', () => {
    const success = (finishedAt: Date) =>
      row({ status: BackupStatus.succeeded, fileName: 'f.dump', finishedAt });

    it('reports not configured without touching the disk', async () => {
      env.BACKUP_DIR = undefined;
      mockPrisma.backupRun.findFirst.mockResolvedValue(null);
      const status = await service.status();
      expect(status).toMatchObject({
        configured: false,
        dir: null,
        stale: false,
        files: [],
        running: false,
      });
      expect(mockStorage.list).not.toHaveBeenCalled();
    });

    it('lists our files newest first', async () => {
      const recent = success(new Date());
      mockPrisma.backupRun.findFirst
        .mockResolvedValueOnce(recent)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(recent);
      mockStorage.list.mockResolvedValue([
        { name: 'edu_db_2026-10-12_020000.dump', size: 10 },
        { name: 'notes.txt', size: 5 },
        { name: 'edu_db_2026-10-13_101500_manual.dump', size: 20 },
      ]);

      const status = await service.status();

      expect(status.configured).toBe(true);
      expect(status.dir).toBe('C:/backups');
      expect(status.stale).toBe(false);
      expect(status.files).toEqual([
        {
          name: 'edu_db_2026-10-13_101500_manual.dump',
          kind: BackupKind.manual,
          sizeBytes: 20,
          takenAt: '2026-10-13T10:15:00',
        },
        {
          name: 'edu_db_2026-10-12_020000.dump',
          kind: BackupKind.scheduled,
          sizeBytes: 10,
          takenAt: '2026-10-12T02:00:00',
        },
      ]);
    });

    it('is stale without a success, after 26 hours, or after a failed last run', async () => {
      mockPrisma.backupRun.findFirst.mockResolvedValue(null);
      expect((await service.status()).stale).toBe(true);

      const old = success(new Date(Date.now() - 27 * 3_600_000));
      mockPrisma.backupRun.findFirst
        .mockResolvedValueOnce(old)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(old);
      expect((await service.status()).stale).toBe(true);

      const recent = success(new Date());
      const failed = row({ status: BackupStatus.failed, error: 'x' });
      mockPrisma.backupRun.findFirst
        .mockResolvedValueOnce(recent)
        .mockResolvedValueOnce(failed)
        .mockResolvedValueOnce(failed);
      expect((await service.status()).stale).toBe(true);
    });

    it('returns the last 50 runs', async () => {
      mockPrisma.backupRun.findMany.mockResolvedValue([row()]);
      const runs = await service.runs();
      expect(mockPrisma.backupRun.findMany).toHaveBeenCalledWith({
        orderBy: { startedAt: 'desc' },
        take: 50,
        include: {
          createdBy: { select: { id: true, firstName: true, lastName: true } },
        },
      });
      expect(runs[0].startedAt).toBe('2026-10-13T10:00:00.000Z');
    });
  });

  it('marks runs left running by a stopped process as interrupted', async () => {
    await service.onModuleInit();
    expect(mockPrisma.backupRun.updateMany).toHaveBeenCalledWith({
      where: { status: BackupStatus.running },
      data: {
        status: BackupStatus.failed,
        error: 'Interrupted',
        finishedAt: expect.any(Date) as Date,
      },
    });
  });
});
