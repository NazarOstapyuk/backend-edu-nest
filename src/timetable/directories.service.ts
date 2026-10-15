import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { isTimetableManager } from './roles';
import { CreateNamedDto, UpdateNamedDto } from './dto/named.dto';

@Injectable()
export class DirectoriesService {
  constructor(private prisma: PrismaService) {}

  listSubjects(user: AuthenticatedUser) {
    return this.prisma.subject.findMany({
      where: isTimetableManager(user) ? {} : { active: true },
      orderBy: { name: 'asc' },
    });
  }

  async createSubject(dto: CreateNamedDto) {
    const name = dto.name.trim();
    if (await this.prisma.subject.findUnique({ where: { name } }))
      throw new ConflictException('Subject already exists');
    return this.prisma.subject.create({ data: { name } });
  }

  async updateSubject(id: string, dto: UpdateNamedDto) {
    const subject = await this.prisma.subject.findUnique({ where: { id } });
    if (!subject) throw new NotFoundException('Subject not found');
    const name = dto.name?.trim();
    if (
      name &&
      name !== subject.name &&
      (await this.prisma.subject.findUnique({ where: { name } }))
    )
      throw new ConflictException('Subject already exists');
    return this.prisma.subject.update({
      where: { id },
      data: { name, active: dto.active },
    });
  }

  listRooms(user: AuthenticatedUser) {
    return this.prisma.room.findMany({
      where: isTimetableManager(user) ? {} : { active: true },
      orderBy: { name: 'asc' },
    });
  }

  async createRoom(dto: CreateNamedDto) {
    const name = dto.name.trim();
    if (await this.prisma.room.findUnique({ where: { name } }))
      throw new ConflictException('Room already exists');
    return this.prisma.room.create({ data: { name } });
  }

  async updateRoom(id: string, dto: UpdateNamedDto) {
    const room = await this.prisma.room.findUnique({ where: { id } });
    if (!room) throw new NotFoundException('Room not found');
    const name = dto.name?.trim();
    if (
      name &&
      name !== room.name &&
      (await this.prisma.room.findUnique({ where: { name } }))
    )
      throw new ConflictException('Room already exists');
    return this.prisma.room.update({
      where: { id },
      data: { name, active: dto.active },
    });
  }
}
