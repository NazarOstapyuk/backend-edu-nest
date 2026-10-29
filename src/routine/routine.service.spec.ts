import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AccessScope,
  GroupKind,
  PermissionArea,
  PermissionLevel,
  Role,
} from '@prisma/client';
import { CalendarService } from '../attendance/calendar.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { RoutineService } from './routine.service';

const d = (value: string) => new Date(`${value}T00:00:00.000Z`);

const user = (over: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'u1',
  role: Role.admin,
  login: 'admin',
  mustChangePassword: false,
  accessScope: AccessScope.all,
  institutionIds: [],
  scopeInstitutionIds: null,
  permissions: { [PermissionArea.timetable]: PermissionLevel.edit },
  ...over,
});

const teacher = (over: Partial<AuthenticatedUser> = {}) =>
  user({ id: 't1', role: Role.teacher, permissions: {}, ...over });

const kgGroup = (over: Record<string, unknown> = {}) => ({
  id: 'g1',
  name: 'Сонечко',
  kind: GroupKind.kindergarten,
  institutionId: 'i1',
  teachers: [{ id: 't1' }],
  ...over,
});

const version = (
  id: string,
  validFrom: string,
  validTo: string | null,
  over: Record<string, unknown> = {},
) => ({
  id,
  groupId: 'g1',
  validFrom: d(validFrom),
  validTo: validTo ? d(validTo) : null,
  workingHours: null,
  note: null,
  items: [],
  ...over,
});

const mockPrisma = {
  group: { findFirst: jest.fn(), findMany: jest.fn() },
  institution: { findUnique: jest.fn() },
  child: { findFirst: jest.fn(), findUnique: jest.fn() },
  routineTemplate: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  routineTemplateItem: { deleteMany: jest.fn() },
  routineDay: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
  routineDayItem: { deleteMany: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};
const mockCalendar = { entriesBetween: jest.fn() };

const sqlOf = (call: number) =>
  (mockPrisma.$queryRaw.mock.calls[call] as [TemplateStringsArray])[0].join(
    '?',
  );

const lockedFirst = (read: jest.Mock) => {
  expect(sqlOf(0)).toContain('FOR UPDATE');
  expect(sqlOf(0)).toContain('"Group"');
  expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
    read.mock.invocationCallOrder[0],
  );
};

type CreatedVersion = {
  validTo: Date | null;
  items: { create: Record<string, unknown>[] };
} & Record<string, unknown>;

const createdData = (): CreatedVersion =>
  (
    mockPrisma.routineTemplate.create.mock.calls[0] as [
      { data: CreatedVersion },
    ]
  )[0].data;

const item = (weekday: number, startTime: string, endTime: string) => ({
  weekday,
  startTime,
  endTime,
  title: 'Сніданок',
});

