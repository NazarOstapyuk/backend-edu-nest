import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccessScope, GroupKind, NoticeStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NoticesService } from './notices.service';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const TODAY = day('2026-10-14');
const admin = {
  id: 'a1',
  role: Role.admin,
  login: 'admin',
  mustChangePassword: false,
  accessScope: AccessScope.all,
  permissions: {},
};

const notice = (over: Record<string, unknown> = {}) => ({
  id: 'n1',
  startDate: day('2026-10-15'),
  endDate: day('2026-10-16'),
  comment: null,
  status: NoticeStatus.pending,
  decisionReason: null,
  createdAt: new Date('2026-10-14T07:00:00Z'),
  reason: { id: 'sick', name: 'Хвороба' },
  ...over,
});

const mockPrisma = {
  child: { findFirst: jest.fn() },
  absenceReason: { findFirst: jest.fn() },
  absenceNotice: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
  },
  mealOrder: { findMany: jest.fn() },
  appSetting: { findUnique: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};

const firstArg = <T>(fn: jest.Mock): T => (fn.mock.calls[0] as [T])[0];

describe('NoticesService', () => {
  let service: NoticesService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        NoticesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = moduleRef.get(NoticesService);
    mockPrisma.child.findFirst.mockResolvedValue({ id: 'c1' });
    mockPrisma.absenceReason.findFirst.mockResolvedValue({ id: 'sick' });
    mockPrisma.absenceNotice.findFirst.mockResolvedValue(null);
    mockPrisma.absenceNotice.create.mockResolvedValue(notice());
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(mockPrisma),
    );
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.mealOrder.findMany.mockResolvedValue([]);
  });

  describe('meal orders on approval', () => {
    it('looks up meal orders of the notice period when approving', async () => {
      mockPrisma.absenceNotice.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.absenceNotice.findUnique.mockResolvedValue({
        ...notice({ status: NoticeStatus.approved }),
        childId: 'c1',
      });
      await service.approve('n1', admin);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.mealOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            childId: 'c1',
            cancelledAt: null,
          }) as object,
        }),
      );
    });

    it('does not touch meal orders when rejecting', async () => {
      mockPrisma.absenceNotice.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.absenceNotice.findUnique.mockResolvedValue(
        notice({ status: NoticeStatus.rejected }),
      );
      await service.reject('n1', 'Немає підстав', admin);
      expect(mockPrisma.mealOrder.findMany).not.toHaveBeenCalled();
    });
  });

  describe('scope', () => {
    const scoped = { ...admin, accessScope: AccessScope.kindergarten };

    it('adds the kind filter to the list', async () => {
      mockPrisma.absenceNotice.findMany.mockResolvedValue([]);
      await service.list({ groupId: 'g1' }, scoped);
      expect(
        firstArg<{ where: object }>(mockPrisma.absenceNotice.findMany).where,
      ).toEqual({
        status: undefined,
        child: { groupId: 'g1', group: { kind: GroupKind.kindergarten } },
      });
    });

    it('does not filter an unscoped list', async () => {
      mockPrisma.absenceNotice.findMany.mockResolvedValue([]);
      await service.list({}, admin);
      expect(
        firstArg<{ where: object }>(mockPrisma.absenceNotice.findMany).where,
      ).toEqual({ status: undefined, child: {} });
    });

    it('reports a notice outside the scope as not found', async () => {
      mockPrisma.absenceNotice.findUnique.mockResolvedValue({
        id: 'n1',
        child: { group: { kind: GroupKind.school_class } },
      });
      await expect(service.approve('n1', scoped)).rejects.toThrow(
        new NotFoundException('Notice not found'),
      );
      expect(mockPrisma.absenceNotice.updateMany).not.toHaveBeenCalled();
    });

    it('decides a notice inside the scope', async () => {
      mockPrisma.absenceNotice.findUnique.mockResolvedValue({
        ...notice({ status: NoticeStatus.rejected }),
        child: { group: { kind: GroupKind.kindergarten } },
      });
      mockPrisma.absenceNotice.updateMany.mockResolvedValue({ count: 1 });
      await service.reject('n1', 'Немає підстав', scoped);
      expect(mockPrisma.absenceNotice.updateMany).toHaveBeenCalled();
    });
  });

  describe('admin decisions', () => {
    it('approves a pending notice', async () => {
      mockPrisma.absenceNotice.findUnique.mockResolvedValue(
        notice({ status: NoticeStatus.approved }),
      );
      mockPrisma.absenceNotice.updateMany.mockResolvedValue({ count: 1 });
      await service.approve('n1', admin);
      expect(
        firstArg<{ where: object; data: object }>(
          mockPrisma.absenceNotice.updateMany,
        ),
      ).toMatchObject({
        where: { id: 'n1', status: NoticeStatus.pending },
        data: {
          status: NoticeStatus.approved,
          decidedById: 'a1',
          decisionReason: null,
        },
      });
    });

    it('refuses to decide twice and reports missing notices', async () => {
      mockPrisma.absenceNotice.findUnique.mockResolvedValue(
        notice({ status: NoticeStatus.approved }),
      );
      mockPrisma.absenceNotice.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.reject('n1', 'ні', admin)).rejects.toThrow(
        new BadRequestException('Notice already decided'),
      );
      mockPrisma.absenceNotice.findUnique.mockResolvedValue(null);
      await expect(service.approve('n9', admin)).rejects.toThrow(
        new NotFoundException('Notice not found'),
      );
    });

    it('stores the trimmed reject reason and cancels only approved notices', async () => {
      mockPrisma.absenceNotice.findUnique.mockResolvedValue(notice());
      mockPrisma.absenceNotice.updateMany.mockResolvedValue({ count: 1 });
      await service.reject('n1', ' немає довідки ', admin);
      expect(
        firstArg<{ data: { decisionReason: string } }>(
          mockPrisma.absenceNotice.updateMany,
        ).data.decisionReason,
      ).toBe('немає довідки');
      await service.cancel('n1', 'помилка', admin);
      expect(
        (
          mockPrisma.absenceNotice.updateMany.mock.calls[1] as [
            { where: object; data: object },
          ]
        )[0],
      ).toMatchObject({
        where: { id: 'n1', status: NoticeStatus.approved },
        data: { status: NoticeStatus.cancelled },
      });
    });
  });

  describe('parent notices', () => {
    const dto = {
      startDate: '2026-10-15',
      endDate: '2026-10-16',
      reasonId: 'sick',
      comment: ' температура ',
    };

    it('hides a foreign child', async () => {
      mockPrisma.child.findFirst.mockResolvedValue(null);
      await expect(
        service.createForParent('p1', 'c1', dto, TODAY),
      ).rejects.toThrow(new NotFoundException('Child not found'));
      await expect(service.listForParent('p1', 'c1')).rejects.toThrow(
        new NotFoundException('Child not found'),
      );
    });

    it('rejects past starts, inverted and too long periods', async () => {
      await expect(
        service.createForParent(
          'p1',
          'c1',
          { ...dto, startDate: '2026-10-13' },
          TODAY,
        ),
      ).rejects.toThrow(new BadRequestException('Invalid period'));
      await expect(
        service.createForParent(
          'p1',
          'c1',
          { ...dto, endDate: '2026-10-14' },
          TODAY,
        ),
      ).rejects.toThrow(new BadRequestException('Invalid period'));
      await expect(
        service.createForParent(
          'p1',
          'c1',
          { ...dto, startDate: '2026-10-14', endDate: '2026-12-13' },
          TODAY,
        ),
      ).rejects.toThrow(new BadRequestException('Notice period is too long'));
      await expect(
        service.createForParent(
          'p1',
          'c1',
          { ...dto, startDate: '2026-10-14', endDate: '2026-12-12' },
          TODAY,
        ),
      ).resolves.toBeDefined();
    });

    it('rejects an inactive reason', async () => {
      mockPrisma.absenceReason.findFirst.mockResolvedValue(null);
      await expect(
        service.createForParent('p1', 'c1', dto, TODAY),
      ).rejects.toThrow(new BadRequestException('Absence reason not found'));
    });

    it('locks the child before checking overlaps and rejects an overlap', async () => {
      mockPrisma.absenceNotice.findFirst.mockResolvedValue(notice());
      await expect(
        service.createForParent('p1', 'c1', dto, TODAY),
      ).rejects.toThrow(
        new BadRequestException('Notice overlaps an existing notice'),
      );
      expect(mockPrisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.absenceNotice.findFirst.mock.invocationCallOrder[0],
      );
      expect(
        firstArg<{ where: object }>(mockPrisma.absenceNotice.findFirst).where,
      ).toEqual({
        childId: 'c1',
        status: { in: [NoticeStatus.pending, NoticeStatus.approved] },
        startDate: { lte: day('2026-10-16') },
        endDate: { gte: day('2026-10-15') },
      });
      expect(mockPrisma.absenceNotice.create).not.toHaveBeenCalled();
    });

    it('creates a pending notice and returns the parent view', async () => {
      const view = await service.createForParent('p1', 'c1', dto, TODAY);
      expect(
        firstArg<{ data: object }>(mockPrisma.absenceNotice.create).data,
      ).toEqual({
        childId: 'c1',
        startDate: day('2026-10-15'),
        endDate: day('2026-10-16'),
        reasonId: 'sick',
        comment: 'температура',
        createdById: 'p1',
      });
      expect(view).toEqual({
        id: 'n1',
        startDate: '2026-10-15',
        endDate: '2026-10-16',
        comment: null,
        status: NoticeStatus.pending,
        decisionReason: null,
        createdAt: new Date('2026-10-14T07:00:00Z'),
        reason: { id: 'sick', name: 'Хвороба' },
      });
    });

    it('lets a parent cancel only a pending notice of their child', async () => {
      mockPrisma.absenceNotice.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.absenceNotice.findUnique.mockResolvedValue(
        notice({ status: NoticeStatus.cancelled }),
      );
      await service.cancelForParent('p1', 'c1', 'n1');
      expect(
        firstArg<{ where: object }>(mockPrisma.absenceNotice.updateMany).where,
      ).toEqual({ id: 'n1', childId: 'c1', status: NoticeStatus.pending });
      mockPrisma.absenceNotice.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.absenceNotice.findFirst.mockResolvedValue(
        notice({ status: NoticeStatus.approved }),
      );
      await expect(service.cancelForParent('p1', 'c1', 'n1')).rejects.toThrow(
        new BadRequestException('Notice already decided'),
      );
      mockPrisma.absenceNotice.findFirst.mockResolvedValue(null);
      await expect(service.cancelForParent('p1', 'c1', 'n2')).rejects.toThrow(
        new NotFoundException('Notice not found'),
      );
    });
  });
});
