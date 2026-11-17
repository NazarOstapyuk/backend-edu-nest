import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CashAlertsService } from './cash-alerts.service';
import { CashShiftsService } from './cash-shifts.service';

const d = (value: string) => new Prisma.Decimal(value);

const mockPrisma = {
  cashDesk: { findUnique: jest.fn() },
  cashShift: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  cashEntry: { findMany: jest.fn() },
  cashAlert: { create: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};

const person = { id: 'u1', firstName: 'Ira', lastName: 'Koval' };

const shiftRow = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  deskId: 'desk-1',
  desk: { name: 'Main' },
  openedAt: new Date('2026-11-17T08:00:00Z'),
  openedBy: person,
  openingExpected: d('0.00'),
  openingCounted: d('100.00'),
  openingNote: null,
  closedAt: null,
  closedBy: null,
  closingExpected: null,
  closingCounted: null,
  closingNote: null,
  denominations: null,
  totals: null,
  entries: [],
  ...over,
});

const entry = (over: Record<string, unknown> = {}) => ({
  kind: 'income',
  amount: d('50.00'),
  sign: 1,
  direction: 'shared',
  voidedAt: null,
  ...over,
});

interface Data {
  type: string;
  amount: Prisma.Decimal;
  actorId: string;
  openingExpected: Prisma.Decimal;
  openingNote: string;
  closingExpected: Prisma.Decimal;
  closingCounted: Prisma.Decimal;
  totals: { income: string };
}

const dataOf = (fn: jest.Mock, index = 0): Data =>
  (fn.mock.calls as [{ data: Data }][])[index][0].data;

