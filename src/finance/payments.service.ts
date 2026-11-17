import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Payment, PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';
import { scopeIds } from '../access/access-calc';
import { assertChildInScope } from '../access/scope';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { directionForInstitution } from '../cash/cash-calc';
import { CashAlertsService } from '../cash/cash-alerts.service';
import { CashShiftsService, lockDesk } from '../cash/cash-shifts.service';
import { PrismaService } from '../prisma/prisma.service';
import { AllocationItem, applyAllocations } from './allocations';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { addDays, kyivToday } from '../tariffs/dates';
import { money } from './finance-calc';

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private shifts: CashShiftsService,
    private alerts: CashAlertsService,
  ) {}

  async create(
    childId: string,
    dto: CreatePaymentDto,
    userId: string,
    user: AuthenticatedUser,
  ) {
    await assertChildInScope(this.prisma, scopeIds(user), childId);
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
      include: {
        group: { select: { institution: { select: { type: true } } } },
      },
    });
    if (!child) throw new NotFoundException('Child not found');
    if (money(dto.amount).lte(0)) {
      throw new BadRequestException('Amount must be greater than 0');
    }

    const receivedAt = new Date(dto.receivedAt);
    if (receivedAt.getTime() >= addDays(kyivToday(), 1).getTime()) {
      throw new BadRequestException('Date is in the future');
    }

    const isCash = dto.method === PaymentMethod.cash;
    if (isCash && !dto.cashDeskId) {
      throw new BadRequestException('Cash desk is required');
    }
    const periodFrom = dto.periodFrom ? new Date(dto.periodFrom) : null;
    const periodTo = dto.periodTo ? new Date(dto.periodTo) : null;
    if (periodFrom && periodTo && periodTo.getTime() < periodFrom.getTime()) {
      throw new BadRequestException('Period end is before start');
    }

    return this.prisma.$transaction(async (tx) => {
      const shift =
        isCash && dto.cashDeskId
          ? await this.shifts.lockOpenShift(tx, dto.cashDeskId)
          : null;
      const payment = await tx.payment.create({
        data: {
          childId,
          amount: dto.amount,
          category: dto.category,
          method: dto.method,
          status: PaymentStatus.confirmed,
          reference: dto.reference?.trim() ?? '',
          receivedAt,
          note: dto.note,
          payerName: dto.payerName?.trim() || null,
          periodFrom,
          periodTo,
          createdById: userId,
        },
      });
      if (shift) {
        await tx.cashEntry.create({
          data: {
            deskId: shift.deskId,
            shiftId: shift.id,
            kind: 'income',
            amount: dto.amount,
            direction: directionForInstitution(child.group?.institution.type),
            paymentId: payment.id,
            createdById: userId,
          },
        });
      }
      if (dto.allocations?.length) {
        await applyAllocations(tx, payment.id, dto.allocations, userId);
      }
      return payment;
    });
  }

  private async assertPaymentInScope(id: string, user: AuthenticatedUser) {
    const ids = scopeIds(user);
    if (!ids) return;
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      select: { childId: true },
    });
    if (payment)
      await assertChildInScope(
        this.prisma,
        ids,
        payment.childId,
        'Payment not found',
      );
  }

  async allocate(
    paymentId: string,
    items: AllocationItem[],
    userId: string,
    user: AuthenticatedUser,
  ) {
    await this.assertPaymentInScope(paymentId, user);
    return this.prisma.$transaction(async (tx) => {
      const { payment } = await applyAllocations(tx, paymentId, items, userId);
      return payment;
    });
  }

  async void(
    id: string,
    reason: string,
    userId: string,
    user: AuthenticatedUser,
  ) {
    await this.assertPaymentInScope(id, user);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${id} FOR UPDATE`;
      const payment = await tx.payment.findUnique({ where: { id } });
      if (!payment) throw new NotFoundException('Payment not found');
      if (payment.voidedAt) throw new BadRequestException('Payment is voided');

      const cash = await this.voidCashEntry(tx, payment, reason, userId);

      const data = {
        voidedAt: new Date(),
        voidedById: userId,
        voidReason: reason,
      };
      await tx.allocation.updateMany({
        where: { paymentId: id, voidedAt: null },
        data,
      });
      const updated = await tx.payment.update({ where: { id }, data });
      if (cash) {
        await this.alerts.create(tx, {
          deskId: cash.deskId,
          shiftId: cash.shiftId,
          entryId: cash.entryId,
          type: 'payment_void',
          amount: payment.amount,
          actorId: userId,
        });
      }
      return updated;
    });
  }

  private async voidCashEntry(
    tx: Prisma.TransactionClient,
    payment: Payment,
    reason: string,
    userId: string,
  ) {
    const entry = await tx.cashEntry.findUnique({
      where: { paymentId: payment.id },
    });
    if (!entry || entry.voidedAt) return null;
    await lockDesk(tx, entry.deskId);
    const entryShift = await tx.cashShift.findUnique({
      where: { id: entry.shiftId },
    });
    if (entryShift && !entryShift.closedAt) {
      await tx.cashEntry.update({
        where: { id: entry.id },
        data: {
          voidedAt: new Date(),
          voidedById: userId,
          voidReason: reason,
        },
      });
      return {
        deskId: entry.deskId,
        shiftId: entry.shiftId,
        entryId: entry.id,
      };
    }
    const open = await this.shifts.lockOpenShift(tx, entry.deskId);
    const balance = await this.shifts.balance(tx, open);
    if (payment.amount.gt(balance)) {
      throw new BadRequestException('Not enough cash');
    }
    const correction = await tx.cashEntry.create({
      data: {
        deskId: entry.deskId,
        shiftId: open.id,
        kind: 'correction',
        amount: payment.amount,
        sign: -1,
        direction: entry.direction,
        correctsId: entry.id,
        comment: `Скасування оплати: ${reason}`,
        createdById: userId,
      },
    });
    return { deskId: entry.deskId, shiftId: open.id, entryId: correction.id };
  }

  async voidAllocation(
    id: string,
    reason: string,
    userId: string,
    user: AuthenticatedUser,
  ) {
    const ids = scopeIds(user);
    return this.prisma.$transaction(async (tx) => {
      const allocation = await tx.allocation.findUnique({
        where: { id },
        include: { payment: { select: { childId: true } } },
      });
      if (!allocation) throw new NotFoundException('Allocation not found');
      await assertChildInScope(
        tx,
        ids,
        allocation.payment.childId,
        'Allocation not found',
      );

      const { count } = await tx.allocation.updateMany({
        where: { id, voidedAt: null },
        data: { voidedAt: new Date(), voidedById: userId, voidReason: reason },
      });
      if (count === 0) throw new BadRequestException('Allocation is voided');

      return { childId: allocation.payment.childId };
    });
  }
}
