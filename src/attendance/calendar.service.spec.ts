import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CalendarDayType,
  CalendarScope,
  GroupKind,
  Role,
  AccessScope,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CalendarService } from './calendar.service';

const mockPrisma = {
  calendarDay: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  group: { findUnique: jest.fn() },
};

const admin = {
  id: 'a1',
  role: Role.admin,
  login: 'admin',
  mustChangePassword: false,
  accessScope: AccessScope.all,
  permissions: {},
};
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];

describe('CalendarService', () => {
  let service: CalendarService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        CalendarService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();
    service = moduleRef.get(CalendarService);
  });

  it('creates a single-day entry for everyone', async () => {
    mockPrisma.calendarDay.create.mockResolvedValue({ id: 'c1' });
    await service.create(
      {
        startDate: '2026-10-14',
        type: CalendarDayType.non_working,
        scope: CalendarScope.all,
        title: ' Свято ',
      },
      admin,
    );
    expect(
      firstArg<{ data: object }>(mockPrisma.calendarDay.create).data,
    ).toEqual({
      startDate: day('2026-10-14'),
      endDate: day('2026-10-14'),
      type: CalendarDayType.non_working,
      scope: CalendarScope.all,
      groupId: null,
      title: 'Свято',
      createdById: 'a1',
    });
  });

  it('rejects an inverted period', async () => {
    await expect(
      service.create(
        {
          startDate: '2026-10-14',
          endDate: '2026-10-13',
          type: CalendarDayType.non_working,
          scope: CalendarScope.all,
          title: 'x',
        },
        admin,
      ),
    ).rejects.toThrow(new BadRequestException('Invalid period'));
  });

  it('requires a group exactly for group scope', async () => {
    await expect(
      service.create(
        {
          startDate: '2026-10-14',
          type: CalendarDayType.non_working,
          scope: CalendarScope.group,
          title: 'x',
        },
        admin,
      ),
    ).rejects.toThrow(
      new BadRequestException('Group is required for group scope'),
    );
    await expect(
      service.create(
        {
          startDate: '2026-10-14',
          type: CalendarDayType.non_working,
          scope: CalendarScope.all,
          groupId: 'g1',
          title: 'x',
        },
        admin,
      ),
    ).rejects.toThrow(
      new BadRequestException('Group is required for group scope'),
    );
  });

  it('rejects an unknown group', async () => {
    mockPrisma.group.findUnique.mockResolvedValue(null);
    await expect(
      service.create(
        {
          startDate: '2026-10-14',
          type: CalendarDayType.non_working,
          scope: CalendarScope.group,
          groupId: 'g1',
          title: 'x',
        },
        admin,
      ),
    ).rejects.toThrow(new NotFoundException('Group not found'));
  });

  it('filters the list by the group kind when a group is given', async () => {
    mockPrisma.group.findUnique.mockResolvedValue({
      id: 'g1',
      kind: GroupKind.school_class,
    });
    mockPrisma.calendarDay.findMany.mockResolvedValue([]);
    await service.list('2026-10-01', '2026-10-31', 'g1');
    const where = firstArg<{ where: { OR: object[] } }>(
      mockPrisma.calendarDay.findMany,
    ).where;
    expect(where.OR).toEqual([
      { scope: CalendarScope.all },
      { scope: CalendarScope.school_class },
      { scope: CalendarScope.group, groupId: 'g1' },
    ]);
  });

  it('voids an entry once', async () => {
    mockPrisma.calendarDay.findUnique.mockResolvedValueOnce({
      id: 'c1',
      voidedAt: null,
    });
    mockPrisma.calendarDay.update.mockResolvedValue({ id: 'c1' });
    await service.void('c1', ' помилка ', admin);
    expect(
      firstArg<{ data: { voidedById: string; voidReason: string } }>(
        mockPrisma.calendarDay.update,
      ).data,
    ).toMatchObject({
      voidedById: 'a1',
      voidReason: 'помилка',
    });
    mockPrisma.calendarDay.findUnique.mockResolvedValueOnce({
      id: 'c1',
      voidedAt: new Date(),
    });
    await expect(service.void('c1', 'x', admin)).rejects.toThrow(
      new BadRequestException('Calendar entry is voided'),
    );
    mockPrisma.calendarDay.findUnique.mockResolvedValueOnce(null);
    await expect(service.void('c2', 'x', admin)).rejects.toThrow(
      new NotFoundException('Calendar entry not found'),
    );
  });
});
