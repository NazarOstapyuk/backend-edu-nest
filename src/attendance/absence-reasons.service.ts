import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { CreateAbsenceReasonDto } from './dto/create-absence-reason.dto';
import { UpdateAbsenceReasonDto } from './dto/update-absence-reason.dto';

@Injectable()
export class AbsenceReasonsService {
  constructor(private prisma: PrismaService) {}

  list(user: AuthenticatedUser) {
    const admin = user.role === Role.root || user.role === Role.admin;
    return this.prisma.absenceReason.findMany({
      where: admin ? {} : { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async create(dto: CreateAbsenceReasonDto) {
    const name = dto.name.trim();
    await this.assertNameFree(name);
    return this.prisma.absenceReason.create({
      data: {
        name,
        excused: dto.excused,
        requiresDocument: dto.requiresDocument ?? false,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async update(id: string, dto: UpdateAbsenceReasonDto) {
    const reason = await this.prisma.absenceReason.findUnique({
      where: { id },
    });
    if (!reason) throw new NotFoundException('Absence reason not found');
    const name = dto.name?.trim();
    if (name && name !== reason.name) await this.assertNameFree(name);
    return this.prisma.absenceReason.update({
      where: { id },
      data: {
        name,
        excused: dto.excused,
        requiresDocument: dto.requiresDocument,
        active: dto.active,
        sortOrder: dto.sortOrder,
      },
    });
  }

  private async assertNameFree(name: string) {
    const existing = await this.prisma.absenceReason.findUnique({
      where: { name },
    });
    if (existing) throw new ConflictException('Absence reason already exists');
  }
}
