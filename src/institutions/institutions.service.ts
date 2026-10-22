import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AccessScope, AuditAction, Role } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInstitutionDto } from './dto/create-institution.dto';
import { UpdateInstitutionDto } from './dto/update-institution.dto';
import { findInstitution } from './institution-checks';

const INSTITUTION_FIELDS = ['name', 'type', 'isActive'] as const;

const SELECT = { id: true, name: true, type: true, isActive: true } as const;

const hasFullScope = (user: AuthenticatedUser) =>
  user.role === Role.root || user.accessScope === AccessScope.all;

@Injectable()
export class InstitutionsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private assertFullScope(user: AuthenticatedUser) {
    if (!hasFullScope(user)) {
      throw new ForbiddenException('Outside access scope');
    }
  }

  async list(user: AuthenticatedUser) {
    if (user.role === Role.parent) {
      throw new ForbiddenException('Insufficient permissions');
    }
    const orderBy = [{ isActive: 'desc' as const }, { name: 'asc' as const }];
    if (hasFullScope(user)) {
      return this.prisma.institution.findMany({ select: SELECT, orderBy });
    }
    const grants = await this.prisma.userInstitution.findMany({
      where: { userId: user.id },
      select: { institutionId: true },
    });
    return this.prisma.institution.findMany({
      where: { id: { in: grants.map((g) => g.institutionId) } },
      select: SELECT,
      orderBy,
    });
  }

  async create(dto: CreateInstitutionDto, user: AuthenticatedUser) {
    this.assertFullScope(user);
    const existing = await this.prisma.institution.findUnique({
      where: { name: dto.name },
    });
    if (existing) {
      throw new ConflictException('Institution name already taken');
    }
    const created = await this.prisma.institution.create({
      data: { name: dto.name, type: dto.type },
      select: SELECT,
    });
    await this.audit.recordChange(this.prisma, {
      actorId: user.id,
      entityType: 'institutions',
      entityId: created.id,
      action: AuditAction.create,
      before: null,
      after: created,
      fields: INSTITUTION_FIELDS,
    });
    return created;
  }

  async update(id: string, dto: UpdateInstitutionDto, user: AuthenticatedUser) {
    this.assertFullScope(user);
    const current = await findInstitution(this.prisma, id);
    if (dto.name && dto.name !== current.name) {
      const existing = await this.prisma.institution.findUnique({
        where: { name: dto.name },
      });
      if (existing) {
        throw new ConflictException('Institution name already taken');
      }
    }
    if (dto.type && dto.type !== current.type) {
      const groups = await this.prisma.group.count({
        where: { institutionId: id },
      });
      if (groups > 0) {
        throw new BadRequestException('Institution type cannot change');
      }
    }
    const updated = await this.prisma.institution.update({
      where: { id },
      data: { name: dto.name, type: dto.type, isActive: dto.isActive },
      select: SELECT,
    });
    await this.audit.recordChange(this.prisma, {
      actorId: user.id,
      entityType: 'institutions',
      entityId: id,
      action: AuditAction.update,
      before: {
        name: current.name,
        type: current.type,
        isActive: current.isActive,
      },
      after: updated,
      fields: INSTITUTION_FIELDS,
    });
    return updated;
  }
}
