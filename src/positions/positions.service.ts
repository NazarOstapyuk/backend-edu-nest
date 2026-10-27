import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { baseScope, holdsAll, toPermissionMap } from '../access/access-calc';
import { OUTSIDE_SCOPE } from '../access/scope';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionItemDto } from '../users/dto/update-access.dto';
import { CreatePositionDto } from './dto/create-position.dto';
import { UpdatePositionDto } from './dto/update-position.dto';
import { positionSelect } from './position-select';

const POSITION_FIELDS = ['name', 'teaching', 'permissions'] as const;

const viewSelect = {
  select: {
    ...positionSelect.select,
    _count: { select: { users: true } },
  },
} satisfies Prisma.PositionDefaultArgs;

type LoadedPosition = Prisma.PositionGetPayload<typeof viewSelect>;

const toView = (p: LoadedPosition) => ({
  id: p.id,
  name: p.name,
  teaching: p.teaching,
  permissions: p.permissions.map((x) => ({ area: x.area, level: x.level })),
  userCount: p._count.users,
});

const positionAudit = (p: {
  name: string;
  teaching: boolean;
  permissions: { area: string; level: string }[];
}) => ({
  name: p.name,
  teaching: p.teaching,
  permissions: p.permissions.map((x) => `${x.area}:${x.level}`).sort(),
});

@Injectable()
export class PositionsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private assertCanWrite(
    actor: AuthenticatedUser,
    ...sets: { area: string; level: string }[][]
  ) {
    if (baseScope(actor) !== null) throw new ForbiddenException(OUTSIDE_SCOPE);
    for (const set of sets) {
      if (
        !holdsAll(
          actor,
          toPermissionMap(set as Parameters<typeof toPermissionMap>[0]),
        )
      )
        throw new ForbiddenException('Cannot grant more than you have');
    }
  }

  private assertNoDuplicates(items: PermissionItemDto[]) {
    if (new Set(items.map((i) => i.area)).size !== items.length)
      throw new BadRequestException('Duplicate permission');
  }

  private async assertNameFree(
    db: Pick<PrismaService, 'position'>,
    name: string,
    exceptId?: string,
  ) {
    const existing = await db.position.findFirst({
      where: { name, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (existing) throw new ConflictException('Position name already taken');
  }

  private async writeUnique<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('Position name already taken');
      throw error;
    }
  }

  async list() {
    const rows = await this.prisma.position.findMany({
      ...viewSelect,
      orderBy: { name: 'asc' },
    });
    return rows.map(toView);
  }

  async create(dto: CreatePositionDto, actor: AuthenticatedUser) {
    this.assertNoDuplicates(dto.permissions);
    this.assertCanWrite(actor, dto.permissions);
    return this.writeUnique(() =>
      this.prisma.$transaction(async (tx) => {
        await this.assertNameFree(tx, dto.name);
        const created = await tx.position.create({
          data: {
            name: dto.name,
            teaching: dto.teaching,
            permissions: {
              create: dto.permissions.map((p) => ({
                area: p.area,
                level: p.level,
              })),
            },
          },
          ...viewSelect,
        });
        await this.audit.recordChange(tx, {
          actorId: actor.id,
          entityType: 'positions',
          entityId: created.id,
          action: AuditAction.create,
          before: null,
          after: positionAudit(created),
          fields: POSITION_FIELDS,
        });
        return toView(created);
      }),
    );
  }

  async update(id: string, dto: UpdatePositionDto, actor: AuthenticatedUser) {
    if (dto.permissions) this.assertNoDuplicates(dto.permissions);
    return this.writeUnique(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Position" WHERE id = ${id} FOR UPDATE`;
        const current = await tx.position.findUnique({
          where: { id },
          ...viewSelect,
        });
        if (!current) throw new NotFoundException('Position not found');
        this.assertCanWrite(
          actor,
          current.permissions,
          ...(dto.permissions ? [dto.permissions] : []),
        );
        if (actor.positionId === id)
          throw new ForbiddenException('Cannot change own access');
        if (dto.name !== undefined && dto.name !== current.name)
          await this.assertNameFree(tx, dto.name, id);
        if (dto.teaching !== undefined && dto.teaching !== current.teaching) {
          const users = await tx.user.count({ where: { positionId: id } });
          if (users > 0)
            throw new BadRequestException('Position type cannot change');
        }
        if (dto.permissions) {
          await tx.positionPermission.deleteMany({ where: { positionId: id } });
          await tx.positionPermission.createMany({
            data: dto.permissions.map((p) => ({
              positionId: id,
              area: p.area,
              level: p.level,
            })),
          });
        }
        const updated = await tx.position.update({
          where: { id },
          data: { name: dto.name, teaching: dto.teaching },
          ...viewSelect,
        });
        await this.audit.recordChange(tx, {
          actorId: actor.id,
          entityType: 'positions',
          entityId: id,
          action: AuditAction.update,
          before: positionAudit(current),
          after: positionAudit(updated),
          fields: POSITION_FIELDS,
        });
        return toView(updated);
      }),
    );
  }

  async remove(id: string, actor: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Position" WHERE id = ${id} FOR UPDATE`;
      const current = await tx.position.findUnique({
        where: { id },
        ...viewSelect,
      });
      if (!current) throw new NotFoundException('Position not found');
      this.assertCanWrite(actor, current.permissions);
      if (actor.positionId === id)
        throw new ForbiddenException('Cannot change own access');
      const users = await tx.user.count({ where: { positionId: id } });
      if (users > 0) throw new BadRequestException('Position is in use');
      await tx.position.delete({ where: { id } });
      await this.audit.recordChange(tx, {
        actorId: actor.id,
        entityType: 'positions',
        entityId: id,
        action: AuditAction.delete,
        before: positionAudit(current),
        after: null,
        fields: POSITION_FIELDS,
      });
      return { message: 'Position deleted' };
    });
  }
}