describe('RoutineService', () => {
  let service: RoutineService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        RoutineService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CalendarService, useValue: mockCalendar },
      ],
    }).compile();
    service = moduleRef.get(RoutineService);
    mockPrisma.$transaction.mockImplementation(
      (cb: (tx: typeof mockPrisma) => unknown) => cb(mockPrisma),
    );
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.group.findFirst.mockResolvedValue(kgGroup());
    mockPrisma.institution.findUnique.mockResolvedValue({
      id: 'i1',
      type: GroupKind.kindergarten,
      isActive: true,
      name: 'Садок',
    });
    mockPrisma.routineTemplate.findMany.mockResolvedValue([]);
    mockPrisma.routineDay.findMany.mockResolvedValue([]);
    mockCalendar.entriesBetween.mockResolvedValue([]);
    mockPrisma.routineTemplate.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'new',
          workingHours: null,
          note: null,
          validTo: null,
          ...data,
          items: [],
        }),
    );
    mockPrisma.routineTemplate.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          ...version('v1', '2026-09-01', null),
          ...data,
          items: [],
        }),
    );
  });

  describe('groups', () => {
    it('adds hasTemplate from the template count', async () => {
      mockPrisma.group.findMany.mockResolvedValue([
        {
          id: 'g1',
          name: 'A',
          institution: { id: 'i1', name: 'I' },
          _count: { routineTemplates: 2 },
        },
        {
          id: 'g2',
          name: 'B',
          institution: { id: 'i1', name: 'I' },
          _count: { routineTemplates: 0 },
        },
      ]);
      const rows = await service.groups(user());
      expect(rows).toEqual([
        {
          id: 'g1',
          name: 'A',
          institution: { id: 'i1', name: 'I' },
          hasTemplate: true,
        },
        {
          id: 'g2',
          name: 'B',
          institution: { id: 'i1', name: 'I' },
          hasTemplate: false,
        },
      ]);
    });

    it('lists kindergarten groups in scope for a manager', async () => {
      mockPrisma.group.findMany.mockResolvedValue([]);
      await service.groups(user({ scopeInstitutionIds: ['i1'] }));
      expect(mockPrisma.group.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            kind: GroupKind.kindergarten,
            institutionId: { in: ['i1'] },
          },
        }),
      );
    });

    it('limits a teacher without the permission to own groups', async () => {
      mockPrisma.group.findMany.mockResolvedValue([]);
      await service.groups(teacher());
      expect(mockPrisma.group.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            kind: GroupKind.kindergarten,
            teachers: { some: { id: 't1' } },
          },
        }),
      );
    });
  });

  describe('reads', () => {
    it('looks up the group within the scope and answers 404 outside', async () => {
      mockPrisma.group.findFirst.mockResolvedValue(null);
      const scoped = user({ scopeInstitutionIds: ['i2'] });

      await expect(
        service.routine(scoped, 'g1', '2026-10-19', '2026-10-25'),
      ).rejects.toThrow(new NotFoundException('Group not found'));
      expect(mockPrisma.group.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'g1', institutionId: { in: ['i2'] } },
        }),
      );
    });

    it('hides a group the teacher does not teach', async () => {
      mockPrisma.group.findFirst.mockResolvedValue(
        kgGroup({ teachers: [{ id: 'other' }] }),
      );

      await expect(
        service.routine(teacher(), 'g1', '2026-10-19', '2026-10-25'),
      ).rejects.toThrow(new NotFoundException('Group not found'));
      await expect(service.templates(teacher(), 'g1')).rejects.toThrow(
        new NotFoundException('Group not found'),
      );
      expect(mockPrisma.routineTemplate.findMany).not.toHaveBeenCalled();
    });

    it('lets a teacher with the permission read any scoped group', async () => {
      mockPrisma.group.findFirst.mockResolvedValue(
        kgGroup({ teachers: [{ id: 'other' }] }),
      );
      const manager = teacher({
        permissions: { [PermissionArea.timetable]: PermissionLevel.view },
      });

      const result = await service.routine(
        manager,
        'g1',
        '2026-10-19',
        '2026-10-25',
      );

      expect(result.group).toEqual({ id: 'g1', name: 'Сонечко' });
      expect(result.days).toHaveLength(7);
    });

    it('lets a teacher read an own group', async () => {
      const result = await service.routine(
        teacher(),
        'g1',
        '2026-10-19',
        '2026-10-19',
      );
      expect(result.days).toHaveLength(1);
    });

    it('rejects a school group', async () => {
      mockPrisma.group.findFirst.mockResolvedValue(
        kgGroup({ kind: GroupKind.school_class }),
      );

      await expect(
        service.routine(user(), 'g1', '2026-10-19', '2026-10-25'),
      ).rejects.toThrow(
        new BadRequestException('Routine is for kindergarten groups'),
      );
    });

    it('rejects a period longer than 62 days and a reversed one', async () => {
      await expect(
        service.routine(user(), 'g1', '2026-10-01', '2026-12-02'),
      ).rejects.toThrow(new BadRequestException('Period too long'));
      await expect(
        service.routine(user(), 'g1', '2026-10-10', '2026-10-01'),
      ).rejects.toThrow(new BadRequestException('Invalid period'));
    });

    it('accepts exactly 62 days', async () => {
      const result = await service.routine(
        user(),
        'g1',
        '2026-10-01',
        '2026-12-01',
      );
      expect(result.days).toHaveLength(62);
    });

    it('defaults to a week from today', async () => {
      const result = await service.routine(user(), 'g1');
      expect(result.days).toHaveLength(7);
    });

    it('resolves days from template versions and overrides', async () => {
      mockPrisma.routineTemplate.findMany.mockResolvedValue([
        version('v1', '2026-09-01', null, {
          workingHours: '08:00–18:00',
          items: [{ ...item(1, '08:00', '09:15'), sortOrder: 0 }],
        }),
      ]);
      mockPrisma.routineDay.findMany.mockResolvedValue([
        { date: d('2026-10-20'), note: 'Свято', items: [] },
      ]);

      const result = await service.routine(
        user(),
        'g1',
        '2026-10-19',
        '2026-10-20',
      );

      expect(result.days[0]).toMatchObject({
        date: '2026-10-19',
        source: 'template',
        workingHours: '08:00–18:00',
        items: [{ startTime: '08:00', endTime: '09:15', title: 'Сніданок' }],
      });
      expect(result.days[1]).toMatchObject({
        source: 'override',
        note: 'Свято',
        items: [],
      });
    });

    it('lists template versions ordered by start with items', async () => {
      mockPrisma.routineTemplate.findMany.mockResolvedValue([
        version('v1', '2026-09-01', '2026-05-31', {
          items: [{ id: 'x', ...item(1, '08:00', '09:00'), sortOrder: 0 }],
        }),
      ]);

      const result = await service.templates(user(), 'g1');

      expect(mockPrisma.routineTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { groupId: 'g1' },
          orderBy: { validFrom: 'asc' },
        }),
      );
      expect(result).toEqual([
        {
          id: 'v1',
          validFrom: '2026-09-01',
          validTo: '2026-05-31',
          workingHours: null,
          note: null,
          items: [
            {
              weekday: 1,
              startTime: '08:00',
              endTime: '09:00',
              title: 'Сніданок',
            },
          ],
        },
      ]);
    });
  });

  describe('template versions', () => {
    it('closes the open version and locks the group first', async () => {
      mockPrisma.routineTemplate.findMany.mockResolvedValue([
        version('v1', '2026-09-01', null),
      ]);

      const result = await service.createTemplate(user(), 'g1', {
        validFrom: '2026-11-01',
        workingHours: ' 08:00–18:00 ',
        items: [item(1, '09:10', '09:30'), item(1, '08:00', '09:15')],
      });

      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
      expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.routineTemplate.findMany.mock.invocationCallOrder[0],
      );
      expect(mockPrisma.routineTemplate.update).toHaveBeenCalledWith({
        where: { id: 'v1' },
        data: { validTo: d('2026-10-31') },
      });
      const data = createdData();
      expect(data).toMatchObject({
        groupId: 'g1',
        validFrom: d('2026-11-01'),
        validTo: null,
        workingHours: '08:00–18:00',
        note: null,
        createdById: 'u1',
      });
      expect(data.items.create).toEqual([
        { ...item(1, '08:00', '09:15'), sortOrder: 0 },
        { ...item(1, '09:10', '09:30'), sortOrder: 1 },
      ]);
      expect(result).toMatchObject({ id: 'new', validFrom: '2026-11-01' });
    });

    it('ends a version created before a later one at its start − 1', async () => {
      mockPrisma.routineTemplate.findMany.mockResolvedValue([
        version('v1', '2026-09-01', '2027-05-31'),
        version('v2', '2027-06-01', null),
      ]);

      await service.createTemplate(user(), 'g1', {
        validFrom: '2027-01-01',
        items: [],
      });

      expect(mockPrisma.routineTemplate.update).toHaveBeenCalledWith({
        where: { id: 'v1' },
        data: { validTo: d('2026-12-31') },
      });
      expect(createdData().validTo).toEqual(d('2027-05-31'));
    });

    it('refuses a version starting on the same date', async () => {
      mockPrisma.routineTemplate.findMany.mockResolvedValue([
        version('v1', '2026-09-01', null),
      ]);

      await expect(
        service.createTemplate(user(), 'g1', {
          validFrom: '2026-09-01',
          items: [],
        }),
      ).rejects.toThrow(
        new ConflictException('Routine version already starts on this date'),
      );
      expect(mockPrisma.routineTemplate.create).not.toHaveBeenCalled();
    });

    it('refuses writes into an inactive institution', async () => {
      mockPrisma.institution.findUnique.mockResolvedValue({
        id: 'i1',
        type: GroupKind.kindergarten,
        isActive: false,
        name: 'Садок',
      });

      await expect(
        service.createTemplate(user(), 'g1', {
          validFrom: '2026-11-01',
          items: [],
        }),
      ).rejects.toThrow(new BadRequestException('Institution is inactive'));
      await expect(
        service.saveDay(user(), 'g1', '2026-11-03', { items: [] }),
      ).rejects.toThrow(new BadRequestException('Institution is inactive'));
    });

    it('refuses more than 60 items on one weekday', async () => {
      const items = Array.from({ length: 61 }, () => item(2, '08:00', '09:00'));
      await expect(
        service.createTemplate(user(), 'g1', {
          validFrom: '2026-11-01',
          items,
        }),
      ).rejects.toThrow(new BadRequestException('Too many items'));
    });

    it('accepts 60 items on each of several weekdays', async () => {
      const items = [1, 2].flatMap((w) =>
        Array.from({ length: 60 }, () => item(w, '08:00', '09:00')),
      );
      await expect(
        service.createTemplate(user(), 'g1', {
          validFrom: '2026-11-01',
          items,
        }),
      ).resolves.toBeDefined();
    });

    it('rejects an invalid time range', async () => {
      await expect(
        service.createTemplate(user(), 'g1', {
          validFrom: '2026-11-01',
          items: [item(1, '10:00', '09:00')],
        }),
      ).rejects.toThrow(new BadRequestException('Invalid time range'));
    });

    it('replaces items and texts of a version', async () => {
      mockPrisma.routineTemplate.findFirst.mockResolvedValue({
        id: 'v1',
        groupId: 'g1',
      });
      mockPrisma.routineTemplate.findUnique.mockResolvedValue({ id: 'v1' });

      await service.updateTemplate(user(), 'v1', {
        note: 'Перекус може зміститися',
        items: [item(3, '12:00', '15:00')],
      });

      expect(mockPrisma.routineTemplate.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'v1', group: {} } }),
      );
      lockedFirst(mockPrisma.routineTemplate.findUnique);
      expect(mockPrisma.routineTemplateItem.deleteMany).toHaveBeenCalledWith({
        where: { templateId: 'v1' },
      });
      expect(mockPrisma.routineTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'v1' },
          data: {
            workingHours: null,
            note: 'Перекус може зміститися',
            items: {
              create: [{ ...item(3, '12:00', '15:00'), sortOrder: 0 }],
            },
          },
        }),
      );
    });

    it('answers 404 for an unknown version', async () => {
      mockPrisma.routineTemplate.findFirst.mockResolvedValue(null);
      await expect(
        service.updateTemplate(user(), 'v9', { items: [] }),
      ).rejects.toThrow(new NotFoundException('Routine template not found'));
      await expect(service.deleteTemplate(user(), 'v9')).rejects.toThrow(
        new NotFoundException('Routine template not found'),
      );
    });

    it('answers 404 when the version is deleted before the lock is taken', async () => {
      mockPrisma.routineTemplate.findFirst.mockResolvedValue({
        id: 'v2',
        groupId: 'g1',
      });
      mockPrisma.routineTemplate.findUnique.mockResolvedValue(null);

      await expect(
        service.updateTemplate(user(), 'v2', { items: [] }),
      ).rejects.toThrow(new NotFoundException('Routine template not found'));
      expect(mockPrisma.routineTemplateItem.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.routineTemplate.update).not.toHaveBeenCalled();
    });

    it('hides versions of groups outside the scope from writers', async () => {
      mockPrisma.routineTemplate.findFirst.mockResolvedValue(null);
      const scoped = user({ scopeInstitutionIds: ['i2'] });

      await expect(
        service.updateTemplate(scoped, 'v1', { items: [] }),
      ).rejects.toThrow(new NotFoundException('Routine template not found'));
      await expect(service.deleteTemplate(scoped, 'v1')).rejects.toThrow(
        new NotFoundException('Routine template not found'),
      );
      expect(mockPrisma.routineTemplate.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'v1', group: { institutionId: { in: ['i2'] } } },
        }),
      );
      expect(mockPrisma.routineTemplate.update).not.toHaveBeenCalled();
      expect(mockPrisma.routineTemplate.delete).not.toHaveBeenCalled();
    });

    it('refuses to create a version in a group outside the scope', async () => {
      mockPrisma.group.findFirst.mockResolvedValue(null);

      await expect(
        service.createTemplate(user({ scopeInstitutionIds: ['i2'] }), 'g1', {
          validFrom: '2026-11-01',
          items: [],
        }),
      ).rejects.toThrow(new NotFoundException('Group not found'));
      expect(mockPrisma.group.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'g1', institutionId: { in: ['i2'] } },
        }),
      );
      expect(mockPrisma.routineTemplate.create).not.toHaveBeenCalled();
    });

    it('deletes the last open version and reopens the previous one', async () => {
      mockPrisma.routineTemplate.findFirst.mockResolvedValue({
        id: 'v2',
        groupId: 'g1',
      });
      mockPrisma.routineTemplate.findMany.mockResolvedValue([
        version('v1', '2026-09-01', '2026-10-31'),
        version('v2', '2026-11-01', null),
      ]);

      await service.deleteTemplate(user(), 'v2');

      lockedFirst(mockPrisma.routineTemplate.findMany);
      expect(mockPrisma.routineTemplate.update).toHaveBeenCalledWith({
        where: { id: 'v1' },
        data: { validTo: null },
      });
      expect(mockPrisma.routineTemplate.delete).toHaveBeenCalledWith({
        where: { id: 'v2' },
      });
    });

    it('deletes a version and reopens the previous one', async () => {
      mockPrisma.routineTemplate.findFirst.mockResolvedValue({
        id: 'v2',
        groupId: 'g1',
      });
      mockPrisma.routineTemplate.findMany.mockResolvedValue([
        version('v1', '2026-09-01', '2026-10-31'),
        version('v2', '2026-11-01', '2027-05-31'),
        version('v3', '2027-06-01', null),
      ]);

      const result = await service.deleteTemplate(user(), 'v2');

      expect(mockPrisma.routineTemplate.update).toHaveBeenCalledWith({
        where: { id: 'v1' },
        data: { validTo: d('2027-05-31') },
      });
      expect(mockPrisma.routineTemplate.delete).toHaveBeenCalledWith({
        where: { id: 'v2' },
      });
      expect(result).toEqual({ message: 'Routine template deleted' });
    });

    it('deletes the first version without touching others', async () => {
      mockPrisma.routineTemplate.findFirst.mockResolvedValue({
        id: 'v1',
        groupId: 'g1',
      });
      mockPrisma.routineTemplate.findMany.mockResolvedValue([
        version('v1', '2026-09-01', '2026-10-31'),
        version('v2', '2026-11-01', null),
      ]);

      await service.deleteTemplate(user(), 'v1');

      expect(mockPrisma.routineTemplate.update).not.toHaveBeenCalled();
      expect(mockPrisma.routineTemplate.delete).toHaveBeenCalledWith({
        where: { id: 'v1' },
      });
    });
  });

  describe('copy', () => {
    it('refuses the same group', async () => {
      await expect(
        service.copy(user(), 'g1', {
          sourceGroupId: 'g1',
          validFrom: '2026-11-01',
        }),
      ).rejects.toThrow(
        new BadRequestException('Cannot copy to the same group'),
      );
    });

    it('answers 404 without a source version on the date', async () => {
      mockPrisma.routineTemplate.findFirst.mockResolvedValue(null);

      await expect(
        service.copy(user(), 'g1', {
          sourceGroupId: 'g2',
          validFrom: '2026-11-01',
        }),
      ).rejects.toThrow(new NotFoundException('Routine template not found'));
      expect(mockPrisma.routineTemplate.create).not.toHaveBeenCalled();
    });

    it('copies items, working hours and note into a new version', async () => {
      mockPrisma.group.findFirst
        .mockResolvedValueOnce(kgGroup())
        .mockResolvedValueOnce(kgGroup({ id: 'g2', name: 'Зайчики' }));
      mockPrisma.routineTemplate.findFirst.mockResolvedValue(
        version('s1', '2026-09-01', null, {
          groupId: 'g2',
          workingHours: '07:30–18:30',
          note: '* Час може коригуватися',
          items: [
            { id: 'a', ...item(2, '08:00', '09:00'), sortOrder: 0 },
            { id: 'b', ...item(1, '08:00', '09:00'), sortOrder: 0 },
          ],
        }),
      );

      await service.copy(user(), 'g1', {
        sourceGroupId: 'g2',
        validFrom: '2026-11-01',
      });

      expect(mockPrisma.group.findFirst).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: { id: 'g2' } }),
      );
      expect(mockPrisma.routineTemplate.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            groupId: 'g2',
            validFrom: { lte: d('2026-11-01') },
            OR: [{ validTo: null }, { validTo: { gte: d('2026-11-01') } }],
          },
        }),
      );
      lockedFirst(mockPrisma.routineTemplate.findMany);
      const data = createdData();
      expect(data).toMatchObject({
        groupId: 'g1',
        validFrom: d('2026-11-01'),
        workingHours: '07:30–18:30',
        note: '* Час може коригуватися',
      });
      expect(data.items.create).toHaveLength(2);
      expect(data.items.create[0]).not.toHaveProperty('id');
    });

    it('refuses when the target already has a version on that date', async () => {
      mockPrisma.routineTemplate.findFirst.mockResolvedValue(
        version('s1', '2026-09-01', null, { groupId: 'g2' }),
      );
      mockPrisma.routineTemplate.findMany.mockResolvedValue([
        version('v1', '2026-11-01', null),
      ]);

      await expect(
        service.copy(user(), 'g1', {
          sourceGroupId: 'g2',
          validFrom: '2026-11-01',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('hides a source group outside the scope', async () => {
      mockPrisma.group.findFirst
        .mockResolvedValueOnce(kgGroup({ institutionId: 'i2' }))
        .mockResolvedValueOnce(null);

      await expect(
        service.copy(user({ scopeInstitutionIds: ['i2'] }), 'g1', {
          sourceGroupId: 'g2',
          validFrom: '2026-11-01',
        }),
      ).rejects.toThrow(new NotFoundException('Group not found'));
      expect(mockPrisma.group.findFirst).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { id: 'g2', institutionId: { in: ['i2'] } },
        }),
      );
      expect(mockPrisma.routineTemplate.create).not.toHaveBeenCalled();
    });
  });

  describe('day overrides', () => {
    it('creates an override and returns the day view', async () => {
      mockPrisma.routineDay.findUnique.mockResolvedValue(null);
      mockPrisma.routineDay.findMany.mockResolvedValue([
        {
          date: d('2026-11-03'),
          note: null,
          items: [{ ...item(0, '10:00', '11:00'), sortOrder: 0 }],
        },
      ]);

      const result = await service.saveDay(user(), 'g1', '2026-11-03', {
        items: [{ startTime: '10:00', endTime: '11:00', title: ' Свято ' }],
      });

      expect(mockPrisma.routineDay.create).toHaveBeenCalledWith({
        data: {
          groupId: 'g1',
          date: d('2026-11-03'),
          note: null,
          createdById: 'u1',
          items: {
            create: [
              {
                startTime: '10:00',
                endTime: '11:00',
                title: 'Свято',
                sortOrder: 0,
              },
            ],
          },
        },
      });
      expect(result).toMatchObject({ date: '2026-11-03', source: 'override' });
    });

    it('replaces an existing override', async () => {
      mockPrisma.routineDay.findUnique.mockResolvedValue({ id: 'day1' });

      await service.saveDay(user(), 'g1', '2026-11-03', {
        note: 'Екскурсія',
        items: [],
      });

      lockedFirst(mockPrisma.routineDay.findUnique);
      expect(mockPrisma.routineDayItem.deleteMany).toHaveBeenCalledWith({
        where: { dayId: 'day1' },
      });
      expect(mockPrisma.routineDay.update).toHaveBeenCalledWith({
        where: { id: 'day1' },
        data: { note: 'Екскурсія', items: { create: [] } },
      });
      expect(mockPrisma.routineDay.create).not.toHaveBeenCalled();
    });

    it('deletes an override and returns the template day', async () => {
      const result = await service.deleteDay(user(), 'g1', '2026-11-03');

      lockedFirst(mockPrisma.routineDay.deleteMany);
      expect(mockPrisma.routineDay.deleteMany).toHaveBeenCalledWith({
        where: { groupId: 'g1', date: d('2026-11-03') },
      });
      expect(result).toMatchObject({ date: '2026-11-03', source: 'none' });
    });

    it('refuses an invalid date', async () => {
      await expect(
        service.saveDay(user(), 'g1', '2026-13-01', { items: [] }),
      ).rejects.toThrow(new BadRequestException('Invalid date'));
    });
  });

  describe('parents', () => {
    it('hides a foreign child', async () => {
      mockPrisma.child.findFirst.mockResolvedValue(null);
      await expect(
        service.parentRoutine('p1', 'c9', '2026-10-19', '2026-10-25'),
      ).rejects.toThrow(new NotFoundException('Child not found'));
    });

    it('returns empty days for a school child', async () => {
      mockPrisma.child.findFirst.mockResolvedValue({ id: 'c1' });
      mockPrisma.child.findUnique.mockResolvedValue({
        group: kgGroup({ kind: GroupKind.school_class }),
      });

      const result = await service.parentRoutine(
        'p1',
        'c1',
        '2026-10-19',
        '2026-10-25',
      );

      expect(result).toEqual({ group: null, days: [] });
      expect(mockPrisma.routineTemplate.findMany).not.toHaveBeenCalled();
    });

    it('returns empty days for a child without a group', async () => {
      mockPrisma.child.findFirst.mockResolvedValue({ id: 'c1' });
      mockPrisma.child.findUnique.mockResolvedValue({ group: null });

      await expect(
        service.parentRoutine('p1', 'c1', '2026-10-19', '2026-10-25'),
      ).resolves.toEqual({ group: null, days: [] });
    });

    it('returns the routine of a kindergarten child group', async () => {
      mockPrisma.child.findFirst.mockResolvedValue({ id: 'c1' });
      mockPrisma.child.findUnique.mockResolvedValue({ group: kgGroup() });

      const result = await service.parentRoutine(
        'p1',
        'c1',
        '2026-10-19',
        '2026-10-25',
      );

      expect(result.group).toEqual({ id: 'g1', name: 'Сонечко' });
      expect(result.days).toHaveLength(7);
    });
  });
});
