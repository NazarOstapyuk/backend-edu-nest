import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { InstitutionType } from '@prisma/client';

type InstitutionRow = {
  id: string;
  type: InstitutionType;
  isActive: boolean;
  name: string;
};

type InstitutionDb = {
  institution: {
    findUnique: (args: {
      where: { id: string };
      select: {
        id: true;
        type: true;
        isActive: true;
        name: true;
      };
    }) => Promise<InstitutionRow | null>;
  };
};

export async function findInstitution(
  db: InstitutionDb,
  id: string,
  opts?: { active?: boolean },
): Promise<InstitutionRow> {
  const institution = await db.institution.findUnique({
    where: { id },
    select: { id: true, type: true, isActive: true, name: true },
  });
  if (!institution) throw new NotFoundException('Institution not found');
  if (opts?.active && !institution.isActive) {
    throw new BadRequestException('Institution is inactive');
  }
  return institution;
}
