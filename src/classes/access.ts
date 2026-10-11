import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { isoDay, toDay } from '../tariffs/dates';

export function assertGroupAccess(
  group: { teachers: { id: string }[] },
  user: AuthenticatedUser,
) {
  if (
    user.role === Role.teacher &&
    !group.teachers.some((t) => t.id === user.id)
  ) {
    throw new ForbiddenException('Not your class group');
  }
}

export function parseDay(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new BadRequestException('Invalid date');
  const day = toDay(value);
  if (Number.isNaN(day.getTime()) || isoDay(day) !== value)
    throw new BadRequestException('Invalid date');
  return day;
}
