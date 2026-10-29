import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AuditAction,
  ClassFormat,
  PayrollCalendar,
  PayrollLessonType,
  Prisma,
  Role,
  AccessScope,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SalaryTermsService } from './salary-terms.service';
import { termsInclude } from './terms-view';
import type { CreateSalaryTermsDto } from './dto/salary-terms.dto';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const dec = (value: string) => new Prisma.Decimal(value);

const admin = {
  id: 'a1',
  role: Role.admin,
  login: 'admin',
  mustChangePassword: false,
  accessScope: AccessScope.all,
  institutionIds: [] as string[],
  scopeInstitutionIds: null as string[] | null,
  permissions: {},
};

const row = (over: Record<string, unknown> = {}) => ({
  id: 'st1',
  teacherId: 't1',
  validFrom: day('2099-01-01'),
  validTo: null,
  monthlyRate: dec('20000'),
  extraHourRate: null,
  calendarKind: PayrollCalendar.all,
  note: null,
  createdById: 'a1',
  createdAt: new Date('2026-10-01T10:00:00Z'),
  rates: [],
  allowances: [],
  teacher: { payrollDetailsVisible: false },
  ...over,
});

const createDto = (
  over: Partial<CreateSalaryTermsDto> = {},
): CreateSalaryTermsDto => ({
  teacherId: 't1',
  validFrom: '2026-11-01',
  monthlyRate: '20000',
  calendarKind: PayrollCalendar.all,
  rates: [],
  allowances: [],
  ...over,
});

const mockPrisma = {
  user: { findUnique: jest.fn() },
  subject: { findMany: jest.fn() },
  classGroup: { findMany: jest.fn() },
  salaryTerms: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  },
  salaryRate: { deleteMany: jest.fn(), createMany: jest.fn() },
  salaryAllowance: { deleteMany: jest.fn(), createMany: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};

const mockAudit = { recordChange: jest.fn() };

