import { Test } from '@nestjs/testing';
import {
  AttendanceStatus,
  ChargeSource,
  FinanceCategory,
  MissedLessonRule,
  Prisma,
  Role,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LessonsService } from './lessons.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const d = (value: string) => new Prisma.Decimal(value);
const TODAY = day('2026-10-11');

const admin = {
  id: 'u1',
  role: Role.admin,
  login: 'admin',
  mustChangePassword: false,
};
const teacher = {
  id: 't1',
  role: Role.teacher,
  login: 'teacher',
  mustChangePassword: false,
};

const mockPrisma = {
  classGroup: { findUnique: jest.fn() },
  lesson: { upsert: jest.fn(), findUnique: jest.fn() },
  lessonAttendance: {
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  classGroupMember: { findMany: jest.fn() },
  child: { findMany: jest.fn() },
  package: { findMany: jest.fn() },
  sessionUsage: { create: jest.fn(), update: jest.fn() },
  charge: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  allocation: { updateMany: jest.fn() },
  $queryRaw: jest.fn(),
  $executeRaw: jest.fn(),
  $transaction: jest.fn(),
};

const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];

const group = (over: Record<string, unknown> = {}) => ({
  id: 'g1',
  name: 'LEGO 1',
  directionId: 'd1',
  direction: {
    id: 'd1',
    name: 'LEGO',
    missedRule: MissedLessonRule.unexcused_only,
  },
  teachers: [{ id: 't1' }],
  singleTariff: {
    id: 'ts',
    name: 'LEGO разове',
    category: FinanceCategory.extra_classes,
    prices: [{ price: d('300'), effectiveFrom: day('2026-01-01') }],
  },
  ...over,
});

const packageRow = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  sessionsTotal: 4,
  usedBefore: 0,
  purchaseDate: day('2026-10-01'),
  expiresAt: null,
  createdAt: new Date('2026-10-01T10:00:00Z'),
  voidedAt: null,
  needsReconciliation: false,
  extensions: [],
  usages: [],
  ...over,
});

const mark = (status: AttendanceStatus, childId = 'c1') => ({
  marks: [{ childId, status }],
});

