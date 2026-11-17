import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CashDesk } from '@prisma/client';
import { formatMoney } from '../finance/finance-calc';
import { PrismaService } from '../prisma/prisma.service';
import { shiftTotals, expectedBalance, type CashTotals } from './cash-calc';
import {
  isUniqueViolation,
  person,
  personSelect,
  totalsSelect,
  type Person,
} from './cash-views';
import type { CreateDeskDto } from './dto/create-desk.dto';
import type { UpdateDeskDto } from './dto/update-desk.dto';

export interface CashDeskState {
  id: string;
  name: string;
  isActive: boolean;
  largeAmount: string;
  closeBy: string;
  openShift: {
    id: string;
    openedAt: Date;
    openedBy: Person;
    openingCounted: string;
    totals: CashTotals;
    expected: string;
  } | null;
  lastClosed: {
    id: string;
    closedAt: Date;
    closedBy: Person;
    closingExpected: string;
    closingCounted: string;
    difference: string;
  } | null;
}

@Injectable()
export class CashDesksService {
  constructor(private prisma: PrismaService) {}

  async list(all: boolean): Promise<CashDeskState[]> {
    const desks = await this.prisma.cashDesk.findMany({
      where: all ? {} : { isActive: true },
      orderBy: { name: 'asc' },
    });
    return Promise.all(desks.map((desk) => this.state(desk)));
  }

  private async state(desk: CashDesk): Promise<CashDeskState> {
    const open = await this.prisma.cashShift.findFirst({
      where: { deskId: desk.id, closedAt: null },
      include: {
        openedBy: personSelect,
        entries: { select: totalsSelect },
      },
    });
    const last = await this.prisma.cashShift.findFirst({
      where: { deskId: desk.id, closedAt: { not: null } },
      orderBy: { closedAt: 'desc' },
      include: { closedBy: personSelect },
    });
    const totals = open ? shiftTotals(open.entries) : null;
    return {
      id: desk.id,
      name: desk.name,
      isActive: desk.isActive,
      largeAmount: formatMoney(desk.largeAmount),
      closeBy: desk.closeBy,
      openShift:
        open && totals
          ? {
              id: open.id,
              openedAt: open.openedAt,
              openedBy: person(open.openedBy),
              openingCounted: formatMoney(open.openingCounted),
              totals,
              expected: formatMoney(
                expectedBalance(open.openingCounted, totals),
              ),
            }
          : null,
      lastClosed:
        last && last.closedAt && last.closedBy && last.closingCounted
          ? {
              id: last.id,
              closedAt: last.closedAt,
              closedBy: person(last.closedBy),
              closingExpected: formatMoney(last.closingExpected ?? 0),
              closingCounted: formatMoney(last.closingCounted),
              difference: formatMoney(
                last.closingCounted.sub(last.closingExpected ?? 0),
              ),
            }
          : null,
    };
  }

  async create(dto: CreateDeskDto): Promise<CashDeskState> {
    const desk = await this.writeUnique(() =>
      this.prisma.cashDesk.create({
        data: {
          name: dto.name.trim(),
          largeAmount: dto.largeAmount,
          closeBy: dto.closeBy,
        },
      }),
    );
    return this.state(desk);
  }

  async update(id: string, dto: UpdateDeskDto): Promise<CashDeskState> {
    const desk = await this.writeUnique(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "CashDesk" WHERE id = ${id} FOR UPDATE`;
        const existing = await tx.cashDesk.findUnique({ where: { id } });
        if (!existing) throw new NotFoundException('Cash desk not found');
        if (dto.isActive === false && existing.isActive) {
          const open = await tx.cashShift.findFirst({
            where: { deskId: id, closedAt: null },
          });
          if (open) throw new BadRequestException('Close the shift first');
        }
        return tx.cashDesk.update({
          where: { id },
          data: {
            ...(dto.name !== undefined && { name: dto.name.trim() }),
            ...(dto.largeAmount !== undefined && {
              largeAmount: dto.largeAmount,
            }),
            ...(dto.closeBy !== undefined && { closeBy: dto.closeBy }),
            ...(dto.isActive !== undefined && { isActive: dto.isActive }),
          },
        });
      }),
    );
    return this.state(desk);
  }

  private async writeUnique<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new BadRequestException('Cash desk name already taken');
      }
      throw error;
    }
  }
}
