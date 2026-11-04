import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ClassFormat, Prisma, Role, TariffUnit } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

export interface ClassGroupFields {
  format: ClassFormat;
  teacherIds: string[];
  singleTariffId?: string | null;
  packageTariffId?: string | null;
}

export async function assertTeachers(
  db: Db,
  ids: string[],
  currentIds: string[] = [],
) {
  if (ids.length === 0) return;
  const users = await db.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, role: true, isActive: true },
  });
  if (
    users.length !== new Set(ids).size ||
    users.some((u) => u.role !== Role.teacher)
  ) {
    throw new BadRequestException('Invalid teachers');
  }
  if (users.some((u) => !u.isActive && !currentIds.includes(u.id))) {
    throw new BadRequestException('Teacher is inactive');
  }
}

export async function assertTariff(
  db: Db,
  id: string | null | undefined,
  unit: TariffUnit,
  message: string,
  currentId: string | null = null,
) {
  if (!id) return;
  const tariff = await db.tariff.findUnique({ where: { id } });
  if (!tariff) throw new NotFoundException('Tariff not found');
  if (tariff.unit !== unit) throw new BadRequestException(message);
  if (tariff.institutionId)
    throw new BadRequestException('Tariff belongs to another institution');
  if (!tariff.isActive && id !== currentId)
    throw new BadRequestException('Tariff is not active');
}

export async function assertNewGroupFields(db: Db, dto: ClassGroupFields) {
  await assertTeachers(db, dto.teacherIds);
  await assertTariff(
    db,
    dto.singleTariffId,
    TariffUnit.session,
    'Tariff unit must be session',
  );
  await assertTariff(
    db,
    dto.packageTariffId,
    TariffUnit.package,
    'Tariff unit must be package',
  );
}

export function newGroupData(
  directionId: string,
  name: string,
  dto: ClassGroupFields,
): Prisma.ClassGroupUncheckedCreateInput {
  return {
    name,
    directionId,
    format: dto.format,
    singleTariffId: dto.singleTariffId ?? null,
    packageTariffId: dto.packageTariffId ?? null,
    teachers: { connect: dto.teacherIds.map((id) => ({ id })) },
  };
}