describe('LessonsService.mark', () => {
  let service: LessonsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(mockPrisma),
    );
    mockPrisma.classGroup.findUnique.mockResolvedValue(group());
    mockPrisma.child.findMany.mockImplementation(
      ({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(where.id.in.map((id) => ({ id }))),
    );
    mockPrisma.$executeRaw.mockResolvedValue(1);
    mockPrisma.$queryRaw.mockResolvedValue([{ id: 'l1' }]);
    mockPrisma.lessonAttendance.findMany.mockResolvedValue([]);
    mockPrisma.lessonAttendance.create.mockResolvedValue({ id: 'a-new' });
    mockPrisma.classGroupMember.findMany.mockResolvedValue([{ childId: 'c1' }]);
    mockPrisma.package.findMany.mockResolvedValue([packageRow()]);
    mockPrisma.charge.create.mockResolvedValue({ id: 'ch-new' });
    const module = await Test.createTestingModule({
      providers: [
        LessonsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();
    service = module.get(LessonsService);
  });

  it('forbids a teacher of another group', async () => {
    await expect(
      service.mark(
        'g1',
        '2026-10-11',
        mark(AttendanceStatus.present),
        { ...teacher, id: 't2' },
        TODAY,
      ),
    ).rejects.toThrow('Not your class group');
  });

  it('rejects a future date and an invalid date', async () => {
    await expect(
      service.mark(
        'g1',
        '2026-10-12',
        mark(AttendanceStatus.present),
        admin,
        TODAY,
      ),
    ).rejects.toThrow('Lesson date must not be in the future');
    await expect(
      service.mark(
        'g1',
        '2026-13-01',
        mark(AttendanceStatus.present),
        admin,
        TODAY,
      ),
    ).rejects.toThrow('Invalid date');
  });

  it('rejects duplicate children', async () => {
    const dto = {
      marks: [
        { childId: 'c1', status: AttendanceStatus.present },
        { childId: 'c1', status: AttendanceStatus.present },
      ],
    };

    await expect(
      service.mark('g1', '2026-10-11', dto, admin, TODAY),
    ).rejects.toThrow('Duplicate child in marks');
  });

  it('rejects an unknown child', async () => {
    mockPrisma.child.findMany.mockResolvedValue([]);

    await expect(
      service.mark(
        'g1',
        '2026-10-11',
        { marks: [{ childId: 'ghost', status: AttendanceStatus.present }] },
        admin,
        TODAY,
      ),
    ).rejects.toThrow('Child not found');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a non-member who is not marked as guest', async () => {
    await expect(
      service.mark(
        'g1',
        '2026-10-11',
        mark(AttendanceStatus.present, 'c9'),
        admin,
        TODAY,
      ),
    ).rejects.toThrow('Child is not a member of this group on this date');
  });

  it('consumes a package session for a present member after locking', async () => {
    await service.mark(
      'g1',
      '2026-10-11',
      mark(AttendanceStatus.present),
      teacher,
      TODAY,
    );

    expect(
      firstArg<{ data: Record<string, unknown> }>(
        mockPrisma.lessonAttendance.create,
      ).data,
    ).toMatchObject({
      lessonId: 'l1',
      childId: 'c1',
      status: AttendanceStatus.present,
      isGuest: false,
      markedById: 't1',
    });
    expect(mockPrisma.sessionUsage.create).toHaveBeenCalledWith({
      data: { attendanceId: 'a-new', packageId: 'p1' },
    });
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mockPrisma.lessonAttendance.findMany.mock.invocationCallOrder[0],
    );
    expect(mockPrisma.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      mockPrisma.package.findMany.mock.invocationCallOrder[0],
    );
  });

  it('charges a single lesson when no package is usable', async () => {
    mockPrisma.package.findMany.mockResolvedValue([]);

    await service.mark(
      'g1',
      '2026-10-11',
      mark(AttendanceStatus.present),
      admin,
      TODAY,
    );

    const charge = firstArg<{
      data: Record<string, unknown> & { amount: Prisma.Decimal };
    }>(mockPrisma.charge.create);
    expect(charge.data).toMatchObject({
      childId: 'c1',
      category: FinanceCategory.extra_classes,
      description: 'LEGO 1, 11.10.2026: разове заняття',
      periodStart: TODAY,
      periodEnd: TODAY,
      sourceType: ChargeSource.extra_session,
      sourceId: 'a-new',
      createdById: 'u1',
    });
    expect(charge.data.amount.toFixed(2)).toBe('300.00');
    expect(mockPrisma.sessionUsage.create).toHaveBeenCalledWith({
      data: { attendanceId: 'a-new', chargeId: 'ch-new' },
    });
  });

  it('does not consume an excused absence under unexcused_only', async () => {
    await service.mark(
      'g1',
      '2026-10-11',
      mark(AttendanceStatus.absent_excused),
      admin,
      TODAY,
    );

    expect(mockPrisma.lessonAttendance.create).toHaveBeenCalled();
    expect(mockPrisma.sessionUsage.create).not.toHaveBeenCalled();
  });

  it('fails without a single-lesson price', async () => {
    mockPrisma.package.findMany.mockResolvedValue([]);
    mockPrisma.classGroup.findUnique.mockResolvedValue(
      group({ singleTariff: null }),
    );

    await expect(
      service.mark(
        'g1',
        '2026-10-11',
        mark(AttendanceStatus.present),
        admin,
        TODAY,
      ),
    ).rejects.toThrow('No price for this date');
  });

  describe('corrections', () => {
    const existing = (over: Record<string, unknown> = {}) => ({
      id: 'a-old',
      childId: 'c1',
      status: AttendanceStatus.present,
      isGuest: false,
      usage: { id: 'u-old', packageId: 'p1', chargeId: null, voidedAt: null },
      ...over,
    });

    it('skips an unchanged status', async () => {
      mockPrisma.lessonAttendance.findMany.mockResolvedValue([existing()]);

      await service.mark(
        'g1',
        '2026-10-11',
        mark(AttendanceStatus.present),
        admin,
        TODAY,
      );

      expect(mockPrisma.lessonAttendance.create).not.toHaveBeenCalled();
    });

    it('returns the session to the package when corrected to excused', async () => {
      mockPrisma.lessonAttendance.findMany.mockResolvedValue([existing()]);

      await service.mark(
        'g1',
        '2026-10-11',
        mark(AttendanceStatus.absent_excused),
        teacher,
        TODAY,
      );

      const voided = {
        voidedAt: expect.any(Date) as Date,
        voidedById: 't1',
        voidReason: 'Виправлення відмітки',
      };
      expect(mockPrisma.sessionUsage.update).toHaveBeenCalledWith({
        where: { id: 'u-old' },
        data: voided,
      });
      expect(mockPrisma.lessonAttendance.update).toHaveBeenCalledWith({
        where: { id: 'a-old' },
        data: voided,
      });
      expect(mockPrisma.sessionUsage.create).not.toHaveBeenCalled();
    });

    it('voids a single-lesson charge on correction', async () => {
      mockPrisma.lessonAttendance.findMany.mockResolvedValue([
        existing({
          usage: {
            id: 'u-old',
            packageId: null,
            chargeId: 'ch-old',
            voidedAt: null,
          },
        }),
      ]);
      mockPrisma.charge.findUnique.mockResolvedValue({
        id: 'ch-old',
        voidedAt: null,
      });

      await service.mark(
        'g1',
        '2026-10-11',
        mark(AttendanceStatus.absent_excused),
        admin,
        TODAY,
      );

      expect(mockPrisma.charge.update).toHaveBeenCalledWith({
        where: { id: 'ch-old' },
        data: {
          voidedAt: expect.any(Date) as Date,
          voidedById: 'u1',
          voidReason: 'Виправлення відмітки',
        },
      });
    });

    it('forbids a teacher from correcting a past lesson', async () => {
      mockPrisma.lessonAttendance.findMany.mockResolvedValue([existing()]);

      await expect(
        service.mark(
          'g1',
          '2026-10-10',
          mark(AttendanceStatus.absent_excused),
          teacher,
          TODAY,
        ),
      ).rejects.toThrow('Only the lesson day can be corrected by a teacher');
    });

    it('requires a reason for a late admin correction', async () => {
      mockPrisma.lessonAttendance.findMany.mockResolvedValue([existing()]);

      await expect(
        service.mark(
          'g1',
          '2026-10-10',
          mark(AttendanceStatus.absent_excused),
          admin,
          TODAY,
        ),
      ).rejects.toThrow('Reason is required for a late correction');
      await expect(
        service.mark(
          'g1',
          '2026-10-10',
          { ...mark(AttendanceStatus.absent_excused), reason: 'mistake' },
          admin,
          TODAY,
        ),
      ).resolves.toEqual({ lessonId: 'l1' });
    });
  });
});

describe('LessonsService.getRoster', () => {
  let service: LessonsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        LessonsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();
    service = module.get(LessonsService);
  });

  it('lists members and guests with package info', async () => {
    mockPrisma.classGroup.findUnique.mockResolvedValue({
      id: 'g1',
      name: 'LEGO 1',
      directionId: 'd1',
      direction: {
        id: 'd1',
        name: 'LEGO',
        missedRule: MissedLessonRule.no_charge,
      },
      teachers: [{ id: 't1' }],
    });
    mockPrisma.lesson.findUnique.mockResolvedValue({
      id: 'l1',
      conductedBy: { id: 't1', firstName: 'Olha', lastName: 'Teacher' },
      attendances: [
        {
          id: 'a2',
          childId: 'c2',
          status: AttendanceStatus.present,
          isGuest: true,
          child: { id: 'c2', firstName: 'Bob', lastName: 'Bee' },
        },
      ],
    });
    mockPrisma.classGroupMember.findMany.mockResolvedValue([
      { childId: 'c1', child: { id: 'c1', firstName: 'Ann', lastName: 'Ant' } },
    ]);
    mockPrisma.package.findMany.mockResolvedValue([
      { ...packageRow(), childId: 'c1', usages: [{ voidedAt: null }] },
    ]);

    const roster = await service.getRoster('g1', '2026-10-11', admin);

    expect(roster.lessonId).toBe('l1');
    expect(roster.rows).toEqual([
      {
        child: { id: 'c1', firstName: 'Ann', lastName: 'Ant' },
        isMember: true,
        attendance: null,
        packageInfo: {
          packageId: 'p1',
          remaining: 3,
          total: 4,
          expiresAt: null,
        },
      },
      {
        child: { id: 'c2', firstName: 'Bob', lastName: 'Bee' },
        isMember: false,
        attendance: {
          id: 'a2',
          status: AttendanceStatus.present,
          isGuest: true,
        },
        packageInfo: null,
      },
    ]);
  });
});
