import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChildDto } from './dto/create-child.dto';
import { UpdateChildDto } from './dto/update-child.dto';

@Injectable()
export class ChildrenService {
  constructor(private prisma: PrismaService) {}

  private async validateParents(ids: string[]) {
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, role: true },
    });

    const notFound = ids.filter((id) => !users.find((u) => u.id === id));
    if (notFound.length) {
      throw new NotFoundException(`Users not found: ${notFound.join(', ')}`);
    }

    const notParents = users.filter((u) => u.role !== Role.parent);
    if (notParents.length) {
      throw new BadRequestException(
        `Users are not parents: ${notParents.map((u) => u.id).join(', ')}`,
      );
    }
  }

  async create(dto: CreateChildDto) {
    if (dto.groupId) {
      const group = await this.prisma.group.findUnique({ where: { id: dto.groupId } });
      if (!group) throw new NotFoundException('Group not found');
    }

    if (dto.parentIds?.length) await this.validateParents(dto.parentIds);

    return this.prisma.child.create({
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        birthDate: new Date(dto.birthDate),
        gender: dto.gender,
        groupId: dto.groupId,
        parents: dto.parentIds?.length
          ? { connect: dto.parentIds.map((id) => ({ id })) }
          : undefined,
      },
      include: {
        group: true,
        parents: { omit: { password: true, refreshToken: true } },
        subscriptions: { include: { subscriptionType: true }, orderBy: { createdAt: 'desc' } },
      },
    });
  }

  async findAll() {
    return this.prisma.child.findMany({
      include: {
        group: true,
        parents: { omit: { password: true, refreshToken: true } },
        subscriptions: { include: { subscriptionType: true }, orderBy: { createdAt: 'desc' } },
      },
    });
  }

  async update(id: string, dto: UpdateChildDto) {
    const child = await this.prisma.child.findUnique({ where: { id } });
    if (!child) throw new NotFoundException('Child not found');

    if (dto.groupId) {
      const group = await this.prisma.group.findUnique({ where: { id: dto.groupId } });
      if (!group) throw new NotFoundException('Group not found');
    }

    if (dto.parentIds?.length) await this.validateParents(dto.parentIds);

    return this.prisma.child.update({
      where: { id },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
        gender: dto.gender,
        groupId: dto.groupId,
        parents: dto.parentIds
          ? { set: dto.parentIds.map((id) => ({ id })) }
          : undefined,
      },
      include: {
        group: true,
        parents: { omit: { password: true, refreshToken: true } },
        subscriptions: { include: { subscriptionType: true }, orderBy: { createdAt: 'desc' } },
      },
    });
  }

  async delete(id: string) {
    const child = await this.prisma.child.findUnique({ where: { id } });
    if (!child) throw new NotFoundException('Child not found');
    await this.prisma.child.delete({ where: { id } });
    return { message: 'Child deleted' };
  }
}