describe('SalaryTermsService', () => {
  let service: SalaryTermsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(
      (callback: (tx: typeof mockPrisma) => unknown) => callback(mockPrisma),
    );
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.subject.findMany.mockResolvedValue([]);
    mockPrisma.classGroup.findMany.mockResolvedValue([]);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 't1',
      role: Role.teacher,
      isActive: true,
    });
    mockPrisma.salaryTerms.findMany.mockResolvedValue([]);
    mockPrisma.salaryTerms.create.mockResolvedValue(row());
    mockPrisma.salaryTerms.findUnique.mockResolvedValue(row());
    const module = await Test.createTestingModule({
      providers: [
        SalaryTermsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();
    service = module.get(SalaryTermsService);
  });

  describe('create', () => {
    it('rejects a missing teacher', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.create(createDto(), admin)).rejects.toThrow(
        new NotFoundException('Teacher not found'),
      );
    });

    it('rejects a user who is not a teacher', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 't1',
        role: Role.parent,
      });
      await expect(service.create(createDto(), admin)).rejects.toThrow(
        new BadRequestException('User is not a teacher'),
      );
    });

    it('rejects an inactive teacher', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 't1',
        role: Role.teacher,
        isActive: false,
      });
      await expect(service.create(createDto(), admin)).rejects.toThrow(
        new BadRequestException('Teacher is inactive'),
      );
      expect(mockPrisma.salaryTerms.create).not.toHaveBeenCalled();
    });

    it('closes the open version the day before the new one', async () => {
      mockPrisma.salaryTerms.findMany.mockResolvedValue([
        { id: 'old', validFrom: day('2026-09-01'), validTo: null },
      ]);

      const result = await service.create(
        createDto({
          allowances: [{ name: ' Класне керівництво ', amount: '1000' }],
        }),
        admin,
      );

      expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.salaryTerms.findMany.mock.invocationCallOrder[0],
      );
      expect(mockPrisma.salaryTerms.update).toHaveBeenCalledWith({
        where: { id: 'old' },
        data: { validTo: day('2026-10-31') },
      });
      expect(mockPrisma.salaryTerms.create).toHaveBeenCalledWith({
        data: {
          teacherId: 't1',
          validFrom: day('2026-11-01'),
          monthlyRate: dec('20000'),
          extraHourRate: null,
          calendarKind: PayrollCalendar.all,
          note: null,
          createdById: 'a1',
          rates: { create: [] },
          allowances: {
            create: [{ name: 'Класне керівництво', amount: dec('1000') }],
          },
        },
        include: termsInclude,
      });
      expect(result.monthlyRate).toBe('20000.00');
      expect(result.started).toBe(false);
    });

    it('stores the extra hour rate and returns it', async () => {
      mockPrisma.salaryTerms.create.mockResolvedValue(
        row({ extraHourRate: dec('150') }),
      );
      mockPrisma.salaryTerms.findUnique.mockResolvedValue(
        row({ extraHourRate: dec('150') }),
      );
      const result = await service.create(
        createDto({ extraHourRate: '150' }),
        admin,
      );
      expect(mockPrisma.salaryTerms.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            extraHourRate: dec('150'),
          }) as unknown,
        }),
      );
      expect(result.extraHourRate).toBe('150.00');
    });

    it('returns null extra hour rate when unset', async () => {
      const result = await service.create(createDto(), admin);
      expect(result.extraHourRate).toBeNull();
    });

    it('rejects a zero extra hour rate', async () => {
      await expect(
        service.create(createDto({ extraHourRate: '0' }), admin),
      ).rejects.toThrow('Amount must be greater than 0');
    });

    it('rejects a version that overlaps a later open version', async () => {
      mockPrisma.salaryTerms.findMany.mockResolvedValue([
        { id: 'x', validFrom: day('2026-12-01'), validTo: null },
      ]);
      await expect(service.create(createDto(), admin)).rejects.toThrow(
        new BadRequestException('Salary terms overlap'),
      );
      expect(mockPrisma.salaryTerms.create).not.toHaveBeenCalled();
    });

    it('rejects a version that overlaps a closed version', async () => {
      mockPrisma.salaryTerms.findMany.mockResolvedValue([
        { id: 'x', validFrom: day('2026-09-01'), validTo: day('2026-11-15') },
      ]);
      await expect(service.create(createDto(), admin)).rejects.toThrow(
        'Salary terms overlap',
      );
    });

    it('rejects a subject rate on a class lesson type', async () => {
      await expect(
        service.create(
          createDto({
            rates: [
              {
                lessonType: PayrollLessonType.class_group,
                subjectId: 's1',
                amount: '300',
              },
            ],
          }),
          admin,
        ),
      ).rejects.toThrow('Subject rate must be a school lesson');
    });

    it('rejects a class group rate on a school lesson type', async () => {
      await expect(
        service.create(
          createDto({
            rates: [
              {
                lessonType: PayrollLessonType.school_lesson,
                classGroupId: 'cg1',
                amount: '300',
              },
            ],
          }),
          admin,
        ),
      ).rejects.toThrow('Rate does not match class group format');
    });

    it('rejects duplicate rates', async () => {
      await expect(
        service.create(
          createDto({
            rates: [
              { lessonType: PayrollLessonType.school_lesson, amount: '300' },
              { lessonType: PayrollLessonType.school_lesson, amount: '350' },
            ],
          }),
          admin,
        ),
      ).rejects.toThrow('Duplicate salary rate');
    });

    it('rejects a rate whose class group format differs', async () => {
      mockPrisma.classGroup.findMany.mockResolvedValue([
        { id: 'cg1', format: ClassFormat.group },
      ]);
      await expect(
        service.create(
          createDto({
            rates: [
              {
                lessonType: PayrollLessonType.individual,
                classGroupId: 'cg1',
                amount: '500',
              },
            ],
          }),
          admin,
        ),
      ).rejects.toThrow('Rate does not match class group format');
    });

    it('rejects a missing subject or class group', async () => {
      await expect(
        service.create(
          createDto({
            rates: [
              {
                lessonType: PayrollLessonType.school_lesson,
                subjectId: 's1',
                amount: '300',
              },
            ],
          }),
          admin,
        ),
      ).rejects.toThrow(new NotFoundException('Subject not found'));
      await expect(
        service.create(
          createDto({
            rates: [
              {
                lessonType: PayrollLessonType.class_group,
                classGroupId: 'cg1',
                amount: '300',
              },
            ],
          }),
          admin,
        ),
      ).rejects.toThrow(new NotFoundException('Class group not found'));
    });

    it('stores a valid specific rate', async () => {
      mockPrisma.subject.findMany.mockResolvedValue([{ id: 's1' }]);
      await service.create(
        createDto({
          rates: [
            {
              lessonType: PayrollLessonType.school_lesson,
              subjectId: 's1',
              amount: '350.50',
            },
          ],
        }),
        admin,
      );
      const call = mockPrisma.salaryTerms.create.mock.calls[0] as [
        { data: { rates: { create: unknown[] } } },
      ];
      expect(call[0].data.rates.create).toEqual([
        {
          lessonType: PayrollLessonType.school_lesson,
          subjectId: 's1',
          classGroupId: null,
          amount: dec('350.50'),
        },
      ]);
    });

    it('rejects a zero allowance', async () => {
      await expect(
        service.create(
          createDto({ allowances: [{ name: 'Доплата', amount: '0' }] }),
          admin,
        ),
      ).rejects.toThrow('Amount must be greater than 0');
    });
  });

  describe('update', () => {
    it('rejects started terms', async () => {
      mockPrisma.salaryTerms.findUnique.mockResolvedValue(
        row({ validFrom: day('2020-01-01') }),
      );
      await expect(
        service.update('st1', { monthlyRate: '1' }, 'a1'),
      ).rejects.toThrow('Started salary terms cannot be changed');
    });

    it('rejects a new extra hour rate on started terms', async () => {
      mockPrisma.salaryTerms.findUnique.mockResolvedValue(
        row({ validFrom: day('2020-01-01') }),
      );
      await expect(
        service.update('st1', { extraHourRate: '150' }, 'a1'),
      ).rejects.toThrow('Started salary terms cannot be changed');
    });

    it('sets and clears the extra hour rate on not started terms', async () => {
      await service.update('st1', { extraHourRate: '150' }, 'a1');
      expect(mockPrisma.salaryTerms.update).toHaveBeenLastCalledWith({
        where: { id: 'st1' },
        data: expect.objectContaining({ extraHourRate: dec('150') }) as unknown,
      });
      await service.update('st1', { extraHourRate: null }, 'a1');
      expect(mockPrisma.salaryTerms.update).toHaveBeenLastCalledWith({
        where: { id: 'st1' },
        data: expect.objectContaining({ extraHourRate: null }) as unknown,
      });
    });

    it('replaces rates of not started terms and keeps allowances', async () => {
      await service.update(
        'st1',
        {
          monthlyRate: '25000',
          rates: [
            { lessonType: PayrollLessonType.school_lesson, amount: '300' },
          ],
        },
        'a1',
      );

      expect(mockPrisma.salaryRate.deleteMany).toHaveBeenCalledWith({
        where: { termsId: 'st1' },
      });
      expect(mockPrisma.salaryRate.createMany).toHaveBeenCalledWith({
        data: [
          {
            termsId: 'st1',
            lessonType: PayrollLessonType.school_lesson,
            subjectId: null,
            classGroupId: null,
            amount: dec('300'),
          },
        ],
      });
      expect(mockPrisma.salaryAllowance.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.salaryTerms.update).toHaveBeenCalledWith({
        where: { id: 'st1' },
        data: {
          monthlyRate: dec('25000'),
          extraHourRate: undefined,
          calendarKind: undefined,
          note: undefined,
        },
      });
    });

    it('throws when terms are missing', async () => {
      mockPrisma.salaryTerms.findUnique.mockResolvedValue(null);
      await expect(service.update('st1', {}, 'a1')).rejects.toThrow(
        new NotFoundException('Salary terms not found'),
      );
    });
  });

  describe('remove', () => {
    it('reopens the previous version and deletes not started terms', async () => {
      const result = await service.remove('st1', 'a1');

      expect(mockPrisma.salaryTerms.updateMany).toHaveBeenCalledWith({
        where: { teacherId: 't1', validTo: day('2098-12-31') },
        data: { validTo: null },
      });
      expect(mockPrisma.salaryTerms.delete).toHaveBeenCalledWith({
        where: { id: 'st1' },
      });
      expect(result).toEqual({ message: 'Salary terms deleted' });
    });

    it('rejects started terms', async () => {
      mockPrisma.salaryTerms.findUnique.mockResolvedValue(
        row({ validFrom: day('2020-01-01') }),
      );
      await expect(service.remove('st1', 'a1')).rejects.toThrow(
        'Started salary terms cannot be changed',
      );
      expect(mockPrisma.salaryTerms.delete).not.toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('rejects closed terms', async () => {
      mockPrisma.salaryTerms.findUnique.mockResolvedValue(
        row({ validTo: day('2099-02-01') }),
      );
      await expect(
        service.close('st1', { validTo: '2099-03-01' }, 'a1'),
      ).rejects.toThrow('Salary terms are closed');
    });

    it('rejects an end before the start', async () => {
      await expect(
        service.close('st1', { validTo: '2098-12-31' }, 'a1'),
      ).rejects.toThrow('Invalid date range');
    });

    it('sets the end date of the open version', async () => {
      mockPrisma.salaryTerms.updateMany.mockResolvedValue({ count: 1 });
      await service.close('st1', { validTo: '2099-03-01' }, 'a1');
      expect(mockPrisma.salaryTerms.updateMany).toHaveBeenCalledWith({
        where: { id: 'st1', validTo: null },
        data: { validTo: day('2099-03-01') },
      });
    });

    it('rejects when a concurrent close won', async () => {
      mockPrisma.salaryTerms.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.close('st1', { validTo: '2099-03-01' }, 'a1'),
      ).rejects.toThrow('Salary terms are closed');
    });
  });

  describe('views', () => {
    it('lists versions of a teacher with names and money strings', async () => {
      mockPrisma.salaryTerms.findMany.mockResolvedValue([
        row({
          validFrom: day('2020-01-01'),
          rates: [
            {
              id: 'r1',
              lessonType: PayrollLessonType.school_lesson,
              subjectId: 's1',
              subject: { name: 'Математика' },
              classGroupId: null,
              classGroup: null,
              amount: dec('350'),
            },
          ],
          allowances: [{ id: 'al1', name: 'Доплата', amount: dec('1000') }],
        }),
      ]);

      const [view] = await service.list('t1');

      expect(view.payrollDetailsVisible).toBe(false);

      expect(view).toMatchObject({
        validFrom: '2020-01-01',
        validTo: null,
        started: true,
        rates: [
          {
            id: 'r1',
            subjectName: 'Математика',
            classGroupName: null,
            amount: '350.00',
          },
        ],
        allowances: [{ id: 'al1', name: 'Доплата', amount: '1000.00' }],
      });
    });

    it('rejects a list for a non-teacher', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'p1',
        role: Role.parent,
      });
      await expect(service.list('p1')).rejects.toThrow('Teacher not found');
    });
  });

  describe('audit', () => {
    const withLines = (over: Record<string, unknown> = {}) =>
      row({
        rates: [
          {
            id: 'r1',
            lessonType: PayrollLessonType.school_lesson,
            subjectId: 's1',
            classGroupId: null,
            amount: dec('350'),
          },
        ],
        allowances: [{ id: 'al1', name: 'Доплата', amount: dec('1000') }],
        ...over,
      });

    it('records created terms with rates and allowances', async () => {
      mockPrisma.salaryTerms.create.mockResolvedValue(withLines());

      await service.create(createDto(), admin);

      expect(mockAudit.recordChange).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          actorId: 'a1',
          entityType: 'salary-terms',
          entityId: 'st1',
          action: AuditAction.create,
          before: null,
          after: expect.objectContaining({
            teacherId: 't1',
            monthlyRate: dec('20000'),
            rates: ['school_lesson:s1=350.00'],
            allowances: ['Доплата=1000.00'],
          }) as unknown,
        }),
      );
    });

    it('records the monthly rate change on update', async () => {
      mockPrisma.salaryTerms.findUnique
        .mockResolvedValueOnce(row())
        .mockResolvedValueOnce(row())
        .mockResolvedValueOnce(row({ monthlyRate: dec('25000') }))
        .mockResolvedValue(row({ monthlyRate: dec('25000') }));

      await service.update('st1', { monthlyRate: '25000' }, 'a1');

      expect(mockAudit.recordChange).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          actorId: 'a1',
          entityType: 'salary-terms',
          entityId: 'st1',
          action: AuditAction.update,
          before: expect.objectContaining({
            monthlyRate: dec('20000'),
          }) as unknown,
          after: expect.objectContaining({
            monthlyRate: dec('25000'),
          }) as unknown,
        }),
      );
    });

    it('records deleted terms', async () => {
      await service.remove('st1', 'a1');

      expect(mockAudit.recordChange).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          actorId: 'a1',
          entityType: 'salary-terms',
          entityId: 'st1',
          action: AuditAction.delete,
          after: null,
        }),
      );
    });

    it('records the end date on close', async () => {
      mockPrisma.salaryTerms.updateMany.mockResolvedValue({ count: 1 });

      await service.close('st1', { validTo: '2099-03-01' }, 'a1');

      expect(mockAudit.recordChange).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          actorId: 'a1',
          entityType: 'salary-terms',
          entityId: 'st1',
          action: AuditAction.update,
          before: expect.objectContaining({ validTo: null }) as unknown,
          after: expect.objectContaining({
            validTo: day('2099-03-01'),
          }) as unknown,
        }),
      );
    });
  });

  describe('audit of neighbour versions', () => {
    it('records the auto-closed previous version on create', async () => {
      mockPrisma.salaryTerms.findMany.mockResolvedValue([
        { id: 'old', validFrom: day('2026-09-01'), validTo: null },
      ]);

      await service.create(createDto(), admin);

      expect(mockAudit.recordChange).toHaveBeenCalledWith(mockPrisma, {
        actorId: 'a1',
        entityType: 'salary-terms',
        entityId: 'old',
        action: AuditAction.update,
        before: { validTo: null },
        after: { validTo: day('2026-10-31') },
        fields: ['validTo'],
      });
    });

    it('records the reopened previous version on remove', async () => {
      mockPrisma.salaryTerms.findFirst.mockResolvedValue({
        id: 'prev',
        validTo: day('2098-12-31'),
      });

      await service.remove('st1', 'a1');

      expect(mockAudit.recordChange).toHaveBeenCalledWith(mockPrisma, {
        actorId: 'a1',
        entityType: 'salary-terms',
        entityId: 'prev',
        action: AuditAction.update,
        before: { validTo: day('2098-12-31') },
        after: { validTo: null },
        fields: ['validTo'],
      });
    });
  });
});
