import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InstitutionType } from '@prisma/client';
import { findInstitution } from './institution-checks';

const dbWith = (row: unknown) => ({
  institution: { findUnique: jest.fn().mockResolvedValue(row) },
});

const row = {
  id: 'i1',
  type: InstitutionType.kindergarten,
  isActive: false,
  name: 'Садок',
};

describe('findInstitution', () => {
  it('throws Institution not found when missing', async () => {
    await expect(findInstitution(dbWith(null), 'i1')).rejects.toThrow(
      new NotFoundException('Institution not found'),
    );
  });

  it('throws Institution is inactive with active: true', async () => {
    await expect(
      findInstitution(dbWith(row), 'i1', { active: true }),
    ).rejects.toThrow(new BadRequestException('Institution is inactive'));
  });

  it('returns an inactive row without the option', async () => {
    await expect(findInstitution(dbWith(row), 'i1')).resolves.toEqual(row);
  });
});
