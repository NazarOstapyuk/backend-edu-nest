import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import {
  AccessScope,
  AuditAction,
  BillingMode,
  FinanceCategory,
  PermissionLevel,
  Prisma,
  Role,
  TariffUnit,
} from '@prisma/client';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { TariffsService } from './tariffs.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const d = (value: string) => new Prisma.Decimal(value);

const mockPrisma = {
  tariff: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  institution: { findUnique: jest.fn() },
  tariffPrice: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
  enrollment: { count: jest.fn() },
  adaptationVisit: { count: jest.fn() },
  package: { count: jest.fn() },
  classGroup: { count: jest.fn() },
  $transaction: jest.fn(),
};

const tariff = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  name: 'Садочок повний день',
  category: FinanceCategory.tuition,
  unit: TariffUnit.month,
  packageSize: null,
  validityDays: null,
  billingMode: BillingMode.calendar_full,
  isActive: true,
  institutionId: null,
  prices: [
    { id: 'p2', price: d('16500'), effectiveFrom: day('2027-01-01') },
    { id: 'p1', price: d('15500'), effectiveFrom: day('2026-09-01') },
  ],
  ...over,
});

const dto = {
  name: 'Садочок повний день',
  category: FinanceCategory.tuition,
  unit: TariffUnit.month,
  billingMode: BillingMode.calendar_full,
  price: '15500.00',
  effectiveFrom: '2026-09-01',
};

const admin: AuthenticatedUser = {
  id: 'u1',
  role: Role.admin,
  login: 'admin',
  mustChangePassword: false,
  accessScope: AccessScope.all,
  institutionIds: [],
  scopeInstitutionIds: null,
  permissions: { tariffs: PermissionLevel.edit },
};

const scoped: AuthenticatedUser = {
  ...admin,
  id: 'u2',
  accessScope: AccessScope.institutions,
  institutionIds: ['inst-a'],
  scopeInstitutionIds: ['inst-a'],
};

const mockAudit = { recordChange: jest.fn() };

