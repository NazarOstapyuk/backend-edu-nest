import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { CashAlertsService } from './cash-alerts.service';
import { CashEntriesService } from './cash-entries.service';
import { CashShiftsService } from './cash-shifts.service';

const d = (value: string) => new Prisma.Decimal(value);

const mockPrisma = {
  cashDesk: { findUnique: jest.fn() },
  cashShift: { findFirst: jest.fn(), findUnique: jest.fn() },
  cashEntry: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  cashAlert: { create: jest.fn() },
  user: { findFirst: jest.fn(), findMany: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};

const person = { id: 'u1', firstName: 'Ira', lastName: 'Koval' };

const entryRow = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  deskId: 'desk-1',
  shiftId: 's1',
  kind: 'expense',
  amount: d('10.00'),
  sign: 1,
  direction: 'shared',
  expenseCategory: 'household',
  comment: null,
  createdAt: new Date('2026-11-17T09:00:00Z'),
  createdBy: person,
  voidedAt: null,
  voidedBy: null,
  voidReason: null,
  correctsId: null,
  recipient: null,
  recipientId: null,
  transferStatus: null,
  transferNote: null,
  confirmedAt: null,
  payment: null,
  ...over,
});

const user = (over: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'u1',
  role: Role.admin,
  login: 'a',
  positionId: null,
  mustChangePassword: false,
  accessScope: 'all',
  institutionIds: [],
  scopeInstitutionIds: null,
  permissions: {},
  ...over,
});

interface CreateArgs {
  data: Record<string, unknown>;
}
interface AlertData {
  type: string;
  amount: Prisma.Decimal;
  actorId: string;
  entryId: string;
  shiftId: string;
}

const createData = () =>
  (mockPrisma.cashEntry.create.mock.calls as [CreateArgs][])[0][0].data;
const alertData = (index = 0) =>
  (mockPrisma.cashAlert.create.mock.calls as [{ data: AlertData }][])[index][0]
    .data;

