import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { BackupKind, BackupStatus } from '@prisma/client';
import { BackupsScheduler } from './backups.scheduler';
import { BackupsService } from './backups.service';

const env: Record<string, string | undefined> = {};
const mockConfig = { get: jest.fn((key: string) => env[key]) };
const mockBackups = { create: jest.fn(), status: jest.fn() };

describe('BackupsScheduler', () => {
  let scheduler: BackupsScheduler;

  beforeEach(async () => {
    jest.clearAllMocks();
    env.BACKUP_DIR = 'C:/backups';
    const module = await Test.createTestingModule({
      providers: [
        BackupsScheduler,
        { provide: ConfigService, useValue: mockConfig },
        { provide: BackupsService, useValue: mockBackups },
      ],
    }).compile();
    scheduler = module.get(BackupsScheduler);
  });

  it('does nothing when backups are not configured', async () => {
    env.BACKUP_DIR = '';
    await scheduler.handleDailyBackup();
    expect(mockBackups.create).not.toHaveBeenCalled();
  });

  it('creates a scheduled copy', async () => {
    mockBackups.create.mockResolvedValue({
      status: BackupStatus.succeeded,
      fileName: 'f.dump',
    });
    await scheduler.handleDailyBackup();
    expect(mockBackups.create).toHaveBeenCalledWith(BackupKind.scheduled);
  });

  it('never throws', async () => {
    mockBackups.create.mockRejectedValue(new Error('boom'));
    await expect(scheduler.handleDailyBackup()).resolves.toBeUndefined();
  });

  describe('catch-up at startup', () => {
    const lastSuccessAgo = (hours: number) => ({
      lastSuccess: {
        finishedAt: new Date(Date.now() - hours * 3_600_000).toISOString(),
      },
    });
    const flush = () => new Promise((done) => setImmediate(done));

    it('starts a scheduled copy when the last success is older than 24 hours', async () => {
      mockBackups.status.mockResolvedValue(lastSuccessAgo(25));
      mockBackups.create.mockResolvedValue({ status: BackupStatus.succeeded });
      scheduler.onApplicationBootstrap();
      await flush();
      expect(mockBackups.create).toHaveBeenCalledWith(BackupKind.scheduled);
    });

    it('starts a copy when there is no success yet', async () => {
      mockBackups.status.mockResolvedValue({ lastSuccess: null });
      mockBackups.create.mockResolvedValue({ status: BackupStatus.succeeded });
      scheduler.onApplicationBootstrap();
      await flush();
      expect(mockBackups.create).toHaveBeenCalledWith(BackupKind.scheduled);
    });

    it('skips when the last success is recent', async () => {
      mockBackups.status.mockResolvedValue(lastSuccessAgo(1));
      scheduler.onApplicationBootstrap();
      await flush();
      expect(mockBackups.create).not.toHaveBeenCalled();
    });

    it('skips when backups are not configured', async () => {
      env.BACKUP_DIR = '';
      scheduler.onApplicationBootstrap();
      await flush();
      expect(mockBackups.status).not.toHaveBeenCalled();
      expect(mockBackups.create).not.toHaveBeenCalled();
    });

    it('never throws when the copy or the status check fails', async () => {
      mockBackups.status.mockResolvedValue(lastSuccessAgo(30));
      mockBackups.create.mockRejectedValue(new Error('boom'));
      expect(() => scheduler.onApplicationBootstrap()).not.toThrow();
      await flush();
      mockBackups.status.mockRejectedValue(new Error('db down'));
      expect(() => scheduler.onApplicationBootstrap()).not.toThrow();
      await flush();
    });
  });
});
