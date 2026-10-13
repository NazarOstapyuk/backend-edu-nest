import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { MealSettingsService } from './meal-settings.service';

const mockPrisma = {
  appSetting: { findUnique: jest.fn(), upsert: jest.fn() },
};

describe('MealSettingsService', () => {
  let service: MealSettingsService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        MealSettingsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = moduleRef.get(MealSettingsService);
  });

  it('defaults the deadline to 10:00', async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue(null);
    await expect(service.getDeadline()).resolves.toBe('10:00');
  });

  it('returns the stored deadline', async () => {
    mockPrisma.appSetting.findUnique.mockResolvedValue({ value: '09:30' });
    await expect(service.getDeadline()).resolves.toBe('09:30');
  });

  it('stores a valid deadline', async () => {
    await expect(service.setDeadline('08:45')).resolves.toEqual({
      mealOrderDeadline: '08:45',
    });
    expect(mockPrisma.appSetting.upsert).toHaveBeenCalledWith({
      where: { key: 'mealOrderDeadline' },
      create: { key: 'mealOrderDeadline', value: '08:45' },
      update: { value: '08:45' },
    });
  });

  it('rejects an invalid deadline', async () => {
    await expect(service.setDeadline('25:00')).rejects.toThrow(
      new BadRequestException('Invalid deadline'),
    );
  });
});
