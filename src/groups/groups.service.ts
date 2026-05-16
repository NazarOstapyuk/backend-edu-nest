import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';

@Injectable()
export class GroupsService {
  constructor(private prisma: PrismaService) {}

  private async validateTeachers(ids: string[]) {
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, role: true },
    });

    const notFound = ids.filter((id) => !users.find((u) => u.id === id));
    if (notFound.length) {
      throw new NotFoundException(`Users not found: ${notFound.join(', ')}`);
    }

    const notTeachers = users.filter((u) => u.role !== Role.teacher);
    if (notTeachers.length) {
      throw new BadRequestException(
        `Users are not teachers: ${notTeachers.map((u) => u.id).join(', ')}`,
      );
    }
  }

  async create(dto: CreateGroupDto) {
    const existing = await this.prisma.group.findUnique({
      where: { name: dto.name },
    });
    if (existing) throw new ConflictException('Group name already taken');

    if (dto.teacherIds?.length) await this.validateTeachers(dto.teacherIds);

    return this.prisma.group.create({
      data: {
        name: dto.name,
        teachers: dto.teacherIds
          ? { connect: dto.teacherIds.map((id) => ({ id })) }
          : undefined,
      },
      include: { teachers: { omit: { password: true, refreshToken: true } }, children: true },
    });
  }

  async findAll() {
    return this.prisma.group.findMany({
      include: { teachers: { omit: { password: true, refreshToken: true } }, children: true },
    });
  }

  async update(id: string, dto: UpdateGroupDto) {
    const group = await this.prisma.group.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('Group not found');

    if (dto.name && dto.name !== group.name) {
      const existing = await this.prisma.group.findUnique({
        where: { name: dto.name },
      });
      if (existing) throw new ConflictException('Group name already taken');
    }

    if (dto.teacherIds?.length) await this.validateTeachers(dto.teacherIds);

    return this.prisma.group.update({
      where: { id },
      data: {
        name: dto.name,
        teachers: dto.teacherIds
          ? { set: dto.teacherIds.map((id) => ({ id })) }
          : undefined,
      },
      include: { teachers: { omit: { password: true, refreshToken: true } }, children: true },
    });
  }

  async delete(id: string) {
    const group = await this.prisma.group.findUnique({ where: { id } });
    if (!group) throw new NotFoundException('Group not found');

    await this.prisma.group.delete({ where: { id } });
    return { message: 'Group deleted' };
  }
}
