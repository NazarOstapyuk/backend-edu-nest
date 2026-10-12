import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DailyStatus, GroupKind, NoticeStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarService } from './calendar.service';
import { RegisterService } from './register.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const TODAY = day('2026-10-14');

const admin = {
  id: 'a1',
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
  group: { findUnique: jest.fn(), findMany: jest.fn() },
  child: { findMany: jest.fn() },
  dailyAttendance: {
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  absenceNotice: { findMany: jest.fn() },
  absenceReason: { findMany: jest.fn(), count: jest.fn() },
  appSetting: { findUnique: jest.fn(), upsert: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};
const mockCalendar = { entriesBetween: jest.fn() };

const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];
const group = {
  id: 'g1',
  name: 'Сонечко',
  kind: GroupKind.kindergarten,
  teachers: [{ id: 't1' }],
};
const kid = (id: string) => ({
  id,
  firstName: id,
  lastName: id,
  middleName: null,
});
const mark = (over: Record<string, unknown> = {}) => ({
  id: 'm1',
  childId: 'c1',
  groupId: 'g1',
  date: day('2026-10-14'),
  status: DailyStatus.present,
  reasonId: null,
  note: null,
  documentProvided: false,
  voidedAt: null,
  createdAt: new Date('2026-10-14T08:00:00Z'),
  markedBy: { id: 't1', firstName: 'Олена', lastName: 'Коваль' },
  ...over,
});

describe('RegisterService', () => {
  let service: RegisterService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        RegisterService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: CalendarService,
          useValue: mockCalendar,
        },
      ],
    }).compile();
    service = moduleRef.get(RegisterService);
    mockPrisma.group.findUnique.mockResolvedValue(group);
    mockPrisma.child.findMany.mockResolvedValue([kid('c1'), kid('c2')]);
    mockPrisma.dailyAttendance.findMany.mockResolvedValue([]);
    mockPrisma.absenceNotice.findMany.mockResolvedValue([]);
    mockPrisma.absenceReason.findMany.mockResolvedValue([
      { id: 'sick', requiresDocument: true, excused: true, name: 'Хвороба' },
    ]);
    mockPrisma.absenceReason.count.mockResolvedValue(1);
    mockPrisma.appSetting.findUnique.mockResolvedValue(null);
    mockCalendar.entriesBetween.mockResolvedValue([]);
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(mockPrisma),
    );
    mockPrisma.$queryRaw.mockResolvedValue([]);
  });

  describe('access', () => {
    it('rejects a teacher of another group', async () => {
      mockPrisma.group.findUnique.mockResolvedValue({
        ...group,
        teachers: [{ id: 'other' }],
      });
      await expect(
        service.day('g1', '2026-10-14', teacher, TODAY),
      ).rejects.toThrow(new ForbiddenException('Not your group'));
      await expect(
        service.save('g1', { date: '2026-10-14', marks: [] }, teacher, TODAY),
      ).rejects.toThrow(new ForbiddenException('Not your group'));
    });

    it('returns 404 for an unknown group', async () => {
      mockPrisma.group.findUnique.mockResolvedValue(null);
      await expect(
        service.day('nope', '2026-10-14', admin, TODAY),
      ).rejects.toThrow(new NotFoundException('Group not found'));
    });

    it('lists only own groups for a teacher', async () => {
      mockPrisma.group.findMany.mockResolvedValue([]);
      await service.groupsFor(teacher);
      expect(
        firstArg<{ where: object }>(mockPrisma.group.findMany).where,
      ).toEqual({ teachers: { some: { id: 't1' } } });
    });
  });

  describe('day', () => {
    it('shows an approved notice as expected absence and a mark as present', async () => {
      mockPrisma.dailyAttendance.findMany.mockResolvedValue([
        mark({ childId: 'c2' }),
      ]);
      mockPrisma.absenceNotice.findMany.mockResolvedValue([
        {
          id: 'n1',
          childId: 'c1',
          startDate: day('2026-10-13'),
          endDate: day('2026-10-15'),
          reasonId: 'sick',
          comment: null,
          status: NoticeStatus.approved,
        },
        {
          id: 'n2',
          childId: 'c2',
          startDate: day('2026-10-14'),
          endDate: day('2026-10-14'),
          reasonId: 'sick',
          comment: null,
          status: NoticeStatus.approved,
        },
      ]);
      const view = await service.day('g1', '2026-10-14', teacher, TODAY);
      expect(view.working).toBe(true);
      expect(view.canEdit).toBe(true);
      expect(view.children[0]).toMatchObject({
        state: 'expected_absent',
        documentRequired: true,
        notice: { id: 'n1', startDate: '2026-10-13', endDate: '2026-10-15' },
      });
      expect(view.children[1]).toMatchObject({
        state: 'present',
        mark: { id: 'm1', status: DailyStatus.present },
      });
    });

    it('marks a weekend as not working and not editable', async () => {
      const view = await service.day(
        'g1',
        '2026-10-17',
        admin,
        day('2026-10-19'),
      );
      expect(view).toMatchObject({ working: false, canEdit: false });
    });

    it('closes editing for a teacher outside the window and asks admins for a reason', async () => {
      const forTeacher = await service.day('g1', '2026-10-09', teacher, TODAY);
      expect(forTeacher).toMatchObject({ canEdit: false, needsReason: false });
      const forAdmin = await service.day('g1', '2026-10-09', admin, TODAY);
      expect(forAdmin).toMatchObject({ canEdit: true, needsReason: true });
    });
  });

  describe('save', () => {
    const present = (childId: string) => ({
      childId,
      status: DailyStatus.present,
    });

    beforeEach(() => {
      jest
        .spyOn(service, 'day')
        .mockResolvedValue({} as Awaited<ReturnType<RegisterService['day']>>);
    });

    it('rejects future days', async () => {
      await expect(
        service.save(
          'g1',
          { date: '2026-10-15', marks: [present('c1')] },
          admin,
          TODAY,
        ),
      ).rejects.toThrow(new BadRequestException('Cannot mark future days'));
    });

    it('rejects non-working days', async () => {
      await expect(
        service.save(
          'g1',
          { date: '2026-10-11', marks: [present('c1')] },
          admin,
          TODAY,
        ),
      ).rejects.toThrow(new BadRequestException('Not a working day'));
    });

    it('enforces the edit window for teachers and the reason for admins', async () => {
      await expect(
        service.save(
          'g1',
          { date: '2026-10-09', marks: [present('c1')] },
          teacher,
          TODAY,
        ),
      ).rejects.toThrow(new ForbiddenException('Edit window has passed'));
      await expect(
        service.save(
          'g1',
          { date: '2026-10-09', marks: [present('c1')] },
          admin,
          TODAY,
        ),
      ).rejects.toThrow(new BadRequestException('Reason is required'));
      await expect(
        service.save(
          'g1',
          { date: '2026-10-12', marks: [present('c1')] },
          teacher,
          TODAY,
        ),
      ).resolves.toBeDefined();
    });

    it('uses the configured window', async () => {
      mockPrisma.appSetting.findUnique.mockResolvedValue({
        key: 'attendanceEditDays',
        value: '0',
      });
      await expect(
        service.save(
          'g1',
          { date: '2026-10-13', marks: [present('c1')] },
          teacher,
          TODAY,
        ),
      ).rejects.toThrow(new ForbiddenException('Edit window has passed'));
    });

    it('validates marks', async () => {
      await expect(
        service.save(
          'g1',
          { date: '2026-10-14', marks: [present('c1'), present('c1')] },
          admin,
          TODAY,
        ),
      ).rejects.toThrow(new BadRequestException('Duplicate child in marks'));
      await expect(
        service.save(
          'g1',
          {
            date: '2026-10-14',
            marks: [
              { childId: 'c1', status: DailyStatus.late, reasonId: 'sick' },
            ],
          },
          admin,
          TODAY,
        ),
      ).rejects.toThrow(
        new BadRequestException('Reason is only allowed for absences'),
      );
      mockPrisma.absenceReason.count.mockResolvedValue(0);
      await expect(
        service.save(
          'g1',
          {
            date: '2026-10-14',
            marks: [
              { childId: 'c1', status: DailyStatus.absent, reasonId: 'gone' },
            ],
          },
          admin,
          TODAY,
        ),
      ).rejects.toThrow(new BadRequestException('Absence reason not found'));
      await expect(
        service.save(
          'g1',
          { date: '2026-10-14', marks: [present('stranger')] },
          admin,
          TODAY,
        ),
      ).rejects.toThrow(new BadRequestException('Child is not in this group'));
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('locks children before reading marks, skips unchanged and voids changed ones', async () => {
      mockPrisma.dailyAttendance.findMany.mockResolvedValue([
        mark({ id: 'm1', childId: 'c1' }),
        mark({ id: 'm2', childId: 'c2' }),
      ]);
      await service.save(
        'g1',
        {
          date: '2026-10-14',
          marks: [
            present('c1'),
            {
              childId: 'c2',
              status: DailyStatus.absent,
              reasonId: 'sick',
              note: ' кашель ',
            },
          ],
        },
        teacher,
        TODAY,
      );
      expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.dailyAttendance.findMany.mock.invocationCallOrder[1],
      );
      expect(mockPrisma.dailyAttendance.update).toHaveBeenCalledTimes(1);
      expect(
        firstArg<{
          where: { id: string };
          data: { voidReason: string; voidedById: string };
        }>(mockPrisma.dailyAttendance.update),
      ).toMatchObject({
        where: { id: 'm2' },
        data: { voidReason: 'Corrected', voidedById: 't1' },
      });
      expect(
        firstArg<{ data: object }>(mockPrisma.dailyAttendance.create).data,
      ).toEqual({
        childId: 'c2',
        groupId: 'g1',
        date: day('2026-10-14'),
        status: DailyStatus.absent,
        reasonId: 'sick',
        note: 'кашель',
        documentProvided: false,
        markedById: 't1',
      });
    });

    it('accepts an unchanged inactive reason', async () => {
      mockPrisma.dailyAttendance.findMany.mockResolvedValue([
        mark({ childId: 'c1', status: DailyStatus.absent, reasonId: 'old' }),
      ]);
      await service.save(
        'g1',
        {
          date: '2026-10-14',
          marks: [
            { childId: 'c1', status: DailyStatus.absent, reasonId: 'old' },
          ],
        },
        teacher,
        TODAY,
      );
      expect(
        firstArg<{
          where: { id: { in: string[] }; OR: unknown[] };
        }>(mockPrisma.absenceReason.count).where,
      ).toEqual({
        id: { in: ['old'] },
        OR: [{ active: true }, { id: { in: ['old'] } }],
      });
      expect(mockPrisma.dailyAttendance.update).not.toHaveBeenCalled();
    });

    it('rejects switching to an inactive reason', async () => {
      mockPrisma.dailyAttendance.findMany.mockResolvedValue([
        mark({ childId: 'c1', status: DailyStatus.absent, reasonId: 'old' }),
      ]);
      mockPrisma.absenceReason.count.mockResolvedValue(0);
      await expect(
        service.save(
          'g1',
          {
            date: '2026-10-14',
            marks: [
              { childId: 'c1', status: DailyStatus.absent, reasonId: 'other' },
            ],
          },
          teacher,
          TODAY,
        ),
      ).rejects.toThrow(new BadRequestException('Absence reason not found'));
      expect(
        firstArg<{ where: { id: { in: string[] } } }>(
          mockPrisma.absenceReason.count,
        ).where.id.in,
      ).toEqual(['other']);
    });

    it('stores the admin reason as the void reason outside the window', async () => {
      mockPrisma.dailyAttendance.findMany.mockResolvedValue([
        mark({ id: 'm1', childId: 'c1', date: day('2026-10-09') }),
      ]);
      await service.save(
        'g1',
        {
          date: '2026-10-09',
          reason: ' довідка ',
          marks: [
            {
              childId: 'c1',
              status: DailyStatus.absent,
              reasonId: 'sick',
              documentProvided: true,
            },
          ],
        },
        admin,
        TODAY,
      );
      expect(
        firstArg<{ data: { voidReason: string } }>(
          mockPrisma.dailyAttendance.update,
        ).data.voidReason,
      ).toBe('довідка');
    });
  });

  describe('month', () => {
    it('summarizes each child', async () => {
      mockPrisma.dailyAttendance.findMany.mockResolvedValue([
        mark({
          childId: 'c1',
          date: day('2026-10-01'),
          status: DailyStatus.absent,
          reasonId: 'sick',
        }),
        mark({ childId: 'c1', date: day('2026-10-02') }),
      ]);
      const view = await service.month('g1', '2026-10', admin, TODAY);
      expect(view.days).toHaveLength(31);
      expect(view.children[0].summary).toEqual({
        workingDays: 10,
        present: 1,
        absentExcused: 1,
        absentUnexcused: 0,
        expectedAbsent: 0,
        unmarked: 8,
      });
      expect(
        view.children[0].days.filter((d) => d.state === 'unmarked').length,
      ).toBeGreaterThan(8);
    });
  });

  describe('expectedPresence', () => {
    it('includes present and unmarked working days only', async () => {
      mockPrisma.child.findMany.mockResolvedValue([
        { id: 'c1', group: { id: 'g1', kind: GroupKind.kindergarten } },
        { id: 'c2', group: null },
      ]);
      mockPrisma.dailyAttendance.findMany.mockResolvedValue([
        {
          childId: 'c1',
          date: day('2026-10-12'),
          status: DailyStatus.absent,
          reasonId: null,
          voidedAt: null,
          group: { id: 'g1', kind: GroupKind.kindergarten },
        },
      ]);
      mockPrisma.absenceNotice.findMany.mockResolvedValue([
        {
          childId: 'c1',
          startDate: day('2026-10-13'),
          endDate: day('2026-10-13'),
          reasonId: 'sick',
          status: NoticeStatus.approved,
        },
      ]);
      const rows = await service.expectedPresence(
        ['c1', 'c2'],
        day('2026-10-12'),
        day('2026-10-18'),
      );
      expect(
        rows.map((r) => `${r.childId} ${r.date.toISOString().slice(0, 10)}`),
      ).toEqual(['c1 2026-10-14', 'c1 2026-10-15', 'c1 2026-10-16']);
    });
  });

  describe('settings', () => {
    it('defaults to 3 and validates the range', async () => {
      await expect(service.getEditDays()).resolves.toBe(3);
      await expect(service.setEditDays(31)).rejects.toThrow(
        new BadRequestException('Edit days must be between 0 and 30'),
      );
      mockPrisma.appSetting.upsert.mockResolvedValue({});
      await expect(service.setEditDays(5)).resolves.toEqual({ editDays: 5 });
    });
  });
});
