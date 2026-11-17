import { AccessScope, PermissionLevel, Role } from '@prisma/client';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  FinanceCategory,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CashAlertsService } from '../cash/cash-alerts.service';
import { CashShiftsService } from '../cash/cash-shifts.service';
import { PaymentsService } from './payments.service';

const d = (value: string) => new Prisma.Decimal(value);

const mockPrisma = {
  child: { findUnique: jest.fn(), findFirst: jest.fn() },
  payment: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  cashEntry: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  cashShift: { findUnique: jest.fn() },
  charge: { findMany: jest.fn() },
  allocation: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
  },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};

const mockShifts = { lockOpenShift: jest.fn(), balance: jest.fn() };
const mockAlerts = { create: jest.fn() };

const payment = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  childId: 'child-1',
  amount: d('1000.00'),
  category: FinanceCategory.tuition,
  status: PaymentStatus.confirmed,
  voidedAt: null,
  ...over,
});

const charge = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  childId: 'child-1',
  category: FinanceCategory.tuition,
  amount: d('800.00'),
  voidedAt: null,
  allocations: [],
  ...over,
});

const fullAdmin: AuthenticatedUser = {
  id: 'u1',
  role: Role.admin,
  login: 'admin',
  mustChangePassword: false,
  accessScope: AccessScope.all,
  institutionIds: [] as string[],
  scopeInstitutionIds: null as string[] | null,
  permissions: { finance: PermissionLevel.edit, tariffs: PermissionLevel.edit },
};

const kgAccountant: AuthenticatedUser = {
  id: 'kg1',
  role: Role.admin,
  login: 'kg',
  mustChangePassword: false,
  accessScope: AccessScope.institutions,
  institutionIds: ['inst-k'],
  scopeInstitutionIds: ['inst-k'],
  permissions: { finance: PermissionLevel.edit, tariffs: PermissionLevel.edit },
};

