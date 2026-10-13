import { cancelOrdersForNoticeInTx } from './notice-orders';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

const tx = {
  mealOrder: { findMany: jest.fn(), update: jest.fn() },
  appSetting: { findUnique: jest.fn() },
  charge: { findUnique: jest.fn(), update: jest.fn() },
  allocation: { updateMany: jest.fn() },
  $queryRaw: jest.fn(),
};

const notice = (createdAt: string) => ({
  childId: 'c1',
  startDate: day('2026-10-14'),
  endDate: day('2026-10-15'),
  createdAt: new Date(createdAt),
});

const orders = [
  { id: 'o14', date: day('2026-10-14'), chargeId: 'ch14' },
  { id: 'o15', date: day('2026-10-15'), chargeId: 'ch15' },
];

const run = (createdAt: string) =>
  cancelOrdersForNoticeInTx(tx as never, notice(createdAt), 'a1');

const cancelledIds = () =>
  tx.mealOrder.update.mock.calls.map(
    (call) => (call as [{ where: { id: string } }])[0].where.id,
  );

describe('cancelOrdersForNoticeInTx', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    tx.mealOrder.findMany.mockResolvedValue(orders);
    tx.appSetting.findUnique.mockResolvedValue(null);
    tx.charge.findUnique.mockResolvedValue({ id: 'ch', voidedAt: null });
    tx.$queryRaw.mockResolvedValue([]);
  });

  it('cancels the same day when the notice came before the deadline', async () => {
    await expect(run('2026-10-14T06:00:00Z')).resolves.toBe(2);
    expect(cancelledIds()).toEqual(['o14', 'o15']);
    expect(tx.mealOrder.update).toHaveBeenCalledWith({
      where: { id: 'o14' },
      data: {
        cancelledAt: expect.any(Date) as Date,
        cancelledById: 'a1',
        cancelReason: 'Відсутність',
      },
    });
    expect(tx.charge.update).toHaveBeenCalledTimes(2);
  });

  it('locks the charge row before reading its void state', async () => {
    await run('2026-10-14T06:00:00Z');
    const sql = (tx.$queryRaw.mock.calls[1] as [TemplateStringsArray])[0].join(
      '?',
    );
    expect(sql).toContain('"Charge"');
    expect(sql).toContain('FOR UPDATE');
    expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      tx.charge.findUnique.mock.invocationCallOrder[0],
    );
  });

  it('keeps the same-day order when the notice came after the deadline', async () => {
    await expect(run('2026-10-14T07:30:00Z')).resolves.toBe(1);
    expect(cancelledIds()).toEqual(['o15']);
  });

  it('uses the stored deadline', async () => {
    tx.appSetting.findUnique.mockResolvedValue({ value: '11:00' });
    await expect(run('2026-10-14T07:30:00Z')).resolves.toBe(2);
  });

  it('locks the child before reading orders and filters by period', async () => {
    await run('2026-10-14T06:00:00Z');
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.mealOrder.findMany.mock.invocationCallOrder[0],
    );
    expect(tx.mealOrder.findMany).toHaveBeenCalledWith({
      where: {
        childId: 'c1',
        cancelledAt: null,
        date: { gte: day('2026-10-14'), lte: day('2026-10-15') },
      },
      select: { id: true, date: true, chargeId: true },
      orderBy: { date: 'asc' },
    });
  });

  it('does not void an already voided charge', async () => {
    tx.charge.findUnique.mockResolvedValue({ id: 'ch', voidedAt: new Date() });
    await run('2026-10-14T06:00:00Z');
    expect(tx.charge.update).not.toHaveBeenCalled();
    expect(tx.mealOrder.update).toHaveBeenCalledTimes(2);
  });
});
