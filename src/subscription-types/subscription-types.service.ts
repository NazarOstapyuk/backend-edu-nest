import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSubscriptionTypeDto } from './dto/create-subscription-type.dto';
import { UpdateSubscriptionTypeDto } from './dto/update-subscription-type.dto';

@Injectable()
export class SubscriptionTypesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateSubscriptionTypeDto) {
    const existing = await this.prisma.subscriptionType.findUnique({ where: { name: dto.name } });
    if (existing) throw new BadRequestException('Subscription type with this name already exists');
    return this.prisma.subscriptionType.create({ data: { name: dto.name, pricePerSession: dto.pricePerSession } });
  }

  async findAll() {
    return this.prisma.subscriptionType.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(id: string) {
    const type = await this.prisma.subscriptionType.findUnique({ where: { id } });
    if (!type) throw new NotFoundException('Subscription type not found');
    return type;
  }

  async update(id: string, dto: UpdateSubscriptionTypeDto) {
    await this.findOne(id);
    return this.prisma.subscriptionType.update({ where: { id }, data: dto });
  }

  async delete(id: string) {
    await this.findOne(id);
    const count = await this.prisma.subscription.count({ where: { subscriptionTypeId: id } });
    if (count > 0) throw new BadRequestException('Cannot delete: subscriptions exist for this type');
    await this.prisma.subscriptionType.delete({ where: { id } });
    return { message: 'Subscription type deleted' };
  }
}
