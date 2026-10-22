import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    institution: { findUnique: jest.fn() },
  };
  const config = { get: jest.fn().mockReturnValue('secret') };
  const strategy = new JwtStrategy(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
  );

  const request = (header?: string | string[]) =>
    ({
      headers: header === undefined ? {} : { 'x-institution-id': header },
    }) as unknown as Request;

  const dbUser = (overrides: Record<string, unknown> = {}) => ({
    id: 'u1',
    role: 'admin',
    login: 'admin',
    isActive: true,
    mustChangePassword: false,
    accessScope: 'institutions',
    permissions: [{ area: 'finance', level: 'view' }],
    institutions: [{ institutionId: 'inst-k' }, { institutionId: 'inst-s' }],
    ...overrides,
  });

  const institution = (id: string, isActive = true) => ({
    id,
    type: 'kindergarten',
    isActive,
    name: 'Садок',
  });

  beforeEach(() => jest.clearAllMocks());

  it('loads granted institutions', async () => {
    prisma.user.findUnique.mockResolvedValue(dbUser());

    await strategy.validate(request(), { sub: 'u1', role: 'admin' });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      include: {
        permissions: { select: { area: true, level: true } },
        institutions: { select: { institutionId: true } },
      },
    });
  });

  it('uses granted ids without a header', async () => {
    prisma.user.findUnique.mockResolvedValue(dbUser());

    const user = await strategy.validate(request(), {
      sub: 'u1',
      role: 'admin',
    });

    expect(user.institutionIds).toEqual(['inst-k', 'inst-s']);
    expect(user.scopeInstitutionIds).toEqual(['inst-k', 'inst-s']);
    expect(user.permissions).toEqual({ finance: 'view' });
    expect(prisma.institution.findUnique).not.toHaveBeenCalled();
  });

  it('treats an empty or repeated header as absent', async () => {
    prisma.user.findUnique.mockResolvedValue(dbUser());

    const empty = await strategy.validate(request(''), {
      sub: 'u1',
      role: 'admin',
    });
    const repeated = await strategy.validate(request(['inst-k', 'inst-s']), {
      sub: 'u1',
      role: 'admin',
    });

    expect(empty.scopeInstitutionIds).toEqual(['inst-k', 'inst-s']);
    expect(repeated.scopeInstitutionIds).toEqual(['inst-k', 'inst-s']);
    expect(prisma.institution.findUnique).not.toHaveBeenCalled();
  });

  it('narrows to the selected institution inside the scope', async () => {
    prisma.user.findUnique.mockResolvedValue(dbUser());
    prisma.institution.findUnique.mockResolvedValue(institution('inst-s'));

    const user = await strategy.validate(request('inst-s'), {
      sub: 'u1',
      role: 'admin',
    });

    expect(user.scopeInstitutionIds).toEqual(['inst-s']);
  });

  it('rejects an unknown institution', async () => {
    prisma.user.findUnique.mockResolvedValue(dbUser());
    prisma.institution.findUnique.mockResolvedValue(null);

    await expect(
      strategy.validate(request('missing'), { sub: 'u1', role: 'admin' }),
    ).rejects.toThrow(new NotFoundException('Institution not found'));
  });

  it('rejects an institution outside the scope', async () => {
    prisma.user.findUnique.mockResolvedValue(dbUser());
    prisma.institution.findUnique.mockResolvedValue(institution('inst-x'));

    await expect(
      strategy.validate(request('inst-x'), { sub: 'u1', role: 'admin' }),
    ).rejects.toThrow(new ForbiddenException('Outside access scope'));
  });

  it('lets root select an inactive institution', async () => {
    prisma.user.findUnique.mockResolvedValue(
      dbUser({ role: 'root', accessScope: 'all', institutions: [] }),
    );
    prisma.institution.findUnique.mockResolvedValue(
      institution('inst-old', false),
    );

    const user = await strategy.validate(request('inst-old'), {
      sub: 'u1',
      role: 'root',
    });

    expect(user.scopeInstitutionIds).toEqual(['inst-old']);
  });

  it('ignores the header for parents', async () => {
    prisma.user.findUnique.mockResolvedValue(
      dbUser({ role: 'parent', accessScope: 'all', institutions: [] }),
    );

    const user = await strategy.validate(request('inst-k'), {
      sub: 'u1',
      role: 'parent',
    });

    expect(user.scopeInstitutionIds).toBeNull();
    expect(prisma.institution.findUnique).not.toHaveBeenCalled();
  });

  it('rejects missing or inactive users', async () => {
    prisma.user.findUnique.mockResolvedValue(dbUser({ isActive: false }));

    await expect(
      strategy.validate(request(), { sub: 'u1', role: 'admin' }),
    ).rejects.toThrow('Unauthorized');
  });
});
