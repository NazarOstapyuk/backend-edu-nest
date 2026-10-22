import { ForbiddenException } from '@nestjs/common';
import {
  AccessScope,
  GroupKind,
  NoticeStatus,
  PaymentMethod,
  PaymentStatus,
  PayrollStatus,
  Prisma,
  Role,
} from '@prisma/client';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { DashboardService } from './dashboard.service';

const makeUser = (
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser => ({
  id: 'u1',
  role: Role.admin,
  login: 'a',
  mustChangePassword: false,
  accessScope: AccessScope.all,
  institutionIds: [] as string[],
  scopeInstitutionIds: null as string[] | null,
  permissions: {},
  ...overrides,
});

const allView: AuthenticatedUser['permissions'] = {
  users: 'view',
  children: 'view',
  finance: 'view',
  tariffs: 'view',
  classes: 'view',
  register: 'view',
  timetable: 'view',
  meals: 'view',
  payroll: 'view',
  backups: 'view',
  settings: 'view',
  audit: 'view',
};

const containing = (value: object): object =>
  expect.objectContaining(value) as object;

const kindergarten = { group: { institutionId: { in: ['inst-k'] } } };

describe('DashboardService', () => {
  let service: DashboardService;
  const prisma = {
    group: { findMany: jest.fn() },
    absenceNotice: { count: jest.fn() },
    child: { findMany: jest.fn() },
    mealOrder: { findMany: jest.fn() },
    payment: { findMany: jest.fn() },
    paymentInvoice: { count: jest.fn() },
    user: { findMany: jest.fn() },
  };
  const calendar = { entriesBetween: jest.fn() };
  const backups = { status: jest.fn() };
  const onlinePayments = { config: jest.fn() };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-16T10:00:00.000Z'));
    jest.resetAllMocks();
    prisma.group.findMany.mockResolvedValue([]);
    prisma.absenceNotice.count.mockResolvedValue(0);
    prisma.child.findMany.mockResolvedValue([]);
    prisma.mealOrder.findMany.mockResolvedValue([]);
    prisma.payment.findMany.mockResolvedValue([]);
    prisma.paymentInvoice.count.mockResolvedValue(0);
    prisma.user.findMany.mockResolvedValue([]);
    calendar.entriesBetween.mockResolvedValue([]);
    backups.status.mockResolvedValue({ configured: true, stale: false });
    onlinePayments.config.mockReturnValue({ enabled: false });
    service = new DashboardService(
      prisma as never,
      calendar as never,
      backups as never,
      onlinePayments as never,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('rejects parents', async () => {
    await expect(
      service.today(makeUser({ role: Role.parent })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('gives a staff user without access only the date', async () => {
    expect(await service.today(makeUser())).toEqual({ date: '2026-10-16' });
  });

  it('gives a plain teacher only own-group register and meals', async () => {
    const result = await service.today(makeUser({ role: Role.teacher }));
    expect(Object.keys(result).sort()).toEqual(['date', 'meals', 'register']);
    expect(prisma.group.findMany).toHaveBeenCalledWith(
      containing({
        where: { teachers: { some: { id: 'u1' } } },
      }),
    );
    expect(prisma.mealOrder.findMany).toHaveBeenCalledWith(
      containing({
        where: {
          date: new Date('2026-10-16T00:00:00.000Z'),
          cancelledAt: null,
          child: {
            AND: [{}, { group: { teachers: { some: { id: 'u1' } } } }],
          },
        },
      }),
    );
    expect(prisma.absenceNotice.count).not.toHaveBeenCalled();
    expect(prisma.payment.findMany).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(backups.status).not.toHaveBeenCalled();
  });

  it('treats a teacher with register and meals permissions as a manager', async () => {
    await service.today(
      makeUser({
        role: Role.teacher,
        permissions: { register: 'view', meals: 'view' },
      }),
    );
    expect(prisma.group.findMany).toHaveBeenCalledWith(
      containing({ where: {} }),
    );
    expect(prisma.mealOrder.findMany).toHaveBeenCalledWith(
      containing({
        where: containing({ child: {} }),
      }),
    );
  });

  it('applies the kindergarten scope to every section', async () => {
    onlinePayments.config.mockReturnValue({ enabled: true });
    prisma.paymentInvoice.count.mockResolvedValue(2);
    const result = await service.today(
      makeUser({
        accessScope: AccessScope.institutions,
        institutionIds: ['inst-k'],
        scopeInstitutionIds: ['inst-k'],
        permissions: { ...allView },
      }),
    );
    expect(result.onlinePending).toEqual({ count: 2 });
    expect(prisma.group.findMany).toHaveBeenCalledWith(
      containing({ where: { institutionId: { in: ['inst-k'] } } }),
    );
    expect(prisma.absenceNotice.count).toHaveBeenCalledWith({
      where: { status: NoticeStatus.pending, child: kindergarten },
    });
    expect(prisma.child.findMany).toHaveBeenCalledWith(
      containing({ where: kindergarten }),
    );
    expect(prisma.mealOrder.findMany).toHaveBeenCalledWith(
      containing({
        where: containing({ child: kindergarten }),
      }),
    );
    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      containing({
        where: containing({ child: kindergarten }),
      }),
    );
    expect(prisma.paymentInvoice.count).toHaveBeenCalledWith({
      where: containing({ request: { child: kindergarten } }),
    });
  });

  it('filters register marks and approved notices to today', async () => {
    await service.today(makeUser({ permissions: { register: 'view' } }));
    expect(prisma.group.findMany).toHaveBeenCalledWith(
      containing({
        select: containing({
          children: {
            select: {
              dailyAttendances: containing({
                where: {
                  date: new Date('2026-10-16T00:00:00.000Z'),
                  voidedAt: null,
                },
              }),
              absenceNotices: containing({
                where: {
                  status: NoticeStatus.approved,
                  startDate: { lte: new Date('2026-10-16T00:00:00.000Z') },
                  endDate: { gte: new Date('2026-10-16T00:00:00.000Z') },
                },
              }),
            },
          },
        }),
      }),
    );
  });

  it('narrows a kindergarten-scoped plain teacher to own groups in scope', async () => {
    await service.today(
      makeUser({
        role: Role.teacher,
        accessScope: AccessScope.institutions,
        institutionIds: ['inst-k'],
        scopeInstitutionIds: ['inst-k'],
      }),
    );
    expect(prisma.group.findMany).toHaveBeenCalledWith(
      containing({
        where: {
          teachers: { some: { id: 'u1' } },
          institutionId: { in: ['inst-k'] },
        },
      }),
    );
    expect(prisma.mealOrder.findMany).toHaveBeenCalledWith(
      containing({
        where: containing({
          child: {
            AND: [
              kindergarten,
              { group: { teachers: { some: { id: 'u1' } } } },
            ],
          },
        }),
      }),
    );
  });

  it('bounds payments to the Kyiv day', async () => {
    await service.today(makeUser({ permissions: { finance: 'view' } }));
    expect(prisma.payment.findMany).toHaveBeenCalledWith(
      containing({
        where: {
          voidedAt: null,
          status: PaymentStatus.confirmed,
          receivedAt: {
            gte: new Date('2026-10-15T21:00:00.000Z'),
            lt: new Date('2026-10-16T21:00:00.000Z'),
          },
          child: {},
        },
      }),
    );
  });

  it('sums payments by method', async () => {
    prisma.payment.findMany.mockResolvedValue([
      { method: PaymentMethod.cash, amount: new Prisma.Decimal('100') },
      { method: PaymentMethod.online, amount: new Prisma.Decimal('50.5') },
    ]);
    const result = await service.today(
      makeUser({ permissions: { finance: 'view' } }),
    );
    expect(result.payments).toEqual({
      total: '150.50',
      count: 2,
      byMethod: {
        cash: '100.00',
        bank_transfer: '0.00',
        card: '0.00',
        online: '50.50',
      },
    });
  });

  it('omits onlinePending when disabled or zero', async () => {
    const finance = makeUser({ permissions: { finance: 'view' } });
    prisma.paymentInvoice.count.mockResolvedValue(3);
    expect(await service.today(finance)).not.toHaveProperty('onlinePending');
    expect(prisma.paymentInvoice.count).not.toHaveBeenCalled();
    onlinePayments.config.mockReturnValue({ enabled: true });
    prisma.paymentInvoice.count.mockResolvedValue(0);
    expect(await service.today(finance)).not.toHaveProperty('onlinePending');
  });

  it('counts invoices pending for more than 15 minutes', async () => {
    onlinePayments.config.mockReturnValue({ enabled: true });
    await service.today(makeUser({ permissions: { finance: 'view' } }));
    expect(prisma.paymentInvoice.count).toHaveBeenCalledWith({
      where: {
        status: 'pending',
        createdAt: { lt: new Date('2026-10-16T09:45:00.000Z') },
        request: { child: {} },
      },
    });
  });

  it('counts children with overdue debt', async () => {
    const overdue = {
      id: 'c1',
      category: 'tuition',
      amount: new Prisma.Decimal('100'),
      description: 'Tuition',
      periodStart: new Date('2026-09-01T00:00:00.000Z'),
      periodEnd: new Date('2026-09-30T00:00:00.000Z'),
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      voidedAt: null,
      allocations: [],
    };
    prisma.child.findMany.mockResolvedValue([
      { charges: [overdue], payments: [] },
      { charges: [], payments: [] },
    ]);
    const result = await service.today(
      makeUser({ permissions: { finance: 'view' } }),
    );
    expect(result.debts).toEqual({ children: 1, amount: '100.00' });
  });

  it('lists teachers without an approved sheet for the previous month', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 't1', firstName: 'Anna', lastName: 'Koval', payrollSheets: [] },
      {
        id: 't2',
        firstName: 'Olha',
        lastName: 'Bondar',
        payrollSheets: [{ id: 's1' }],
      },
    ]);
    const result = await service.today(
      makeUser({ permissions: { payroll: 'view' } }),
    );
    expect(result.payroll).toEqual({
      month: '09.2026',
      count: 1,
      names: ['Koval Anna'],
      more: 0,
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      containing({
        where: {
          salaryTerms: {
            some: {
              validFrom: { lte: new Date('2026-09-30T00:00:00.000Z') },
              OR: [
                { validTo: null },
                { validTo: { gte: new Date('2026-09-01T00:00:00.000Z') } },
              ],
            },
          },
        },
        select: containing({
          payrollSheets: {
            where: {
              month: new Date('2026-09-01T00:00:00.000Z'),
              status: PayrollStatus.approved,
            },
            select: { id: true },
          },
        }),
      }),
    );
  });

  it('omits backups when healthy and shows them otherwise', async () => {
    const user = makeUser({ permissions: { backups: 'view' } });
    expect(await service.today(user)).not.toHaveProperty('backups');
    backups.status.mockResolvedValue({ configured: true, stale: true });
    expect((await service.today(user)).backups).toEqual({
      configured: true,
      stale: true,
    });
    backups.status.mockResolvedValue({ configured: false, stale: false });
    expect((await service.today(user)).backups).toEqual({
      configured: false,
      stale: false,
    });
  });

  it('gives root every section', async () => {
    onlinePayments.config.mockReturnValue({ enabled: true });
    prisma.paymentInvoice.count.mockResolvedValue(1);
    backups.status.mockResolvedValue({ configured: false, stale: false });
    const result = await service.today(makeUser({ role: Role.root }));
    expect(Object.keys(result).sort()).toEqual([
      'backups',
      'date',
      'debts',
      'meals',
      'notices',
      'onlinePending',
      'payments',
      'payroll',
      'register',
    ]);
  });

  it('marks groups with unmarked children on a working day', async () => {
    prisma.group.findMany.mockResolvedValue([
      {
        id: 'g1',
        name: 'Sunflowers',
        kind: GroupKind.kindergarten,
        children: [{ dailyAttendances: [], absenceNotices: [] }],
      },
    ]);
    const result = await service.today(
      makeUser({ permissions: { register: 'view' } }),
    );
    expect(result.register).toEqual({
      count: 1,
      names: ['Sunflowers'],
      more: 0,
    });
    expect(calendar.entriesBetween).toHaveBeenCalledWith(
      new Date('2026-10-16T00:00:00.000Z'),
      new Date('2026-10-16T00:00:00.000Z'),
    );
  });
});
