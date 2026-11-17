import { NotFoundException } from '@nestjs/common';
import { AccessScope, Prisma, Role } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ReportQueryDto } from './dto/report-query.dto';
import { FinanceReportsService } from './finance-reports.service';

describe('FinanceReportsService cash', () => {
  const prisma = {
    group: { findUnique: jest.fn() },
    institution: { findUnique: jest.fn() },
    cashEntry: { findMany: jest.fn() },
    cashShift: { findMany: jest.fn(), findUnique: jest.fn() },
    payment: { findMany: jest.fn() },
  };
  let service: FinanceReportsService;
  const admin = {
    id: 'u1',
    role: Role.admin,
    login: 'a',
    mustChangePassword: false,
    accessScope: AccessScope.all,
    institutionIds: [],
    scopeInstitutionIds: null,
    permissions: {},
  } as never;
  type Call = [{ where: Record<string, unknown> }];
  const wherePassed = () =>
    (prisma.cashEntry.findMany.mock.calls as Call[])[0][0].where;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.cashEntry.findMany.mockResolvedValue([]);
    prisma.cashShift.findMany.mockResolvedValue([]);
    prisma.payment.findMany.mockResolvedValue([]);
    service = new FinanceReportsService(prisma as never);
  });

  it('filters entries by Kyiv day bounds and plain filters', async () => {
    await service.cash(
      {
        from: '2026-11-01',
        to: '2026-11-30',
        deskId: 'd1',
        employeeId: 'e1',
        direction: 'school',
        entryKind: 'expense',
      },
      admin,
    );
    expect(wherePassed()).toMatchObject({
      deskId: 'd1',
      createdById: 'e1',
      direction: 'school',
      kind: 'expense',
      createdAt: {
        gte: new Date('2026-10-31T22:00:00.000Z'),
        lt: new Date('2026-11-30T22:00:00.000Z'),
      },
    });
    expect(wherePassed().payment).toBeUndefined();
  });

  it('limits entries to income through the payment for child filters', async () => {
    await service.cash(
      {
        from: '2026-11-01',
        to: '2026-11-30',
        childId: 'c1',
        category: 'meals',
      },
      admin,
    );
    expect(wherePassed().kind).toBe('income');
    expect(wherePassed().payment).toEqual({
      category: 'meals',
      child: { id: 'c1' },
    });
  });

  it('returns no rows for a non-income kind combined with a payment filter', async () => {
    await service.cash(
      {
        from: '2026-11-01',
        to: '2026-11-30',
        childId: 'c1',
        entryKind: 'expense',
      },
      admin,
    );
    expect(wherePassed()).toEqual({ id: { in: [] } });
  });

  it('keeps non-income entries for a scoped user without explicit filters', async () => {
    const scoped = {
      ...(admin as object),
      accessScope: AccessScope.institutions,
      institutionIds: ['i1'],
      scopeInstitutionIds: ['i1'],
    } as never;
    await service.cash({ from: '2026-11-01', to: '2026-11-30' }, scoped);
    const where = wherePassed();
    expect(where.kind).toBeUndefined();
    expect(where.OR).toEqual([
      { kind: { not: 'income' } },
      { payment: { child: { group: { institutionId: { in: ['i1'] } } } } },
    ]);
  });

  it('keeps non-income entries when an institution is selected', async () => {
    prisma.institution.findUnique.mockResolvedValue({ id: 'i2' });
    await service.cash(
      { from: '2026-11-01', to: '2026-11-30', institutionId: 'i2' },
      admin,
    );
    const where = wherePassed();
    expect(where.kind).toBeUndefined();
    expect(where.payment).toBeUndefined();
    expect(where.OR).toEqual([
      { kind: { not: 'income' } },
      { payment: { child: { group: { institutionId: { in: ['i2'] } } } } },
    ]);
  });

  it('ignores scope and institution in shift mode', async () => {
    const scoped = {
      ...(admin as object),
      accessScope: AccessScope.institutions,
      institutionIds: ['i1'],
      scopeInstitutionIds: ['i1'],
    } as never;
    prisma.cashShift.findUnique.mockResolvedValue({
      openedAt: new Date('2026-11-10T06:00:00.000Z'),
    });
    await service.cash({ shiftId: 's1', institutionId: 'i9' }, scoped);
    expect(wherePassed()).toEqual({ shiftId: 's1' });
    expect(prisma.institution.findUnique).not.toHaveBeenCalled();
    expect(
      (prisma.payment.findMany.mock.calls as Call[])[0][0].where.child,
    ).toEqual({});
  });

  it('applies the direction filter to the category sheet', async () => {
    prisma.payment.findMany.mockResolvedValue([
      {
        category: 'meals',
        method: 'cash',
        amount: new Prisma.Decimal('10'),
        child: { group: { institution: { type: 'school_class' } } },
      },
      {
        category: 'meals',
        method: 'cash',
        amount: new Prisma.Decimal('7'),
        child: { group: { institution: { type: 'kindergarten' } } },
      },
    ]);
    const report = await service.cash(
      { from: '2026-11-01', to: '2026-11-30', direction: 'school' },
      admin,
    );
    expect(
      report.sheets.find((s) => s.name === 'За категоріями оплат')?.totals,
    ).toMatchObject({ total: '10.00' });
  });

  it('queries only confirmed non-voided payments for the category sheet', async () => {
    await service.cash({ from: '2026-11-01', to: '2026-11-30' }, admin);
    expect(
      (prisma.payment.findMany.mock.calls as Call[])[0][0].where,
    ).toMatchObject({
      voidedAt: null,
      status: 'confirmed',
    });
  });

  it('maps tuition payments to a direction by institution type', async () => {
    prisma.payment.findMany.mockResolvedValue([
      {
        category: 'tuition',
        method: 'cash',
        amount: new Prisma.Decimal('10'),
        child: { group: { institution: { type: 'school_class' } } },
      },
    ]);
    const report = await service.cash(
      { from: '2026-11-01', to: '2026-11-30' },
      admin,
    );
    expect(
      report.sheets.find((s) => s.name === 'За категоріями оплат')?.rows[0],
    ).toMatchObject({ category: 'Абонемент школи', cash: '10.00' });
  });

  it('uses a single shift without a period', async () => {
    prisma.cashShift.findUnique.mockResolvedValue({
      openedAt: new Date('2026-11-10T06:00:00.000Z'),
    });
    const report = await service.cash({ shiftId: 's1' }, admin);
    expect(report.fileName).toBe('каса-зміна-10.11.2026');
    expect(wherePassed()).toMatchObject({ shiftId: 's1' });
    expect(wherePassed().createdAt).toBeUndefined();
  });

  it('rejects an unknown shift', async () => {
    prisma.cashShift.findUnique.mockResolvedValue(null);
    await expect(service.cash({ shiftId: 's1' }, admin)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('ReportQueryDto cash filters', () => {
  const id = '0b7e6a52-6f4d-4c1b-8d3e-2f6c1a9b7e10';

  it('accepts cash filters', async () => {
    const ok = plainToInstance(ReportQueryDto, {
      deskId: id,
      employeeId: id,
      shiftId: id,
      direction: 'school',
      category: 'tuition',
      entryKind: 'transfer',
    });
    expect(await validate(ok, { whitelist: true })).toEqual([]);
    expect(ok.entryKind).toBe('transfer');
  });

  it('rejects bad cash filters', async () => {
    const bad = plainToInstance(ReportQueryDto, {
      direction: 'x',
      entryKind: 'y',
      deskId: 'z',
    });
    expect(await validate(bad, { whitelist: true })).toHaveLength(3);
  });
});
