import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChargeSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChargeDto } from './dto/create-charge.dto';
import { money } from './finance-calc';
import { voidChargeInTx } from './void-charge';

@Injectable()
export class ChargesService {
  constructor(private prisma: PrismaService) {}

  async create(childId: string, dto: CreateChargeDto, userId: string) {
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
    });
    if (!child) throw new NotFoundException('Child not found');
    if (money(dto.amount).lte(0)) {
      throw new BadRequestException('Amount must be greater than 0');
    }
    if (
      dto.periodStart &&
      dto.periodEnd &&
      new Date(dto.periodEnd) < new Date(dto.periodStart)
    ) {
      throw new BadRequestException(
        'Period end must not be before period start',
      );
    }

    return this.prisma.charge.create({
      data: {
        childId,
        category: dto.category,
        amount: dto.amount,
        description: dto.description,
        periodStart: dto.periodStart ? new Date(dto.periodStart) : undefined,
        periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : undefined,
        sourceType: ChargeSource.manual,
        createdById: userId,
      },
    });
  }

  async void(id: string, reason: string, userId: string) {
    return this.prisma.$transaction((tx) =>
      voidChargeInTx(tx, id, reason, userId),
    );
  }
}
