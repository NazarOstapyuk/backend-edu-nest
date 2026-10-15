import { ForbiddenException } from '@nestjs/common';
import {
  AccessScope,
  AttendanceStatus,
  GroupKind,
  NoticeStatus,
  PayrollStatus,
  PermissionLevel,
  Prisma,
  Role,
} from '@prisma/client';
import { ActivityReportsService } from './activity-reports.service';

const user = (
  permissions: Partial<Record<'timetable' | 'classes', PermissionLevel>> = {},
  accessScope: AccessScope = AccessScope.all,
) => ({
  id: 'u1',
  role: Role.admin,
  login: 'a',
  mustChangePassword: false,
  accessScope,
  permissions,
});

const bothAreas = {
  timetable: PermissionLevel.view,
  classes: PermissionLevel.view,
};

const groupId = '8a1c6a52-7a0e-4f0e-9a43-1d6a9d1c2b11';

const firstArg = (mock: jest.Mock): unknown =>
  (mock.mock.calls[0] as [unknown])[0];

const payrollRow = (
  id: string,
  firstName: string,
  lastName: string,
  accrued: string,
  status: PayrollStatus = PayrollStatus.draft,
) => ({
  teacher: { id, firstName, lastName },
  status,
  accrued,
  paid: '0.00',
  balance: accrued,
});

