import { Test } from '@nestjs/testing';
import {
  AttendanceStatus,
  FinanceCategory,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ParentCabinetService } from './parent-cabinet.service';

const day = (v: string) => new Date(`${v}T00:00:00.000Z`);
const d = (v: string) => new Prisma.Decimal(v);
const TODAY = day('2026-10-12');

const mockPrisma = {
  child: { findFirst: jest.fn(), findMany: jest.fn() },
  charge: { findMany: jest.fn() },
  payment: { findMany: jest.fn() },
};

const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];

const moneyChild = (id: string, chargeAmount: string) => ({
  id,
  firstName: 'Ann',
  lastName: id,
  middleName: null,
  group: null,
  charges: [
    {
      id: `c-${id}`,
      description: 'x',
      category: FinanceCategory.tuition,
      amount: d(chargeAmount),
      periodStart: day('2026-09-01'),
      periodEnd: day('2026-09-30'),
      createdAt: new Date('2026-08-27T10:00:00Z'),
      voidedAt: null,
      allocations: [],
    },
  ],
  payments: [],
});

describe('ParentCabinetService', () => {
  let service: ParentCabinetService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        ParentCabinetService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();
    service = module.get(ParentCabinetService);
  });

  it('returns the family with totals for the parent only', async () => {
    mockPrisma.child.findMany.mockResolvedValue([
      moneyChild('A', '1000'),
      moneyChild('B', '500'),
    ]);

    const family = await service.family('parent-1', TODAY);

    expect(
      firstArg<{ where: unknown }>(mockPrisma.child.findMany).where,
    ).toEqual({
      parents: { some: { id: 'parent-1' } },
    });
    expect(family.totals).toEqual({
      due: '1500.00',
      overdue: '1500.00',
      prepayment: '0.00',
    });
    expect(family.children.map((c) => c.due)).toEqual(['1000.00', '500.00']);
  });

  it('includes categorized prepayment and unallocated in child and family prepayment', async () => {
    const child = moneyChild('A', '100');
    mockPrisma.child.findMany.mockResolvedValue([
      {
        ...child,
        payments: [
          {
            amount: d('50'),
            category: FinanceCategory.extra_classes,
            status: PaymentStatus.confirmed,
            voidedAt: null,
            allocations: [],
          },
          {
            amount: d('25.50'),
            category: null,
            status: PaymentStatus.confirmed,
            voidedAt: null,
            allocations: [],
          },
        ],
      },
    ]);

    const family = await service.family('parent-1', TODAY);

    expect(family.children[0].prepayment).toBe('75.50');
    expect(family.totals.prepayment).toBe('75.50');
  });

  it('hides a child of another family on the card', async () => {
    mockPrisma.child.findFirst.mockResolvedValue(null);

    await expect(service.card('parent-1', 'foreign', TODAY)).rejects.toThrow(
      'Child not found',
    );
    expect(mockPrisma.child.findFirst).toHaveBeenCalledTimes(1);
    expect(
      firstArg<{ where: unknown }>(mockPrisma.child.findFirst).where,
    ).toEqual({
      id: 'foreign',
      parents: { some: { id: 'parent-1' } },
    });
  });

  it('hides a child of another family', async () => {
    mockPrisma.child.findFirst.mockResolvedValue(null);

    await expect(service.finance('parent-1', 'foreign', TODAY)).rejects.toThrow(
      'Child not found',
    );
    expect(
      firstArg<{ where: unknown }>(mockPrisma.child.findFirst).where,
    ).toEqual({
      id: 'foreign',
      parents: { some: { id: 'parent-1' } },
    });
  });

  it('builds the finance view without voided or unconfirmed records and internal fields', async () => {
    mockPrisma.child.findFirst.mockResolvedValue({ id: 'A' });
    mockPrisma.charge.findMany.mockResolvedValue([
      {
        id: 'c1',
        category: FinanceCategory.tuition,
        description: 'Садочок, вересень',
        amount: d('1000'),
        periodStart: day('2026-09-01'),
        periodEnd: day('2026-09-30'),
        createdAt: new Date('2026-08-27T10:00:00Z'),
        voidedAt: null,
        allocations: [{ amount: d('400'), voidedAt: null }],
      },
    ]);
    mockPrisma.payment.findMany.mockResolvedValue([
      {
        id: 'p1',
        amount: d('400'),
        category: FinanceCategory.tuition,
        method: PaymentMethod.cash,
        status: PaymentStatus.confirmed,
        receivedAt: new Date('2026-09-05T10:00:00Z'),
        voidedAt: null,
        allocations: [
          {
            amount: d('400'),
            voidedAt: null,
            chargeId: 'c1',
            charge: { description: 'Садочок, вересень' },
          },
        ],
      },
    ]);

    const view = await service.finance('parent-1', 'A', TODAY);

    expect(
      firstArg<{ where: unknown }>(mockPrisma.charge.findMany).where,
    ).toEqual({ childId: 'A', voidedAt: null });
    expect(
      firstArg<{ where: unknown }>(mockPrisma.payment.findMany).where,
    ).toEqual({
      childId: 'A',
      voidedAt: null,
      status: PaymentStatus.confirmed,
    });
    expect(view.charges[0]).toEqual({
      id: 'c1',
      category: FinanceCategory.tuition,
      description: 'Садочок, вересень',
      periodStart: day('2026-09-01'),
      periodEnd: day('2026-09-30'),
      amount: '1000.00',
      paid: '400.00',
      remaining: '600.00',
      state: 'partial',
      overdue: true,
      createdAt: new Date('2026-08-27T10:00:00Z'),
    });
    expect(view.payments[0]).toEqual({
      id: 'p1',
      receivedAt: new Date('2026-09-05T10:00:00Z'),
      amount: '400.00',
      method: PaymentMethod.cash,
      category: FinanceCategory.tuition,
      allocated: '400.00',
      free: '0.00',
      allocations: [
        { chargeId: 'c1', description: 'Садочок, вересень', amount: '400.00' },
      ],
    });
    expect(view.unallocated).toBe('0.00');
  });

  it('merges visits newest first', async () => {
    mockPrisma.child.findFirst
      .mockResolvedValueOnce({ id: 'A' })
      .mockResolvedValueOnce({
        id: 'A',
        firstName: 'Ann',
        lastName: 'Ant',
        middleName: null,
        birthDate: day('2021-03-01'),
        group: { id: 'g1', name: 'Сонечко' },
        parents: [],
        enrollments: [],
        packages: [],
        lessonAttendances: [
          {
            status: AttendanceStatus.present,
            isGuest: false,
            lesson: {
              date: day('2026-10-10'),
              classGroup: { name: 'LEGO 1', direction: { name: 'LEGO' } },
            },
          },
        ],
        adaptationVisits: [{ date: day('2026-10-11'), hours: d('2.5') }],
        subscriptions: [
          {
            subscriptionType: { name: 'Футбол' },
            attendances: [
              { date: new Date('2026-05-03T09:00:00Z'), note: null },
            ],
          },
        ],
      });

    const card = await service.card('parent-1', 'A', TODAY);

    expect(card.visits).toEqual([
      { type: 'adaptation', date: day('2026-10-11'), hours: '2.50' },
      {
        type: 'lesson',
        date: day('2026-10-10'),
        groupName: 'LEGO 1',
        directionName: 'LEGO',
        status: AttendanceStatus.present,
        isGuest: false,
      },
      {
        type: 'legacy',
        date: day('2026-05-03'),
        note: null,
        directionName: 'Футбол',
      },
    ]);
  });
});
