import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CashDesksService } from './cash-desks.service';

const mockPrisma = {
  cashDesk: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  cashShift: { findFirst: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};

const desk = (over: Record<string, unknown> = {}) => ({
  id: 'desk-1',
  name: 'Main',
  isActive: true,
  largeAmount: new Prisma.Decimal('5000'),
  closeBy: '20:00',
  ...over,
});

describe('CashDesksService', () => {
  let service: CashDesksService;

  beforeEach(async () => {
    jest.resetAllMocks();
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(mockPrisma),
    );
    mockPrisma.cashShift.findFirst.mockResolvedValue(null);
    const module = await Test.createTestingModule({
      providers: [
        CashDesksService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(CashDesksService);
  });

  it('refuses to deactivate a desk with an open shift', async () => {
    mockPrisma.cashDesk.findUnique.mockResolvedValue(desk());
    mockPrisma.cashShift.findFirst.mockResolvedValueOnce({ id: 's1' });
    await expect(service.update('desk-1', { isActive: false })).rejects.toThrow(
      new BadRequestException('Close the shift first'),
    );
    expect(mockPrisma.cashDesk.update).not.toHaveBeenCalled();
  });

  it('deactivates a desk without an open shift', async () => {
    mockPrisma.cashDesk.findUnique.mockResolvedValue(desk());
    mockPrisma.cashDesk.update.mockResolvedValue(desk({ isActive: false }));
    const state = await service.update('desk-1', { isActive: false });
    expect(state.isActive).toBe(false);
    expect(state.largeAmount).toBe('5000.00');
  });

  it('rejects an unknown desk', async () => {
    mockPrisma.cashDesk.findUnique.mockResolvedValue(null);
    await expect(service.update('x', { name: 'A' })).rejects.toThrow(
      new NotFoundException('Cash desk not found'),
    );
  });

  it('maps a duplicate name to Cash desk name already taken', async () => {
    mockPrisma.cashDesk.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );
    await expect(
      service.create({ name: 'Main', largeAmount: '100', closeBy: '20:00' }),
    ).rejects.toThrow(new BadRequestException('Cash desk name already taken'));
  });

  it('lists only active desks unless all is set', async () => {
    mockPrisma.cashDesk.findMany.mockResolvedValue([]);
    await service.list(false);
    expect(
      (mockPrisma.cashDesk.findMany.mock.calls as [{ where: unknown }][])[0][0]
        .where,
    ).toEqual({
      isActive: true,
    });
    await service.list(true);
    expect(
      (mockPrisma.cashDesk.findMany.mock.calls as [{ where: unknown }][])[1][0]
        .where,
    ).toEqual({});
  });
});
