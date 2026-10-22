import { BadRequestException } from '@nestjs/common';
import { assertChildrenCanMove } from './move-guard';

describe('assertChildrenCanMove', () => {
  const today = new Date('2026-10-22T00:00:00.000Z');
  let db: {
    enrollment: { findFirst: jest.Mock };
    mealOrder: { findFirst: jest.Mock };
  };

  beforeEach(() => {
    db = {
      enrollment: { findFirst: jest.fn().mockResolvedValue(null) },
      mealOrder: { findFirst: jest.fn().mockResolvedValue(null) },
    };
  });

  it('does not query for an empty list', async () => {
    await expect(
      assertChildrenCanMove(db, [], 'inst-1', today),
    ).resolves.toBeUndefined();
    expect(db.enrollment.findFirst).not.toHaveBeenCalled();
    expect(db.mealOrder.findFirst).not.toHaveBeenCalled();
  });

  it('blocks a child with an active enrollment on the old institution tariff', async () => {
    db.enrollment.findFirst.mockResolvedValue({ id: 'e1' });
    await expect(
      assertChildrenCanMove(db, ['c1'], 'inst-1', today),
    ).rejects.toThrow(
      new BadRequestException('Child has an active enrollment'),
    );
    expect(db.enrollment.findFirst).toHaveBeenCalledWith({
      where: {
        childId: { in: ['c1'] },
        tariff: { institutionId: 'inst-1' },
        OR: [{ endDate: null }, { endDate: { gte: today } }],
      },
      select: { id: true },
    });
  });

  it('allows when no enrollment matches (ended or shared tariff)', async () => {
    await expect(
      assertChildrenCanMove(db, ['c1'], 'inst-1', today),
    ).resolves.toBeUndefined();
  });

  it('blocks a child with a future active meal order', async () => {
    db.mealOrder.findFirst.mockResolvedValue({ id: 'm1' });
    await expect(
      assertChildrenCanMove(db, ['c1', 'c2'], 'inst-1', today),
    ).rejects.toThrow(new BadRequestException('Child has meal orders'));
    expect(db.mealOrder.findFirst).toHaveBeenCalledWith({
      where: {
        childId: { in: ['c1', 'c2'] },
        cancelledAt: null,
        date: { gte: today },
      },
      select: { id: true },
    });
  });

  it('allows when only cancelled or past orders exist', async () => {
    await expect(
      assertChildrenCanMove(db, ['c1'], 'inst-1', today),
    ).resolves.toBeUndefined();
    expect(db.mealOrder.findFirst).toHaveBeenCalled();
  });
});
