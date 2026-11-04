import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { kyivToday } from '../tariffs/dates';
import { assertNewGroupFields, newGroupData } from './class-group-checks';
import { directionInclude, toDirectionView } from './class-views';
import { CreateDirectionDto } from './dto/create-direction.dto';
import { UpdateDirectionDto } from './dto/update-direction.dto';

@Injectable()
export class DirectionsService {
  constructor(private prisma: PrismaService) {}

  async list(today: Date = kyivToday()) {
    const directions = await this.prisma.direction.findMany({
      include: directionInclude,
      orderBy: { name: 'asc' },
    });
    return directions.map((d) => toDirectionView(d, today));
  }

  private async get(id: string) {
    const direction = await this.prisma.direction.findUnique({ where: { id } });
    if (!direction) throw new NotFoundException('Direction not found');
    return direction;
  }

  private async assertNameFree(name: string) {
    const existing = await this.prisma.direction.findUnique({
      where: { name },
    });
    if (existing)
      throw new BadRequestException('Direction with this name already exists');
  }

  async create(dto: CreateDirectionDto) {
    await this.assertNameFree(dto.name);
    const group = dto.group;
    if (!group) {
      await this.prisma.direction.create({
        data: { name: dto.name, missedRule: dto.missedRule },
      });
      return this.list();
    }
    await this.prisma.$transaction(async (tx) => {
      await assertNewGroupFields(tx, group);
      const direction = await tx.direction.create({
        data: { name: dto.name, missedRule: dto.missedRule },
      });
      await tx.classGroup.create({
        data: newGroupData(direction.id, group.name ?? dto.name, group),
      });
    });
    return this.list();
  }

  async update(id: string, dto: UpdateDirectionDto) {
    const direction = await this.get(id);
    if (dto.name !== undefined && dto.name !== direction.name)
      await this.assertNameFree(dto.name);
    await this.prisma.direction.update({
      where: { id },
      data: {
        name: dto.name,
        missedRule: dto.missedRule,
        isActive: dto.isActive,
      },
    });
    return this.list();
  }

  async delete(id: string) {
    await this.get(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Direction" WHERE id = ${id} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "ClassGroup" WHERE "directionId" = ${id} ORDER BY id FOR UPDATE`;
      const inGroups = { classGroup: { directionId: id } };
      const [lessons, rates, packages] = await Promise.all([
        tx.lesson.count({ where: inGroups }),
        tx.salaryRate.count({ where: inGroups }),
        tx.package.count({ where: { directionId: id } }),
      ]);
      if (lessons + rates + packages > 0)
        throw new BadRequestException('Cannot delete: direction is in use');
      await tx.classGroupMember.deleteMany({ where: inGroups });
      await tx.classGroup.deleteMany({ where: { directionId: id } });
      await tx.direction.delete({ where: { id } });
    });
    return this.list();
  }
}
