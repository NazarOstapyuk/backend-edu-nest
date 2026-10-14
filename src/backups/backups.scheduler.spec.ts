import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { BackupKind, BackupStatus } from '@prisma/client';
import { BackupsScheduler } from './backups.scheduler';
import { BackupsService } from './backups.service';

const env: Record<string, string | undefined> = {};
const mockConfig = { get: jest.fn((key: string) => env[key]) };
const mockBackups = { create: jest.fn() };

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
});
