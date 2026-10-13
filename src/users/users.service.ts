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

    if (dto.role === Role.parent && !dto.phone) {
      throw new BadRequestException('Phone is required for parents');
    }

    const password = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        login: dto.login,
        password,
        role: dto.role,
        firstName: dto.firstName,
        lastName: dto.lastName,
        middleName: dto.middleName ?? null,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        mustChangePassword: dto.role === Role.parent,
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
        middleName: true,
        phone: true,
        email: true,
        mustChangePassword: true,
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
      this.prisma.dailyAttendance.count({
        where: { OR: [{ markedById: id }, { voidedById: id }] },
      }),
      this.prisma.calendarDay.count({ where: author }),
      this.prisma.absenceNotice.count({
        where: { OR: [{ createdById: id }, { decidedById: id }] },
      }),
      this.prisma.timetable.count({ where: { createdById: id } }),
      this.prisma.timetableEntry.count({ where: { teacherId: id } }),
      this.prisma.lessonChange.count({
        where: {
          OR: [{ createdById: id }, { voidedById: id }, { teacherId: id }],
        },
      }),
      this.prisma.schoolLesson.count({
        where: { OR: [{ teacherId: id }, { conductedById: id }] },
      }),
      this.prisma.lessonMark.count({
        where: { OR: [{ markedById: id }, { voidedById: id }] },
      }),
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

    const nextRole = dto.role ?? user.role;
    const clearsPhone = dto.phone === null;
    const becomesParent = dto.role === Role.parent && user.role !== Role.parent;
    const nextPhone = dto.phone !== undefined ? dto.phone : user.phone;
    if (
      nextRole === Role.parent &&
      !nextPhone &&
      (clearsPhone || becomesParent)
    ) {
      throw new BadRequestException('Phone is required for parents');
    }

    const data: {
      login?: string;
      password?: string;
      role?: Role;
      firstName?: string;
      lastName?: string;
      isActive?: boolean;
      middleName?: string | null;
      phone?: string | null;
      email?: string | null;
      mustChangePassword?: boolean;
      refreshToken?: null;
    } = {};
    if (dto.login !== undefined) data.login = dto.login;
    if (dto.password) {
      data.password = await bcrypt.hash(dto.password, 10);
      data.mustChangePassword = true;
      data.refreshToken = null;
    }
    if (dto.middleName !== undefined) data.middleName = dto.middleName;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const updated = await this.prisma.user.update({ where: { id }, data });
    const { password: _p, refreshToken: _r, ...result } = updated;
    return result;
  }
}