describe('CashShiftsService', () => {
  let service: CashShiftsService;

  beforeEach(async () => {
    jest.resetAllMocks();
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(mockPrisma),
    );
    const module = await Test.createTestingModule({
      providers: [
        CashShiftsService,
        CashAlertsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(CashShiftsService);
  });

  describe('open', () => {
    beforeEach(() => {
      mockPrisma.cashDesk.findUnique.mockResolvedValue({
        id: 'desk-1',
        isActive: true,
      });
      mockPrisma.cashShift.findFirst.mockResolvedValue(null);
      mockPrisma.cashShift.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 's1', ...data }),
      );
      mockPrisma.cashShift.findUnique.mockResolvedValue(shiftRow());
    });

    it('rejects when a shift is already open', async () => {
      mockPrisma.cashShift.findFirst.mockResolvedValueOnce({ id: 'open' });
      await expect(
        service.open('desk-1', { denominations: {} }, 'u1'),
      ).rejects.toThrow(new BadRequestException('Shift already open'));
    });

    it('rejects an inactive desk', async () => {
      mockPrisma.cashDesk.findUnique.mockResolvedValue({
        id: 'desk-1',
        isActive: false,
      });
      await expect(
        service.open('desk-1', { denominations: {} }, 'u1'),
      ).rejects.toThrow(new BadRequestException('Cash desk is inactive'));
    });

    it('opens the first shift with zero count and no alert', async () => {
      await service.open('desk-1', { denominations: {} }, 'u1');
      expect(
        dataOf(mockPrisma.cashShift.create).openingExpected.toFixed(2),
      ).toBe('0.00');
      expect(mockPrisma.cashAlert.create).not.toHaveBeenCalled();
    });

    it('requires an explanation when the count differs from the last closing', async () => {
      mockPrisma.cashShift.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ closingCounted: d('100.00') });
      await expect(
        service.open('desk-1', { denominations: { '5000': 1 } }, 'u1'),
      ).rejects.toThrow(new BadRequestException('Explanation required'));
    });

    it('creates opening_discrepancy alert with a note', async () => {
      mockPrisma.cashShift.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ closingCounted: d('100.00') });
      await service.open(
        'desk-1',
        { denominations: { '5000': 1 }, note: ' counted twice ' },
        'u1',
      );
      const alert = dataOf(mockPrisma.cashAlert.create);
      expect(alert.type).toBe('opening_discrepancy');
      expect(alert.amount.toFixed(2)).toBe('-50.00');
      expect(alert.actorId).toBe('u1');
      expect(dataOf(mockPrisma.cashShift.create).openingNote).toBe(
        'counted twice',
      );
    });

    it('maps a unique violation on a race to Shift already open', async () => {
      mockPrisma.cashShift.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
        }),
      );
      await expect(
        service.open('desk-1', { denominations: {} }, 'u1'),
      ).rejects.toThrow(new BadRequestException('Shift already open'));
    });
  });

  describe('close', () => {
    const open = shiftRow();

    beforeEach(() => {
      mockPrisma.cashShift.findUnique.mockResolvedValue(open);
      mockPrisma.cashEntry.findMany.mockResolvedValue([entry()]);
    });

    it('rejects an unknown shift', async () => {
      mockPrisma.cashShift.findUnique.mockResolvedValue(null);
      await expect(
        service.close('s1', { denominations: {} }, 'u1'),
      ).rejects.toThrow(new NotFoundException('Shift not found'));
    });

    it('rejects a closed shift', async () => {
      mockPrisma.cashShift.findUnique.mockResolvedValue(
        shiftRow({ closedAt: new Date() }),
      );
      await expect(
        service.close('s1', { denominations: {} }, 'u1'),
      ).rejects.toThrow(new BadRequestException('Shift is closed'));
    });

    it('locks the desk before reading entries', async () => {
      await service.close(
        's1',
        { denominations: { '10000': 1, '5000': 1 } },
        'u1',
      );
      expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.cashEntry.findMany.mock.invocationCallOrder[0],
      );
    });

    it('creates only shift_closed when the difference is zero', async () => {
      await service.close(
        's1',
        { denominations: { '10000': 1, '5000': 1 } },
        'u1',
      );
      const types = (
        mockPrisma.cashAlert.create.mock.calls as [{ data: Data }][]
      ).map((call) => call[0].data.type);
      expect(types).toEqual(['shift_closed']);
      const update = dataOf(mockPrisma.cashShift.update);
      expect(update.closingExpected.toFixed(2)).toBe('150.00');
      expect(update.closingCounted.toFixed(2)).toBe('150.00');
      expect(update.totals.income).toBe('50.00');
    });

    it('requires an explanation for a difference', async () => {
      await expect(
        service.close(
          's1',
          { denominations: { '10000': 1, '5000': 1, '10': 1 } },
          'u1',
        ),
      ).rejects.toThrow(new BadRequestException('Explanation required'));
    });

    it('creates a signed discrepancy alert with a note', async () => {
      mockPrisma.cashEntry.findMany.mockResolvedValue([
        entry({ amount: d('50.10') }),
      ]);
      await service.close(
        's1',
        { denominations: { '10000': 1, '5000': 1 }, note: 'short change' },
        'u1',
      );
      const calls = mockPrisma.cashAlert.create.mock.calls.map(
        (call: [{ data: { type: string; amount: Prisma.Decimal } }]) =>
          call[0].data,
      );
      expect(calls.map((c: { type: string }) => c.type)).toEqual([
        'shift_closed',
        'discrepancy',
      ]);
      expect(calls[1].amount.toFixed(2)).toBe('-0.10');
    });
  });

  describe('lockOpenShift', () => {
    it('throws when there is no open shift', async () => {
      mockPrisma.cashDesk.findUnique.mockResolvedValue({ id: 'desk-1' });
      mockPrisma.cashShift.findFirst.mockResolvedValue(null);
      await expect(
        service.lockOpenShift(mockPrisma as never, 'desk-1'),
      ).rejects.toThrow(new BadRequestException('No open cash shift'));
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    });

    it('throws when the desk is missing', async () => {
      mockPrisma.cashDesk.findUnique.mockResolvedValue(null);
      await expect(
        service.lockOpenShift(mockPrisma as never, 'x'),
      ).rejects.toThrow(new NotFoundException('Cash desk not found'));
    });
  });

  describe('balance', () => {
    it('adds opening count and entries', async () => {
      mockPrisma.cashEntry.findMany.mockResolvedValue([
        entry(),
        entry({ kind: 'expense', amount: d('20.00') }),
      ]);
      const result = await service.balance(
        mockPrisma as never,
        shiftRow() as never,
      );
      expect(result.toFixed(2)).toBe('130.00');
    });
  });
});
