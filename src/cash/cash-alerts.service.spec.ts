import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CashAlertsService } from './cash-alerts.service';

const mockPrisma = {
  cashAlert: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
    updateMany: jest.fn(),
  },
  cashShift: { findMany: jest.fn() },
};

const containing = (value: object): object =>
  expect.objectContaining(value) as object;

const ira = { id: 'u1', firstName: 'Ira', lastName: 'Koval' };

const alertRow = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  type: 'discrepancy',
  deskId: 'desk-1',
  desk: { name: 'Main' },
  shiftId: 's1',
  entryId: null,
  amount: new Prisma.Decimal('-5'),
  actor: ira,
  createdAt: new Date('2026-11-17T09:00:00Z'),
  acknowledgedAt: null,
  ...over,
});

const shiftRow = (openedAt: string, closeBy = '20:00') => ({
  id: 's1',
  deskId: 'desk-1',
  openedAt: new Date(openedAt),
  desk: { name: 'Main', closeBy },
  openedBy: ira,
});

describe('CashAlertsService', () => {
  let service: CashAlertsService;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-17T10:00:00.000Z'));
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        CashAlertsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(CashAlertsService);
  });

  afterEach(() => jest.useRealTimers());

  it('lists unacknowledged alerts newest first with money as a string', async () => {
    mockPrisma.cashAlert.findMany.mockResolvedValue([alertRow()]);
    const result = await service.list(false);
    expect(result).toEqual([
      {
        id: 'a1',
        type: 'discrepancy',
        deskId: 'desk-1',
        deskName: 'Main',
        shiftId: 's1',
        entryId: null,
        amount: '-5.00',
        actor: { id: 'u1', name: 'Koval Ira' },
        createdAt: new Date('2026-11-17T09:00:00Z'),
        acknowledgedAt: null,
      },
    ]);
    expect(mockPrisma.cashAlert.findMany).toHaveBeenCalledWith(
      containing({
        where: { acknowledgedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    );
  });

  it('lists acknowledged alerts too with all', async () => {
    mockPrisma.cashAlert.findMany.mockResolvedValue([]);
    await service.list(true);
    expect(mockPrisma.cashAlert.findMany).toHaveBeenCalledWith(
      containing({ where: {} }),
    );
  });

  it('count includes unacknowledged alerts and unclosed shifts', async () => {
    mockPrisma.cashAlert.count.mockResolvedValue(2);
    mockPrisma.cashShift.findMany.mockResolvedValue([
      shiftRow('2026-11-16T08:00:00Z'),
      shiftRow('2026-11-17T08:00:00Z'),
    ]);
    expect(await service.count()).toEqual({ count: 3 });
  });

  it('lists an open shift from an earlier day as unclosed', async () => {
    mockPrisma.cashShift.findMany.mockResolvedValue([
      shiftRow('2026-11-16T08:00:00Z'),
      shiftRow('2026-11-17T08:00:00Z'),
    ]);
    const result = await service.unclosed();
    expect(result).toEqual([
      {
        deskId: 'desk-1',
        deskName: 'Main',
        shiftId: 's1',
        openedAt: new Date('2026-11-16T08:00:00Z'),
        openedBy: { id: 'u1', name: 'Koval Ira' },
      },
    ]);
    expect(mockPrisma.cashShift.findMany).toHaveBeenCalledWith(
      containing({ where: { closedAt: null, desk: { isActive: true } } }),
    );
  });

  it('acknowledges an alert with the user', async () => {
    mockPrisma.cashAlert.findUnique.mockResolvedValue({
      id: 'a1',
      acknowledgedAt: null,
    });
    mockPrisma.cashAlert.updateMany.mockResolvedValue({ count: 1 });
    expect(await service.ack('a1', 'm1')).toEqual({ updated: 1 });
    expect(mockPrisma.cashAlert.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', acknowledgedAt: null },
      data: {
        acknowledgedAt: new Date('2026-11-17T10:00:00.000Z'),
        acknowledgedById: 'm1',
      },
    });
  });

  it('ack of an acknowledged alert is idempotent', async () => {
    mockPrisma.cashAlert.findUnique.mockResolvedValue({
      id: 'a1',
      acknowledgedAt: new Date(),
    });
    expect(await service.ack('a1', 'm1')).toEqual({ updated: 0 });
    expect(mockPrisma.cashAlert.updateMany).not.toHaveBeenCalled();
  });

  it('ack of a missing alert is 404', async () => {
    mockPrisma.cashAlert.findUnique.mockResolvedValue(null);
    await expect(service.ack('x', 'm1')).rejects.toThrow(
      new NotFoundException('Alert not found'),
    );
  });

  it('ack-all acknowledges every open alert', async () => {
    mockPrisma.cashAlert.updateMany.mockResolvedValue({ count: 4 });
    expect(await service.ackAll('m1')).toEqual({ updated: 4 });
    expect(mockPrisma.cashAlert.updateMany).toHaveBeenCalledWith({
      where: { acknowledgedAt: null },
      data: {
        acknowledgedAt: new Date('2026-11-17T10:00:00.000Z'),
        acknowledgedById: 'm1',
      },
    });
  });
});