describe('TariffsService', () => {
  let service: TariffsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(
      (callback: (tx: typeof mockPrisma) => unknown) => callback(mockPrisma),
    );
    const module = await Test.createTestingModule({
      providers: [
        TariffsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();
    service = module.get(TariffsService);
  });

  it('lists tariffs with the price effective today', async () => {
    mockPrisma.tariff.findMany.mockResolvedValue([tariff()]);

    const [view] = await service.list(admin, day('2026-10-11'));

    expect(view.currentPrice).toBe('15500.00');
    expect(view.prices.map((p) => p.price)).toEqual(['16500.00', '15500.00']);
  });

  describe('create', () => {
    it('creates a tariff with its first price', async () => {
      mockPrisma.tariff.findFirst.mockResolvedValue(null);
      mockPrisma.tariff.create.mockResolvedValue(
        tariff({ prices: [tariff().prices[1]] }),
      );

      const view = await service.create(dto, admin);

      expect(view.name).toBe('Садочок повний день');
      expect(mockPrisma.tariff.create).toHaveBeenCalledWith({
        data: {
          name: 'Садочок повний день',
          category: FinanceCategory.tuition,
          unit: TariffUnit.month,
          packageSize: null,
          validityDays: null,
          billingMode: BillingMode.calendar_full,
          institutionId: null,
          prices: {
            create: {
              price: '15500.00',
              effectiveFrom: day('2026-09-01'),
              createdById: 'u1',
            },
          },
        },
        include: { prices: { orderBy: { effectiveFrom: 'desc' } } },
      });
    });

    it('requires a package size for package tariffs', async () => {
      await expect(
        service.create({ ...dto, unit: TariffUnit.package }, admin),
      ).rejects.toThrow('Package size is required for package tariffs');
    });

    it('rejects a duplicate name', async () => {
      mockPrisma.tariff.findFirst.mockResolvedValue(tariff());

      await expect(service.create(dto, admin)).rejects.toThrow(
        'Tariff with this name already exists',
      );
    });

    it('rejects a zero price', async () => {
      await expect(
        service.create({ ...dto, price: '0.00' }, admin),
      ).rejects.toThrow('Amount must be greater than 0');
    });
  });

  describe('institutions', () => {
    it('lists shared and own tariffs only for a scoped user', async () => {
      mockPrisma.tariff.findMany.mockResolvedValue([]);

      await service.list(scoped);

      expect(mockPrisma.tariff.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { institutionId: null },
              { institutionId: { in: ['inst-a'] } },
            ],
          },
        }),
      );
    });

    it('lists everything for an unscoped user', async () => {
      mockPrisma.tariff.findMany.mockResolvedValue([]);

      await service.list(admin);

      expect(mockPrisma.tariff.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: undefined }),
      );
    });

    it('allows the same name in two institutions', async () => {
      mockPrisma.institution.findUnique.mockResolvedValue({
        id: 'inst-b',
        isActive: true,
      });
      mockPrisma.tariff.findFirst.mockResolvedValue(null);
      mockPrisma.tariff.create.mockResolvedValue(
        tariff({ institutionId: 'inst-b' }),
      );

      const view = await service.create(
        { ...dto, institutionId: 'inst-b' },
        admin,
      );

      expect(mockPrisma.tariff.findFirst).toHaveBeenCalledWith({
        where: { name: dto.name, institutionId: 'inst-b' },
      });
      expect(view.institutionId).toBe('inst-b');
    });

    it('rejects a duplicate name inside the same institution', async () => {
      mockPrisma.institution.findUnique.mockResolvedValue({
        id: 'inst-a',
        isActive: true,
      });
      mockPrisma.tariff.findFirst.mockResolvedValue(tariff());

      await expect(
        service.create({ ...dto, institutionId: 'inst-a' }, scoped),
      ).rejects.toThrow('Tariff with this name already exists');
    });

    it('refuses a scoped user creating a shared tariff', async () => {
      await expect(service.create(dto, scoped)).rejects.toThrow(
        'Outside access scope',
      );
      expect(mockPrisma.tariff.create).not.toHaveBeenCalled();
    });

    it('refuses creating in an institution outside the scope', async () => {
      await expect(
        service.create({ ...dto, institutionId: 'inst-b' }, scoped),
      ).rejects.toThrow('Outside access scope');
    });

    it('refuses an inactive institution', async () => {
      mockPrisma.institution.findUnique.mockResolvedValue({
        id: 'inst-a',
        isActive: false,
      });

      await expect(
        service.create({ ...dto, institutionId: 'inst-a' }, scoped),
      ).rejects.toThrow('Institution is inactive');
    });

    it('refuses a scoped admin editing a shared tariff', async () => {
      mockPrisma.tariff.findUnique.mockResolvedValue(tariff());

      await expect(
        service.update('t1', { isActive: false }, scoped),
      ).rejects.toThrow('Outside access scope');
      await expect(service.delete('t1', scoped)).rejects.toThrow(
        'Outside access scope',
      );
      expect(mockPrisma.tariff.update).not.toHaveBeenCalled();
    });

    it('hides a tariff of another institution from a scoped user', async () => {
      mockPrisma.tariff.findUnique.mockResolvedValue(
        tariff({ institutionId: 'inst-b' }),
      );

      await expect(
        service.update('t1', { isActive: false }, scoped),
      ).rejects.toThrow('Tariff not found');
    });

    it('lets a header-narrowed unscoped user change a shared tariff', async () => {
      mockPrisma.tariff.findUnique.mockResolvedValue(tariff());
      mockPrisma.tariff.update.mockResolvedValue(tariff({ isActive: false }));

      await service.update(
        't1',
        { isActive: false },
        { ...admin, scopeInstitutionIds: ['inst-a'] },
      );

      expect(mockPrisma.tariff.update).toHaveBeenCalledTimes(1);
    });

    it('refuses moving a used tariff to another institution', async () => {
      mockPrisma.tariff.findUnique.mockResolvedValue(tariff());
      mockPrisma.institution.findUnique.mockResolvedValue({
        id: 'inst-a',
        isActive: true,
      });
      mockPrisma.enrollment.count.mockResolvedValue(1);
      mockPrisma.adaptationVisit.count.mockResolvedValue(0);
      mockPrisma.classGroup.count.mockResolvedValue(0);

      await expect(
        service.update('t1', { institutionId: 'inst-a' }, admin),
      ).rejects.toThrow('Tariff is in use');
      expect(mockPrisma.tariff.update).not.toHaveBeenCalled();
    });

    it('moves an unused tariff and records the institution', async () => {
      mockPrisma.tariff.findUnique.mockResolvedValue(tariff());
      mockPrisma.institution.findUnique.mockResolvedValue({
        id: 'inst-a',
        isActive: true,
      });
      mockPrisma.enrollment.count.mockResolvedValue(0);
      mockPrisma.adaptationVisit.count.mockResolvedValue(0);
      mockPrisma.classGroup.count.mockResolvedValue(0);
      mockPrisma.tariff.findFirst.mockResolvedValue(null);
      mockPrisma.tariff.update.mockResolvedValue(
        tariff({ institutionId: 'inst-a' }),
      );

      await service.update('t1', { institutionId: 'inst-a' }, admin);

      expect(mockPrisma.tariff.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            institutionId: 'inst-a',
          }) as unknown,
        }),
      );
      expect(mockAudit.recordChange).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          fields: expect.arrayContaining(['institutionId']) as unknown,
        }),
      );
    });
  });

  describe('addPrice', () => {
    it('replaces the amount of a price on the same date', async () => {
      mockPrisma.tariff.findUnique.mockResolvedValue(tariff());
      mockPrisma.tariffPrice.findUnique.mockResolvedValue({ id: 'p1' });

      await service.addPrice(
        't1',
        { price: '17000.00', effectiveFrom: '2026-09-01' },
        admin,
      );

      expect(mockPrisma.tariffPrice.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { price: '17000.00' },
      });
      expect(mockPrisma.tariffPrice.create).not.toHaveBeenCalled();
    });

    it('adds a dated price', async () => {
      mockPrisma.tariff.findUnique.mockResolvedValue(tariff());
      mockPrisma.tariffPrice.findUnique.mockResolvedValue(null);

      await service.addPrice(
        't1',
        { price: '17000.00', effectiveFrom: '2027-09-01' },
        admin,
      );

      expect(mockPrisma.tariffPrice.create).toHaveBeenCalledWith({
        data: {
          tariffId: 't1',
          price: '17000.00',
          effectiveFrom: day('2027-09-01'),
          createdById: 'u1',
        },
      });
    });
  });

  describe('update', () => {
    it('refuses to change billing mode when enrollments exist', async () => {
      mockPrisma.tariff.findUnique.mockResolvedValue(tariff());
      mockPrisma.enrollment.count.mockResolvedValue(2);

      await expect(
        service.update('t1', { billingMode: BillingMode.anniversary }, admin),
      ).rejects.toThrow('Cannot change billing mode: tariff has enrollments');
      expect(mockPrisma.tariff.update).not.toHaveBeenCalled();
    });

    it('changes billing mode when there are no enrollments', async () => {
      mockPrisma.tariff.findUnique.mockResolvedValue(tariff());
      mockPrisma.enrollment.count.mockResolvedValue(0);
      mockPrisma.tariff.update.mockResolvedValue(
        tariff({ billingMode: BillingMode.anniversary }),
      );

      await service.update(
        't1',
        { billingMode: BillingMode.anniversary },
        admin,
      );

      expect(mockPrisma.tariff.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('update validityDays', () => {
    it('writes validityDays for a package tariff', async () => {
      mockPrisma.tariff.findUnique.mockResolvedValue(
        tariff({ unit: TariffUnit.package, packageSize: 4 }),
      );
      mockPrisma.tariff.update.mockResolvedValue(
        tariff({ unit: TariffUnit.package, packageSize: 4 }),
      );

      await service.update('t1', { validityDays: 30 }, admin);

      const arg = (
        mockPrisma.tariff.update.mock.calls[0] as [
          { data: { validityDays?: number } },
        ]
      )[0];
      expect(arg.data.validityDays).toBe(30);
    });

    it('ignores validityDays for a non-package tariff', async () => {
      mockPrisma.tariff.findUnique.mockResolvedValue(tariff());
      mockPrisma.tariff.update.mockResolvedValue(tariff());

      await service.update('t1', { validityDays: 30 }, admin);

      const arg = (
        mockPrisma.tariff.update.mock.calls[0] as [
          { data: { validityDays?: number } },
        ]
      )[0];
      expect(arg.data.validityDays).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('refuses to delete a tariff in use', async () => {
      mockPrisma.tariff.findUnique.mockResolvedValue(tariff());
      mockPrisma.enrollment.count.mockResolvedValue(1);
      mockPrisma.adaptationVisit.count.mockResolvedValue(0);
      mockPrisma.package.count.mockResolvedValue(0);
      mockPrisma.classGroup.count.mockResolvedValue(0);

      await expect(service.delete('t1', admin)).rejects.toThrow(
        'Cannot delete: tariff is in use',
      );
      expect(mockPrisma.tariff.delete).not.toHaveBeenCalled();
    });

    it('deletes an unused tariff with its prices', async () => {
      mockPrisma.tariff.findUnique.mockResolvedValue(tariff());
      mockPrisma.enrollment.count.mockResolvedValue(0);
      mockPrisma.adaptationVisit.count.mockResolvedValue(0);
      mockPrisma.package.count.mockResolvedValue(0);
      mockPrisma.classGroup.count.mockResolvedValue(0);

      await expect(service.delete('t1', admin)).resolves.toEqual({
        message: 'Tariff deleted',
      });
      expect(mockPrisma.tariffPrice.deleteMany).toHaveBeenCalledWith({
        where: { tariffId: 't1' },
      });
      expect(mockPrisma.tariff.delete).toHaveBeenCalledWith({
        where: { id: 't1' },
      });
    });

    it('throws NotFoundException for an unknown tariff', async () => {
      mockPrisma.tariff.findUnique.mockResolvedValue(null);

      await expect(service.delete('missing', admin)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('audit', () => {
    it('records the created tariff with its prices', async () => {
      mockPrisma.tariff.findFirst.mockResolvedValue(null);
      mockPrisma.tariff.create.mockResolvedValue(
        tariff({ prices: [tariff().prices[1]] }),
      );

      await service.create(dto, admin);

      expect(mockAudit.recordChange).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          actorId: 'u1',
          entityType: 'tariffs',
          entityId: 't1',
          action: AuditAction.create,
          before: null,
          after: expect.objectContaining({
            name: 'Садочок повний день',
            prices: ['15500.00@2026-09-01'],
          }) as unknown,
        }),
      );
    });

    it('records the changed billing mode on update', async () => {
      mockPrisma.tariff.findUnique.mockResolvedValue(tariff());
      mockPrisma.enrollment.count.mockResolvedValue(0);
      mockPrisma.tariff.update.mockResolvedValue(
        tariff({ billingMode: BillingMode.anniversary }),
      );

      await service.update(
        't1',
        { billingMode: BillingMode.anniversary },
        admin,
      );

      expect(mockAudit.recordChange).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          actorId: 'u1',
          entityType: 'tariffs',
          entityId: 't1',
          action: AuditAction.update,
          before: expect.objectContaining({
            billingMode: BillingMode.calendar_full,
          }) as unknown,
          after: expect.objectContaining({
            billingMode: BillingMode.anniversary,
          }) as unknown,
        }),
      );
    });

    it('records the prices before and after adding a price', async () => {
      mockPrisma.tariff.findUnique
        .mockResolvedValueOnce(tariff())
        .mockResolvedValueOnce(
          tariff({
            prices: [
              { id: 'p3', price: d('17000'), effectiveFrom: day('2027-09-01') },
              ...tariff().prices,
            ],
          }),
        );
      mockPrisma.tariffPrice.findUnique.mockResolvedValue(null);

      await service.addPrice(
        't1',
        { price: '17000.00', effectiveFrom: '2027-09-01' },
        admin,
      );

      expect(mockAudit.recordChange).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          actorId: 'u1',
          entityType: 'tariffs',
          entityId: 't1',
          action: AuditAction.update,
          fields: ['prices'],
          before: expect.objectContaining({
            prices: ['16500.00@2027-01-01', '15500.00@2026-09-01'],
          }) as unknown,
          after: expect.objectContaining({
            prices: [
              '17000.00@2027-09-01',
              '16500.00@2027-01-01',
              '15500.00@2026-09-01',
            ],
          }) as unknown,
        }),
      );
    });

    it('records a deleted tariff', async () => {
      mockPrisma.tariff.findUnique.mockResolvedValue(tariff());
      mockPrisma.enrollment.count.mockResolvedValue(0);
      mockPrisma.adaptationVisit.count.mockResolvedValue(0);
      mockPrisma.package.count.mockResolvedValue(0);
      mockPrisma.classGroup.count.mockResolvedValue(0);

      await service.delete('t1', admin);

      expect(mockAudit.recordChange).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          actorId: 'u1',
          entityType: 'tariffs',
          entityId: 't1',
          action: AuditAction.delete,
          after: null,
        }),
      );
    });
  });
});