describe('PaymentsService', () => {
  let service: PaymentsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(mockPrisma),
    );
    mockPrisma.allocation.findMany.mockResolvedValue([]);
    mockPrisma.cashEntry.findUnique.mockResolvedValue(null);
    mockPrisma.allocation.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 'a1', ...data }),
    );
    const module = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CashShiftsService, useValue: mockShifts },
        { provide: CashAlertsService, useValue: mockAlerts },
      ],
    }).compile();
    service = module.get(PaymentsService);
  });

  describe('allocate', () => {
    it('allocates within limits after locking payment and charges', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue(payment());
      mockPrisma.charge.findMany.mockResolvedValue([charge()]);

      const result = await service.allocate(
        'p1',
        [{ chargeId: 'c1', amount: '500.00' }],
        'u1',
        fullAdmin,
      );

      expect(result).toEqual(payment());
      expect(mockPrisma.allocation.create).toHaveBeenCalledWith({
        data: {
          paymentId: 'p1',
          chargeId: 'c1',
          amount: '500.00',
          createdById: 'u1',
        },
      });
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
      expect(mockPrisma.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
        mockPrisma.charge.findMany.mock.invocationCallOrder[0],
      );
      expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.payment.findUnique.mock.invocationCallOrder[0],
      );
    });

    it('lets a payment without category cover any category', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue(
        payment({ category: null }),
      );
      mockPrisma.charge.findMany.mockResolvedValue([
        charge({ category: FinanceCategory.meals }),
      ]);

      await service.allocate(
        'p1',
        [{ chargeId: 'c1', amount: '100.00' }],
        'u1',
        fullAdmin,
      );

      expect(mockPrisma.allocation.create).toHaveBeenCalledTimes(1);
    });

    type Override = {
      charge?: Record<string, unknown>;
      payment?: Record<string, unknown>;
    };
    const rejections: [string, Override, string][] = [
      [
        'category mismatch',
        { charge: { category: FinanceCategory.meals } },
        'Charge category does not match payment category',
      ],
      [
        'another child',
        { charge: { childId: 'child-2' } },
        'Charge belongs to another child',
      ],
      [
        'voided charge',
        { charge: { voidedAt: new Date() } },
        'Charge is voided',
      ],
      [
        'voided payment',
        { payment: { voidedAt: new Date() } },
        'Payment is voided',
      ],
      [
        'pending payment',
        { payment: { status: PaymentStatus.pending } },
        'Payment is not confirmed',
      ],
      [
        'charge remaining exceeded',
        { charge: { allocations: [{ amount: d('500.00'), voidedAt: null }] } },
        'Allocation exceeds charge remaining amount',
      ],
    ];

    it.each(rejections)('rejects %s', async (_name, over, message) => {
      mockPrisma.payment.findUnique.mockResolvedValue(payment(over.payment));
      mockPrisma.charge.findMany.mockResolvedValue([charge(over.charge)]);

      await expect(
        service.allocate(
          'p1',
          [{ chargeId: 'c1', amount: '400.00' }],
          'u1',
          fullAdmin,
        ),
      ).rejects.toThrow(message);
      expect(mockPrisma.allocation.create).not.toHaveBeenCalled();
    });

    it('rejects when payment free amount is exceeded', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue(payment());
      mockPrisma.charge.findMany.mockResolvedValue([charge()]);
      mockPrisma.allocation.findMany.mockResolvedValue([
        { amount: d('700.00'), voidedAt: null },
      ]);

      await expect(
        service.allocate(
          'p1',
          [{ chargeId: 'c1', amount: '400.00' }],
          'u1',
          fullAdmin,
        ),
      ).rejects.toThrow('Allocation exceeds payment free amount');
    });

    it('rejects duplicate charges before touching the database', async () => {
      await expect(
        service.allocate(
          'p1',
          [
            { chargeId: 'c1', amount: '100.00' },
            { chargeId: 'c1', amount: '100.00' },
          ],
          'u1',
          fullAdmin,
        ),
      ).rejects.toThrow('Duplicate charge in allocations');
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('rejects zero amounts', async () => {
      await expect(
        service.allocate(
          'p1',
          [{ chargeId: 'c1', amount: '0.00' }],
          'u1',
          fullAdmin,
        ),
      ).rejects.toThrow('Amount must be greater than 0');
    });

    it('throws NotFoundException for unknown charge', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue(payment());
      mockPrisma.charge.findMany.mockResolvedValue([]);

      await expect(
        service.allocate(
          'p1',
          [{ chargeId: 'c1', amount: '100.00' }],
          'u1',
          fullAdmin,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for unknown payment', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue(null);

      await expect(
        service.allocate(
          'missing',
          [{ chargeId: 'c1', amount: '100.00' }],
          'u1',
          fullAdmin,
        ),
      ).rejects.toThrow('Payment not found');
    });
  });

  describe('create', () => {
    const dto = {
      amount: '1000.00',
      method: PaymentMethod.cash,
      reference: 'Receipt 15',
      receivedAt: '2026-10-11',
      category: FinanceCategory.tuition,
      cashDeskId: 'desk-1',
    };

    beforeEach(() => {
      mockShifts.lockOpenShift.mockResolvedValue({
        id: 's1',
        deskId: 'desk-1',
      });
    });

    it('creates a confirmed payment without allocations', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
      mockPrisma.payment.create.mockResolvedValue(payment());

      const result = await service.create('child-1', dto, 'u1', fullAdmin);

      expect(result).toEqual(payment());
      expect(mockPrisma.payment.create).toHaveBeenCalledWith({
        data: {
          childId: 'child-1',
          amount: '1000.00',
          category: FinanceCategory.tuition,
          method: PaymentMethod.cash,
          status: PaymentStatus.confirmed,
          reference: 'Receipt 15',
          receivedAt: new Date('2026-10-11'),
          note: undefined,
          payerName: null,
          periodFrom: null,
          periodTo: null,
          createdById: 'u1',
        },
      });
      expect(mockPrisma.charge.findMany).not.toHaveBeenCalled();
    });

    it('rejects a receipt date after Kyiv today', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({ id: 'child-1' });

      await expect(
        service.create(
          'child-1',
          { ...dto, receivedAt: '2999-01-01' },
          'u1',
          fullAdmin,
        ),
      ).rejects.toThrow('Date is in the future');
      expect(mockPrisma.payment.create).not.toHaveBeenCalled();
    });

    it('stores an empty reference when none is given', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
      mockPrisma.payment.create.mockResolvedValue(payment());

      await service.create(
        'child-1',
        { ...dto, reference: undefined },
        'u1',
        fullAdmin,
      );

      const [[args]] = mockPrisma.payment.create.mock.calls as [
        [{ data: { reference: string } }],
      ];
      expect(args.data.reference).toBe('');
    });

    it('applies given allocations in the same transaction', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
      mockPrisma.payment.create.mockResolvedValue(payment());
      mockPrisma.payment.findUnique.mockResolvedValue(payment());
      mockPrisma.charge.findMany.mockResolvedValue([charge()]);

      await service.create(
        'child-1',
        { ...dto, allocations: [{ chargeId: 'c1', amount: '800.00' }] },
        'u1',
        fullAdmin,
      );

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.allocation.create).toHaveBeenCalledWith({
        data: {
          paymentId: 'p1',
          chargeId: 'c1',
          amount: '800.00',
          createdById: 'u1',
        },
      });
    });

    it('fails without creating allocations when an allocation is invalid', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
      mockPrisma.payment.create.mockResolvedValue(payment());
      mockPrisma.payment.findUnique.mockResolvedValue(payment());
      mockPrisma.charge.findMany.mockResolvedValue([
        charge({ category: FinanceCategory.meals }),
      ]);

      await expect(
        service.create(
          'child-1',
          { ...dto, allocations: [{ chargeId: 'c1', amount: '100.00' }] },
          'u1',
          fullAdmin,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.allocation.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when child does not exist', async () => {
      mockPrisma.child.findUnique.mockResolvedValue(null);

      await expect(
        service.create('missing', dto, 'u1', fullAdmin),
      ).rejects.toThrow('Child not found');
    });

    it('rejects zero amount', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({ id: 'child-1' });

      await expect(
        service.create('child-1', { ...dto, amount: '0' }, 'u1', fullAdmin),
      ).rejects.toThrow('Amount must be greater than 0');
    });
  });

  describe('create cash', () => {
    const cashDto = {
      amount: '1000.00',
      method: PaymentMethod.cash,
      receivedAt: '2026-10-11',
      cashDeskId: 'desk-1',
    };
    const shift = { id: 's1', deskId: 'desk-1' };

    beforeEach(() => {
      mockPrisma.payment.create.mockResolvedValue(payment());
      mockShifts.lockOpenShift.mockResolvedValue(shift);
    });

    it('requires a desk for cash', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({ id: 'child-1' });

      await expect(
        service.create(
          'child-1',
          { ...cashDto, cashDeskId: undefined },
          'u1',
          fullAdmin,
        ),
      ).rejects.toThrow('Cash desk is required');
      expect(mockPrisma.payment.create).not.toHaveBeenCalled();
    });

    it('refuses without an open shift and creates nothing', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({ id: 'child-1' });
      mockShifts.lockOpenShift.mockRejectedValue(
        new BadRequestException('No open cash shift'),
      );

      await expect(
        service.create('child-1', cashDto, 'u1', fullAdmin),
      ).rejects.toThrow('No open cash shift');
      expect(mockPrisma.payment.create).not.toHaveBeenCalled();
      expect(mockPrisma.cashEntry.create).not.toHaveBeenCalled();
    });

    it('records income with school direction for a school_class child', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({
        id: 'child-1',
        group: { institution: { type: 'school_class' } },
      });

      await service.create('child-1', cashDto, 'u1', fullAdmin);

      expect(mockShifts.lockOpenShift).toHaveBeenCalledWith(
        mockPrisma,
        'desk-1',
      );
      expect(mockPrisma.cashEntry.create).toHaveBeenCalledWith({
        data: {
          deskId: 'desk-1',
          shiftId: 's1',
          kind: 'income',
          amount: '1000.00',
          direction: 'school',
          paymentId: 'p1',
          createdById: 'u1',
        },
      });
    });

    it('uses shared direction for a child without a group', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({
        id: 'child-1',
        group: null,
      });

      await service.create('child-1', cashDto, 'u1', fullAdmin);

      const [[args]] = mockPrisma.cashEntry.create.mock.calls as [
        [{ data: { direction: string } }],
      ];
      expect(args.data.direction).toBe('shared');
    });

    it('ignores the desk for card payments', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({ id: 'child-1' });

      await service.create(
        'child-1',
        { ...cashDto, method: PaymentMethod.card },
        'u1',
        fullAdmin,
      );

      expect(mockShifts.lockOpenShift).not.toHaveBeenCalled();
      expect(mockPrisma.cashEntry.create).not.toHaveBeenCalled();
    });

    it('stores trimmed payer name and period', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({ id: 'child-1' });

      await service.create(
        'child-1',
        {
          ...cashDto,
          payerName: '  Ivan  ',
          periodFrom: '2026-09-01',
          periodTo: '2026-09-30',
        },
        'u1',
        fullAdmin,
      );

      const [[args]] = mockPrisma.payment.create.mock.calls as [
        [{ data: Record<string, unknown> }],
      ];
      expect(args.data.payerName).toBe('Ivan');
      expect(args.data.periodFrom).toEqual(new Date('2026-09-01'));
      expect(args.data.periodTo).toEqual(new Date('2026-09-30'));
    });

    it('turns an empty payer name into null', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({ id: 'child-1' });

      await service.create(
        'child-1',
        { ...cashDto, payerName: '   ' },
        'u1',
        fullAdmin,
      );

      const [[args]] = mockPrisma.payment.create.mock.calls as [
        [{ data: { payerName: unknown } }],
      ];
      expect(args.data.payerName).toBeNull();
    });

    it('rejects a period that ends before it starts', async () => {
      mockPrisma.child.findUnique.mockResolvedValue({ id: 'child-1' });

      await expect(
        service.create(
          'child-1',
          { ...cashDto, periodFrom: '2026-09-30', periodTo: '2026-09-01' },
          'u1',
          fullAdmin,
        ),
      ).rejects.toThrow('Period end is before start');
      expect(mockPrisma.payment.create).not.toHaveBeenCalled();
    });
  });

  describe('void', () => {
    it('voids the payment and its active allocations', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue(payment());
      mockPrisma.payment.update.mockResolvedValue(
        payment({ voidedAt: new Date() }),
      );

      await service.void('p1', 'wrong child', 'u1', fullAdmin);

      const data = {
        voidedAt: expect.any(Date) as Date,
        voidedById: 'u1',
        voidReason: 'wrong child',
      };
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(mockPrisma.allocation.updateMany).toHaveBeenCalledWith({
        where: { paymentId: 'p1', voidedAt: null },
        data,
      });
      expect(mockPrisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data,
      });
    });

    describe('with a cash entry', () => {
      const entry = (over: Record<string, unknown> = {}) => ({
        id: 'e1',
        deskId: 'desk-1',
        shiftId: 's1',
        direction: 'school',
        voidedAt: null,
        ...over,
      });
      const openShift = { id: 's1', deskId: 'desk-1', closedAt: null };
      const closedShift = { id: 's1', deskId: 'desk-1', closedAt: new Date() };

      beforeEach(() => {
        mockPrisma.payment.findUnique.mockResolvedValue(payment());
        mockPrisma.payment.update.mockResolvedValue(
          payment({ voidedAt: new Date() }),
        );
      });

      it('voids the entry when its shift is open', async () => {
        mockPrisma.cashEntry.findUnique.mockResolvedValue(entry());
        mockPrisma.cashShift.findUnique.mockResolvedValue(openShift);

        await service.void('p1', 'wrong child', 'u1', fullAdmin);

        expect(mockPrisma.cashEntry.update).toHaveBeenCalledWith({
          where: { id: 'e1' },
          data: {
            voidedAt: expect.any(Date) as Date,
            voidedById: 'u1',
            voidReason: 'wrong child',
          },
        });
        expect(mockPrisma.cashEntry.create).not.toHaveBeenCalled();
        expect(mockAlerts.create).toHaveBeenCalledWith(mockPrisma, {
          deskId: 'desk-1',
          shiftId: 's1',
          entryId: 'e1',
          type: 'payment_void',
          amount: d('1000.00'),
          actorId: 'u1',
        });
        expect(mockPrisma.payment.update).toHaveBeenCalled();
      });

      it('creates a negative correction in the open shift when the entry shift is closed', async () => {
        mockPrisma.cashEntry.findUnique.mockResolvedValue(entry());
        mockPrisma.cashShift.findUnique.mockResolvedValue(closedShift);
        mockShifts.lockOpenShift.mockResolvedValue({ id: 's2' });
        mockShifts.balance.mockResolvedValue(d('5000.00'));
        mockPrisma.cashEntry.create.mockResolvedValue({ id: 'e2' });

        await service.void('p1', 'wrong child', 'u1', fullAdmin);

        expect(mockShifts.lockOpenShift).toHaveBeenCalledWith(
          mockPrisma,
          'desk-1',
        );
        expect(mockPrisma.cashEntry.create).toHaveBeenCalledWith({
          data: {
            deskId: 'desk-1',
            shiftId: 's2',
            kind: 'correction',
            amount: d('1000.00'),
            sign: -1,
            direction: 'school',
            correctsId: 'e1',
            comment: 'Скасування оплати: wrong child',
            createdById: 'u1',
          },
        });
        expect(mockPrisma.cashEntry.update).not.toHaveBeenCalled();
        expect(mockAlerts.create).toHaveBeenCalledWith(mockPrisma, {
          deskId: 'desk-1',
          shiftId: 's2',
          entryId: 'e2',
          type: 'payment_void',
          amount: d('1000.00'),
          actorId: 'u1',
        });
      });

      it('refuses when the shift is closed and no shift is open', async () => {
        mockPrisma.cashEntry.findUnique.mockResolvedValue(entry());
        mockPrisma.cashShift.findUnique.mockResolvedValue(closedShift);
        mockShifts.lockOpenShift.mockRejectedValue(
          new BadRequestException('No open cash shift'),
        );

        await expect(service.void('p1', 'x', 'u1', fullAdmin)).rejects.toThrow(
          'No open cash shift',
        );
        expect(mockPrisma.payment.update).not.toHaveBeenCalled();
        expect(mockPrisma.allocation.updateMany).not.toHaveBeenCalled();
        expect(mockPrisma.cashEntry.create).not.toHaveBeenCalled();
      });

      it('refuses the correction when the open shift has not enough cash', async () => {
        mockPrisma.cashEntry.findUnique.mockResolvedValue(entry());
        mockPrisma.cashShift.findUnique.mockResolvedValue(closedShift);
        mockShifts.lockOpenShift.mockResolvedValue({ id: 's2' });
        mockShifts.balance.mockResolvedValue(d('999.99'));

        await expect(service.void('p1', 'x', 'u1', fullAdmin)).rejects.toThrow(
          'Not enough cash',
        );
        expect(mockPrisma.payment.update).not.toHaveBeenCalled();
        expect(mockPrisma.cashEntry.create).not.toHaveBeenCalled();
      });

      it('leaves the cash side alone when the entry is already voided', async () => {
        mockPrisma.cashEntry.findUnique.mockResolvedValue(
          entry({ voidedAt: new Date() }),
        );

        await service.void('p1', 'x', 'u1', fullAdmin);

        expect(mockPrisma.cashEntry.update).not.toHaveBeenCalled();
        expect(mockPrisma.cashEntry.create).not.toHaveBeenCalled();
        expect(mockAlerts.create).not.toHaveBeenCalled();
        expect(mockPrisma.payment.update).toHaveBeenCalled();
      });
    });

    it('rejects voiding twice', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue(
        payment({ voidedAt: new Date() }),
      );

      await expect(service.void('p1', 'x', 'u1', fullAdmin)).rejects.toThrow(
        'Payment is voided',
      );
    });

    it('throws NotFoundException when payment does not exist', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue(null);

      await expect(
        service.void('missing', 'x', 'u1', fullAdmin),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('voidAllocation', () => {
    it('voids an active allocation and returns the child id', async () => {
      mockPrisma.allocation.findUnique.mockResolvedValue({
        id: 'a1',
        payment: { childId: 'child-1' },
      });
      mockPrisma.allocation.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.voidAllocation(
        'a1',
        'wrong month',
        'u1',
        fullAdmin,
      );

      expect(result).toEqual({ childId: 'child-1' });
      expect(mockPrisma.allocation.updateMany).toHaveBeenCalledWith({
        where: { id: 'a1', voidedAt: null },
        data: {
          voidedAt: expect.any(Date) as Date,
          voidedById: 'u1',
          voidReason: 'wrong month',
        },
      });
    });

    it('rejects an already voided allocation', async () => {
      mockPrisma.allocation.findUnique.mockResolvedValue({
        id: 'a1',
        payment: { childId: 'child-1' },
      });
      mockPrisma.allocation.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.voidAllocation('a1', 'x', 'u1', fullAdmin),
      ).rejects.toThrow('Allocation is voided');
    });

    it('throws NotFoundException when allocation does not exist', async () => {
      mockPrisma.allocation.findUnique.mockResolvedValue(null);

      await expect(
        service.voidAllocation('missing', 'x', 'u1', fullAdmin),
      ).rejects.toThrow('Allocation not found');
    });
  });

  describe('scope', () => {
    beforeEach(() => {
      mockPrisma.child.findFirst.mockResolvedValue(null);
      mockPrisma.payment.findUnique.mockResolvedValue({ childId: 'child-1' });
    });

    it('hides the child on create', async () => {
      await expect(
        service.create(
          'child-1',
          {
            amount: '10.00',
            method: PaymentMethod.cash,
            reference: 'r',
            receivedAt: '2026-10-10',
          },
          'kg1',
          kgAccountant,
        ),
      ).rejects.toThrow('Child not found');
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('hides an out-of-scope payment on allocate and void', async () => {
      await expect(
        service.allocate('p1', [], 'kg1', kgAccountant),
      ).rejects.toThrow('Payment not found');
      await expect(
        service.void('p1', 'x', 'kg1', kgAccountant),
      ).rejects.toThrow('Payment not found');
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('hides an out-of-scope allocation on void', async () => {
      mockPrisma.allocation.findUnique.mockResolvedValue({
        id: 'a1',
        payment: { childId: 'child-1' },
      });
      await expect(
        service.voidAllocation('a1', 'x', 'kg1', kgAccountant),
      ).rejects.toThrow('Allocation not found');
      expect(mockPrisma.allocation.updateMany).not.toHaveBeenCalled();
    });
  });
});
