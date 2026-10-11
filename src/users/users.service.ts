// src/users/users.service.ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateUserDto, creatorRole: Role) {
    if (creatorRole === Role.admin && dto.role === Role.root) {
      throw new ForbiddenException('Forbidden');
    }

    const existing = await this.prisma.user.findUnique({
      where: { login: dto.login },
    });
    if (existing) throw new ConflictException('Login already taken');

    const password = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        login: dto.login,
        password,
        role: dto.role,
        firstName: dto.firstName,
        lastName: dto.lastName,
      },
    });

    const { password: _p, refreshToken: _r, ...result } = user;
    return result;
  }

  async findAll() {
    return this.prisma.user.findMany({
      where: { role: { not: Role.root } },
      select: {
        id: true,
        login: true,
        role: true,
        firstName: true,
        lastName: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async delete(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === Role.root)
      throw new ForbiddenException('Cannot delete root user');

    const author = { OR: [{ createdById: id }, { voidedById: id }] };
    const counts = await Promise.all([
      this.prisma.charge.count({ where: author }),
      this.prisma.payment.count({ where: author }),
      this.prisma.allocation.count({ where: author }),
      this.prisma.tariffPrice.count({ where: { createdById: id } }),
      this.prisma.enrollment.count({ where: { createdById: id } }),
      this.prisma.enrollmentAdjustment.count({ where: author }),
      this.prisma.adaptationVisit.count({ where: author }),
      this.prisma.classGroupMember.count({ where: { createdById: id } }),
      this.prisma.package.count({
        where: {
          OR: [{ createdById: id }, { voidedById: id }, { reconciledById: id }],
        },
      }),
      this.prisma.packageExtension.count({ where: { createdById: id } }),
      this.prisma.lesson.count({ where: { conductedById: id } }),
      this.prisma.lessonAttendance.count({
        where: { OR: [{ markedById: id }, { voidedById: id }] },
      }),
      this.prisma.sessionUsage.count({ where: { voidedById: id } }),
      this.prisma.classGroup.count({ where: { teachers: { some: { id } } } }),
    ]);
    if (counts.some((count) => count > 0)) {
      throw new BadRequestException(
        'Cannot delete: user has financial records, deactivate instead',
      );
    }

    await this.prisma.user.delete({ where: { id } });
    return { message: 'User deleted' };
  }

  async update(id: string, dto: UpdateUserDto, updaterRole: Role) {
    if (updaterRole === Role.admin && dto.role === Role.root) {
      throw new ForbiddenException('Forbidden');
    }

    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    if (dto.login && dto.login !== user.login) {
      const existing = await this.prisma.user.findUnique({
        where: { login: dto.login },
      });
      if (existing) throw new ConflictException('Login already taken');
    }

    const data: {
      login?: string;
      password?: string;
      role?: Role;
      firstName?: string;
      lastName?: string;
      isActive?: boolean;
    } = {};
    if (dto.login !== undefined) data.login = dto.login;
    if (dto.password) data.password = await bcrypt.hash(dto.password, 10);
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const updated = await this.prisma.user.update({ where: { id }, data });
    const { password: _p, refreshToken: _r, ...result } = updated;
    return result;
  }
}
