import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GroupKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSubgroupDto, UpdateSubgroupDto } from './dto/subgroup.dto';

const withMembers = {
  members: {
    select: {
      child: { select: { id: true, firstName: true, lastName: true } },
    },
  },
} as const;

type SubgroupRow = {
  id: string;
  groupId: string;
  name: string;
  active: boolean;
  members: { child: { id: string; firstName: string; lastName: string } }[];
};

const view = (row: SubgroupRow) => ({
  id: row.id,
  groupId: row.groupId,
  name: row.name,
  active: row.active,
  children: row.members.map((m) => m.child),
});

@Injectable()
export class SubgroupsService {
  constructor(private prisma: PrismaService) {}

  private async requireClass(groupId: string) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { id: true, kind: true },
    });
    if (!group) throw new NotFoundException('Group not found');
    if (group.kind !== GroupKind.school_class)
      throw new BadRequestException('Not a school class');
    return group;
  }

  private async assertChildren(groupId: string, childIds: string[]) {
    const unique = [...new Set(childIds)];
    if (!unique.length) return unique;
    const count = await this.prisma.child.count({
      where: { id: { in: unique }, groupId },
    });
    if (count !== unique.length)
      throw new BadRequestException('Child is not in this class');
    return unique;
  }

  async list(groupId: string) {
    await this.requireClass(groupId);
    const rows = await this.prisma.subgroup.findMany({
      where: { groupId },
      include: withMembers,
      orderBy: { name: 'asc' },
    });
    return rows.map(view);
  }

  async create(groupId: string, dto: CreateSubgroupDto) {
    await this.requireClass(groupId);
    const name = dto.name.trim();
    const childIds = await this.assertChildren(groupId, dto.childIds);
    if (
      await this.prisma.subgroup.findUnique({
        where: { groupId_name: { groupId, name } },
      })
    )
      throw new ConflictException('Subgroup already exists');
    const row = await this.prisma.subgroup.create({
      data: {
        groupId,
        name,
        members: { create: childIds.map((childId) => ({ childId })) },
      },
      include: withMembers,
    });
    return view(row);
  }

  async update(id: string, dto: UpdateSubgroupDto) {
    const subgroup = await this.prisma.subgroup.findUnique({ where: { id } });
    if (!subgroup) throw new NotFoundException('Subgroup not found');
    const name = dto.name?.trim();
    if (
      name &&
      name !== subgroup.name &&
      (await this.prisma.subgroup.findUnique({
        where: { groupId_name: { groupId: subgroup.groupId, name } },
      }))
    )
      throw new ConflictException('Subgroup already exists');
    const childIds = dto.childIds
      ? await this.assertChildren(subgroup.groupId, dto.childIds)
      : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.subgroup.update({
        where: { id },
        data: { name, active: dto.active },
      });
      if (childIds) {
        await tx.subgroupMember.deleteMany({ where: { subgroupId: id } });
        await tx.subgroupMember.createMany({
          data: childIds.map((childId) => ({ subgroupId: id, childId })),
        });
      }
    });
    const row = await this.prisma.subgroup.findUnique({
      where: { id },
      include: withMembers,
    });
    return row && view(row);
  }
}
