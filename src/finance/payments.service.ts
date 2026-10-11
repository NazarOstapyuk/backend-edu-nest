import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AllocationItem, applyAllocations } from './allocations';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { money } from './finance-calc';

@Injectable()
export class PaymentsService {
  constructor(private prisma: PrismaService) {}

  async create(childId: string, dto: CreatePaymentDto, userId: string) {
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
    });
    if (!child) throw new NotFoundException('Child not found');
    if (money(dto.amount).lte(0)) {
      throw new BadRequestException('Amount must be greater than 0');
    }

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          childId,
          amount: dto.amount,
          category: dto.category,
          method: dto.method,
          status: PaymentStatus.confirmed,
          reference: dto.reference,
          receivedAt: new Date(dto.receivedAt),
          note: dto.note,
          createdById: userId,
        },
      });
      if (dto.allocations?.length) {
        await applyAllocations(tx, payment.id, dto.allocations, userId);
      }
      return payment;
    });
  }

  async allocate(paymentId: string, items: AllocationItem[], userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const { payment } = await applyAllocations(tx, paymentId, items, userId);
      return payment;
    });
  }

  async void(id: string, reason: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${id} FOR UPDATE`;
      const payment = await tx.payment.findUnique({ where: { id } });
      if (!payment) throw new NotFoundException('Payment not found');
      if (payment.voidedAt) throw new BadRequestException('Payment is voided');

      const data = {
        voidedAt: new Date(),
        voidedById: userId,
        voidReason: reason,
      };
      await tx.allocation.updateMany({
        where: { paymentId: id, voidedAt: null },
        data,
      });
      return tx.payment.update({ where: { id }, data });
    });
  }

  async voidAllocation(id: string, reason: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const allocation = await tx.allocation.findUnique({
        where: { id },
        include: { payment: { select: { childId: true } } },
      });
      if (!allocation) throw new NotFoundException('Allocation not found');

      const { count } = await tx.allocation.updateMany({
        where: { id, voidedAt: null },
        data: { voidedAt: new Date(), voidedById: userId, voidReason: reason },
      });
      if (count === 0) throw new BadRequestException('Allocation is voided');

      return { childId: allocation.payment.childId };
    });
  }
}