describe('CashEntriesService', () => {
  let service: CashEntriesService;

  beforeEach(async () => {
    jest.resetAllMocks();
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(mockPrisma),
    );
    mockPrisma.cashDesk.findUnique.mockResolvedValue({
      id: 'desk-1',
      largeAmount: d('5000.00'),
    });
    mockPrisma.cashShift.findFirst.mockResolvedValue({
      id: 's1',
      deskId: 'desk-1',
      openingCounted: d('100.00'),
    });
    mockPrisma.cashEntry.findMany.mockResolvedValue([]);
    mockPrisma.cashEntry.create.mockImplementation(({ data }: CreateArgs) =>
      Promise.resolve(entryRow({ ...data, id: 'e-new' })),
    );
    const module = await Test.createTestingModule({
      providers: [
        CashEntriesService,
        CashShiftsService,
        CashAlertsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(CashEntriesService);
  });

  describe('create expense', () => {
    it('requires a category', async () => {
      await expect(
        service.create('desk-1', { kind: 'expense', amount: '10.00' }, 'u1'),
      ).rejects.toThrow(
        new BadRequestException('Expense category is required'),
      );
    });

    it('requires a comment for other', async () => {
      await expect(
        service.create(
          'desk-1',
          { kind: 'expense', amount: '10.00', expenseCategory: 'other' },
          'u1',
        ),
      ).rejects.toThrow(new BadRequestException('Comment is required'));
    });

    it('rejects an amount above the balance', async () => {
      await expect(
        service.create(
          'desk-1',
          { kind: 'expense', amount: '100.01', expenseCategory: 'household' },
          'u1',
        ),
      ).rejects.toThrow(new BadRequestException('Not enough cash'));
    });

    it('accepts an amount equal to the balance and defaults direction', async () => {
      await service.create(
        'desk-1',
        { kind: 'expense', amount: '100.00', expenseCategory: 'household' },
        'u1',
      );
      expect(createData()).toMatchObject({
        kind: 'expense',
        direction: 'shared',
        shiftId: 's1',
        createdById: 'u1',
      });
      expect(mockPrisma.cashAlert.create).not.toHaveBeenCalled();
    });

    it('raises large_withdrawal when the amount reaches the threshold', async () => {
      mockPrisma.cashDesk.findUnique.mockResolvedValue({
        id: 'desk-1',
        largeAmount: d('50.00'),
      });
      await service.create(
        'desk-1',
        { kind: 'expense', amount: '50.00', expenseCategory: 'household' },
        'u1',
      );
      expect(alertData()).toMatchObject({
        type: 'large_withdrawal',
        actorId: 'u1',
        shiftId: 's1',
        entryId: 'e-new',
      });
    });
  });

  describe('create transfer', () => {
    const dto = { kind: 'transfer' as const, amount: '10.00' };

    it('requires a recipient', async () => {
      await expect(service.create('desk-1', dto, 'u1')).rejects.toThrow(
        new BadRequestException('Recipient not found'),
      );
    });

    it('rejects transfer to self', async () => {
      await expect(
        service.create('desk-1', { ...dto, recipientId: 'u1' }, 'u1'),
      ).rejects.toThrow(new BadRequestException('Cannot transfer to yourself'));
    });

    it('rejects a parent or inactive recipient', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      await expect(
        service.create('desk-1', { ...dto, recipientId: 'u2' }, 'u1'),
      ).rejects.toThrow(new BadRequestException('Recipient not found'));
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'u2',
          isActive: true,
          role: { in: ['root', 'admin', 'teacher'] },
        },
        select: { id: true },
      });
    });

    it('creates a pending transfer', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'u2' });
      await service.create('desk-1', { ...dto, recipientId: 'u2' }, 'u1');
      expect(createData()).toMatchObject({
        kind: 'transfer',
        recipientId: 'u2',
        transferStatus: 'pending',
      });
    });
  });

  describe('void', () => {
    beforeEach(() => {
      mockPrisma.cashEntry.findUnique.mockResolvedValue(entryRow());
      mockPrisma.cashShift.findUnique.mockResolvedValue({
        id: 's1',
        closedAt: null,
      });
      mockPrisma.cashEntry.update.mockResolvedValue(
        entryRow({ voidedAt: new Date(), voidedBy: person }),
      );
    });

    it('rejects a missing entry', async () => {
      mockPrisma.cashEntry.findUnique.mockResolvedValue(null);
      await expect(
        service.voidEntry('e1', { reason: 'oops' }, 'u1'),
      ).rejects.toThrow(new NotFoundException('Entry not found'));
    });

    it('rejects a voided entry', async () => {
      mockPrisma.cashEntry.findUnique.mockResolvedValue(
        entryRow({ voidedAt: new Date() }),
      );
      await expect(
        service.voidEntry('e1', { reason: 'oops' }, 'u1'),
      ).rejects.toThrow(new BadRequestException('Entry is voided'));
    });

    it('rejects an entry of a closed shift', async () => {
      mockPrisma.cashShift.findUnique.mockResolvedValue({
        id: 's1',
        closedAt: new Date(),
      });
      await expect(
        service.voidEntry('e1', { reason: 'oops' }, 'u1'),
      ).rejects.toThrow(new BadRequestException('Shift is closed'));
    });

    it('rejects voiding income', async () => {
      mockPrisma.cashEntry.findUnique.mockResolvedValue(
        entryRow({ kind: 'income' }),
      );
      await expect(
        service.voidEntry('e1', { reason: 'oops' }, 'u1'),
      ).rejects.toThrow(
        new BadRequestException('Income is voided through the payment'),
      );
    });

    it('rejects voiding a correction', async () => {
      mockPrisma.cashEntry.findUnique.mockResolvedValue(
        entryRow({ kind: 'correction' }),
      );
      await expect(
        service.voidEntry('e1', { reason: 'oops' }, 'u1'),
      ).rejects.toThrow(
        new BadRequestException('Corrections cannot be voided'),
      );
    });

    it('rejects voiding a confirmed transfer', async () => {
      mockPrisma.cashEntry.findUnique.mockResolvedValue(
        entryRow({ kind: 'transfer', transferStatus: 'confirmed' }),
      );
      await expect(
        service.voidEntry('e1', { reason: 'oops' }, 'u1'),
      ).rejects.toThrow(new BadRequestException('Transfer already confirmed'));
    });

    it('voids an entry under the desk lock', async () => {
      await service.voidEntry('e1', { reason: 'oops' }, 'u1');
      const lockOrder = mockPrisma.$queryRaw.mock.invocationCallOrder[0];
      const reads = mockPrisma.cashEntry.findUnique.mock.invocationCallOrder;
      expect(reads).toHaveLength(2);
      expect(lockOrder).toBeGreaterThan(reads[0]);
      expect(lockOrder).toBeLessThan(reads[1]);
      expect(mockPrisma.cashEntry.update).toHaveBeenCalled();
    });
  });

  describe('recipients', () => {
    it('requires cash edit without all', async () => {
      await expect(service.recipients(user(), false)).rejects.toThrow(
        new ForbiddenException('Insufficient permissions'),
      );
    });

    it('requires cash_control view with all', async () => {
      await expect(
        service.recipients(user({ permissions: { cash: 'edit' } }), true),
      ).rejects.toThrow(new ForbiddenException('Insufficient permissions'));
    });

    it('lists active staff except me', async () => {
      mockPrisma.user.findMany.mockResolvedValue([person]);
      const result = await service.recipients(
        user({ permissions: { cash: 'edit' } }),
        false,
      );
      expect(result).toEqual([{ id: 'u1', name: 'Koval Ira' }]);
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            role: { in: ['root', 'admin', 'teacher'] },
            isActive: true,
            id: { not: 'u1' },
          },
        }),
      );
    });

    it('lists all staff with all', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      await service.recipients(
        user({ permissions: { cash_control: 'view' } }),
        true,
      );
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { role: { in: ['root', 'admin', 'teacher'] } },
        }),
      );
    });
  });

  describe('confirm and dispute', () => {
    const transfer = (over: Record<string, unknown> = {}) =>
      entryRow({
        kind: 'transfer',
        recipient: { id: 'u2', firstName: 'Petro', lastName: 'Bondar' },
        recipientId: 'u2',
        transferStatus: 'pending',
        ...over,
      });

    beforeEach(() => {
      mockPrisma.cashEntry.findUnique.mockResolvedValue(transfer());
      mockPrisma.cashEntry.updateMany.mockResolvedValue({ count: 1 });
    });

    it('rejects a missing entry', async () => {
      mockPrisma.cashEntry.findUnique.mockResolvedValue(null);
      await expect(service.confirm('e1', 'u2')).rejects.toThrow(
        new NotFoundException('Entry not found'),
      );
    });

    it('rejects a non-recipient', async () => {
      await expect(service.confirm('e1', 'u3')).rejects.toThrow(
        new ForbiddenException('Not the recipient'),
      );
    });

    it('rejects an already settled transfer', async () => {
      mockPrisma.cashEntry.findUnique.mockResolvedValue(
        transfer({ transferStatus: 'confirmed' }),
      );
      await expect(service.confirm('e1', 'u2')).rejects.toThrow(
        new BadRequestException('Transfer already settled'),
      );
    });

    it('rejects when a concurrent settle wins', async () => {
      mockPrisma.cashEntry.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.confirm('e1', 'u2')).rejects.toThrow(
        new BadRequestException('Transfer already settled'),
      );
    });

    it('confirms a pending transfer', async () => {
      await service.confirm('e1', 'u2');
      expect(mockPrisma.cashEntry.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'e1', transferStatus: 'pending' },
        }),
      );
      expect(mockPrisma.cashAlert.create).not.toHaveBeenCalled();
    });

    it('dispute raises transfer_disputed by the recipient', async () => {
      await service.dispute('e1', { note: 'not received' }, 'u2');
      expect(alertData()).toMatchObject({
        type: 'transfer_disputed',
        actorId: 'u2',
        entryId: 'e1',
        shiftId: 's1',
      });
    });
  });

  describe('correct', () => {
    it('rejects a negative correction beyond the balance', async () => {
      mockPrisma.cashEntry.findMany.mockResolvedValue([
        {
          kind: 'expense',
          amount: d('60.00'),
          sign: 1,
          direction: 'shared',
          voidedAt: null,
        },
      ]);
      await expect(
        service.correct(
          'desk-1',
          { sign: -1, amount: '50.00', comment: 'fix' },
          'u1',
        ),
      ).rejects.toThrow(new BadRequestException('Not enough cash'));
    });

    it('creates a correction with an alert', async () => {
      await service.correct(
        'desk-1',
        { sign: -1, amount: '50.00', comment: 'fix' },
        'u1',
      );
      expect(createData()).toMatchObject({
        kind: 'correction',
        sign: -1,
        direction: 'shared',
        comment: 'fix',
      });
      expect(alertData()).toMatchObject({ type: 'correction', actorId: 'u1' });
      expect(alertData().amount.toFixed(2)).toBe('-50.00');
    });
  });
});