describe('ActivityReportsService', () => {
  let service: ActivityReportsService;
  const prisma = {
    group: { findUnique: jest.fn() },
    child: { findMany: jest.fn() },
    absenceReason: { findMany: jest.fn() },
    mealOrder: { findMany: jest.fn() },
    schoolLesson: { findMany: jest.fn() },
    lesson: { findMany: jest.fn() },
    payrollPayment: { findMany: jest.fn() },
  };
  const calendar = { entriesBetween: jest.fn() };
  const payroll = { list: jest.fn() };
  const range = { from: '2026-10-01', to: '2026-10-31' };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.child.findMany.mockResolvedValue([]);
    prisma.absenceReason.findMany.mockResolvedValue([]);
    prisma.mealOrder.findMany.mockResolvedValue([]);
    prisma.schoolLesson.findMany.mockResolvedValue([]);
    prisma.lesson.findMany.mockResolvedValue([]);
    prisma.payrollPayment.findMany.mockResolvedValue([]);
    calendar.entriesBetween.mockResolvedValue([]);
    payroll.list.mockResolvedValue({ rows: [] });
    service = new ActivityReportsService(
      prisma as never,
      calendar as never,
      payroll as never,
    );
  });

  describe('attendance', () => {
    it('passes approved notices and excused reasons into the report', async () => {
      prisma.absenceReason.findMany.mockResolvedValue([{ id: 'r1' }]);
      prisma.child.findMany.mockResolvedValue([
        {
          firstName: 'Іра',
          lastName: 'Коваль',
          group: { id: 'g1', kind: GroupKind.kindergarten, name: 'Сонечко' },
          dailyAttendances: [],
          absenceNotices: [
            {
              startDate: new Date('2026-10-02T00:00:00.000Z'),
              endDate: new Date('2026-10-02T00:00:00.000Z'),
              reasonId: 'r1',
              status: NoticeStatus.approved,
            },
          ],
        },
      ]);
      const report = await service.attendance(range, user());
      expect(prisma.absenceReason.findMany).toHaveBeenCalledWith({
        where: { excused: true },
        select: { id: true },
      });
      expect(firstArg(prisma.child.findMany)).toMatchObject({
        where: { groupId: { not: null } },
        select: {
          absenceNotices: {
            where: {
              status: NoticeStatus.approved,
              startDate: { lte: new Date('2026-10-31T00:00:00.000Z') },
              endDate: { gte: new Date('2026-10-01T00:00:00.000Z') },
            },
          },
        },
      });
      expect(report.rows[0]).toMatchObject({
        child: 'Коваль Іра',
        group: 'Сонечко',
        excused: 1,
        unexcused: 0,
      });
    });
  });

  describe('meals', () => {
    it('excludes cancelled orders and maps rows', async () => {
      prisma.mealOrder.findMany.mockResolvedValue([
        {
          date: new Date('2026-10-02T00:00:00.000Z'),
          price: new Prisma.Decimal('45.50'),
          complex: { name: 'Повний' },
          child: { group: { name: 'Сонечко' } },
        },
      ]);
      const report = await service.meals(range, user());
      expect(firstArg(prisma.mealOrder.findMany)).toMatchObject({
        where: { cancelledAt: null },
      });
      expect(report.rows).toEqual([
        {
          date: '2026-10-02',
          group: 'Сонечко',
          complex: 'Повний',
          count: 1,
          amount: '45.50',
        },
      ]);
    });
  });

  describe('lessons', () => {
    it('skips school lessons without the timetable permission', async () => {
      await service.lessons(range, user({ classes: PermissionLevel.view }));
      expect(prisma.schoolLesson.findMany).not.toHaveBeenCalled();
      expect(prisma.lesson.findMany).toHaveBeenCalledTimes(1);
    });

    it('skips class lessons without the classes permission', async () => {
      await service.lessons(range, user({ timetable: PermissionLevel.view }));
      expect(prisma.lesson.findMany).not.toHaveBeenCalled();
      expect(prisma.schoolLesson.findMany).toHaveBeenCalledTimes(1);
    });

    it('counts only class lessons with a present attendance', async () => {
      await service.lessons(range, user({ classes: PermissionLevel.view }));
      expect(prisma.lesson.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            date: {
              gte: new Date('2026-10-01T00:00:00.000Z'),
              lte: new Date('2026-10-31T00:00:00.000Z'),
            },
            attendances: {
              some: { voidedAt: null, status: AttendanceStatus.present },
            },
          },
        }),
      );
    });

    it('filters by teacher', async () => {
      await service.lessons({ ...range, teacherId: 't1' }, user(bothAreas));
      expect(firstArg(prisma.schoolLesson.findMany)).toMatchObject({
        where: { teacherId: 't1' },
      });
      expect(firstArg(prisma.lesson.findMany)).toMatchObject({
        where: { conductedById: 't1' },
      });
    });

    it('omits class lessons when a group is chosen', async () => {
      prisma.group.findUnique.mockResolvedValue({
        id: groupId,
        kind: GroupKind.school_class,
      });
      await service.lessons({ ...range, groupId }, user(bothAreas));
      expect(prisma.lesson.findMany).not.toHaveBeenCalled();
      expect(firstArg(prisma.schoolLesson.findMany)).toMatchObject({
        where: { group: { id: groupId } },
      });
    });

    it('maps both kinds into the report', async () => {
      prisma.schoolLesson.findMany.mockResolvedValue([
        {
          date: new Date('2026-10-01T00:00:00.000Z'),
          period: 2,
          topic: null,
          teacher: { firstName: 'Анна', lastName: 'Іваненко' },
          subject: { name: 'Математика' },
          group: { name: '1-А' },
        },
      ]);
      prisma.lesson.findMany.mockResolvedValue([
        {
          date: new Date('2026-10-01T00:00:00.000Z'),
          conductedBy: { firstName: 'Олег', lastName: 'Бондар' },
          classGroup: { name: 'Група 1', direction: { name: 'Англійська' } },
        },
      ]);
      const report = await service.lessons(range, user(bothAreas));
      expect(report.rows.map((r) => r.type).sort()).toEqual([
        'Заняття',
        'Урок',
      ]);
    });
  });

  describe('payroll', () => {
    it('calls list once per touched month and sums payments by key', async () => {
      payroll.list.mockResolvedValue({
        rows: [
          payrollRow('t1', 'Анна', 'Іваненко', '100.00'),
          payrollRow('t2', 'Олег', 'Бондар', '10.00', PayrollStatus.approved),
        ],
      });
      const october = new Date('2026-10-01T00:00:00.000Z');
      prisma.payrollPayment.findMany.mockResolvedValue([
        {
          amount: new Prisma.Decimal('40.00'),
          sheet: { teacherId: 't1', month: october },
        },
        {
          amount: new Prisma.Decimal('15.50'),
          sheet: { teacherId: 't1', month: october },
        },
      ]);
      const report = await service.payroll(
        { from: '2026-09-20', to: '2026-10-05' },
        user(),
      );
      expect(payroll.list).toHaveBeenCalledTimes(2);
      expect(payroll.list).toHaveBeenNthCalledWith(1, '2026-09');
      expect(payroll.list).toHaveBeenNthCalledWith(2, '2026-10');
      expect(
        report.rows.find(
          (r) => r.month === '10.2026' && r.teacher === 'Іваненко Анна',
        ),
      ).toMatchObject({ paid: '55.50' });
      expect(
        report.rows.find(
          (r) => r.month === '09.2026' && r.teacher === 'Іваненко Анна',
        ),
      ).toMatchObject({ paid: '0.00' });
      expect(prisma.payrollPayment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            voidedAt: null,
            date: {
              gte: new Date('2026-09-20T00:00:00.000Z'),
              lte: new Date('2026-10-05T00:00:00.000Z'),
            },
            sheet: {
              month: {
                in: [new Date('2026-09-01T00:00:00.000Z'), october],
              },
            },
          },
        }),
      );
    });

    it('filters by teacher', async () => {
      payroll.list.mockResolvedValue({
        rows: [
          payrollRow('t1', 'Анна', 'Іваненко', '1.00'),
          payrollRow('t2', 'Олег', 'Бондар', '2.00'),
        ],
      });
      const report = await service.payroll(
        { ...range, teacherId: 't2' },
        user(),
      );
      expect(report.rows).toHaveLength(1);
      expect(report.rows[0]).toMatchObject({ teacher: 'Бондар Олег' });
      expect(firstArg(prisma.payrollPayment.findMany)).toMatchObject({
        where: { sheet: { teacherId: 't2' } },
      });
    });

    it('still validates the group filter', async () => {
      prisma.group.findUnique.mockResolvedValue({
        id: groupId,
        kind: GroupKind.school_class,
      });
      await expect(
        service.payroll(
          { ...range, groupId },
          user({}, AccessScope.kindergarten),
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
