import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { positionSelect } from '../../positions/position-select';
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

  const request = (header?: string | string[], ignore = false) =>
    ({
      headers: header === undefined ? {} : { 'x-institution-id': header },
      ...(ignore ? { ignoreInstitutionHeader: true } : {}),
    }) as unknown as Request;

  const dbUser = (overrides: Record<string, unknown> = {}) => ({
    id: 'u1',
    role: 'admin',
    login: 'admin',
    isActive: true,
    mustChangePassword: false,
    accessScope: 'institutions',
    positionId: 'pos1',
    position: {
      id: 'pos1',
      name: 'Accountant',
      teaching: false,
      permissions: [{ area: 'finance', level: 'view' }],
    },
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
        position: positionSelect,
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

  it('reads permissions from the position', async () => {
    prisma.user.findUnique.mockResolvedValue(
      dbUser({
        position: {
          id: 'pos1',
          name: 'Boss',
          teaching: false,
          permissions: [{ area: 'finance', level: 'edit' }],
        },
      }),
    );

    const user = await strategy.validate(request(), {
      sub: 'u1',
      role: 'admin',
    });

    expect(user.permissions).toEqual({ finance: 'edit' });
    expect(user.positionId).toBe('pos1');
  });

  it('gives no permissions without a position', async () => {
    prisma.user.findUnique.mockResolvedValue(
      dbUser({ positionId: null, position: null }),
    );

    const user = await strategy.validate(request(), {
      sub: 'u1',
      role: 'admin',
    });

    expect(user.permissions).toEqual({});
    expect(user.positionId).toBeNull();
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

  it('ignores an outside or unknown header when the request is flagged', async () => {
    prisma.user.findUnique.mockResolvedValue(dbUser());

    const outside = await strategy.validate(request('inst-x', true), {
      sub: 'u1',
      role: 'admin',
    });
    const unknown = await strategy.validate(request('missing', true), {
      sub: 'u1',
      role: 'admin',
    });

    expect(outside.scopeInstitutionIds).toEqual(['inst-k', 'inst-s']);
    expect(unknown.scopeInstitutionIds).toEqual(['inst-k', 'inst-s']);
    expect(prisma.institution.findUnique).not.toHaveBeenCalled();
  });

  it('uses the full scope for a flagged root request', async () => {
    prisma.user.findUnique.mockResolvedValue(
      dbUser({ role: 'root', accessScope: 'all', institutions: [] }),
    );

    const user = await strategy.validate(request('inst-k', true), {
      sub: 'u1',
      role: 'root',
    });

    expect(user.scopeInstitutionIds).toBeNull();
  });

  it('rejects missing or inactive users', async () => {
    prisma.user.findUnique.mockResolvedValue(dbUser({ isActive: false }));

    await expect(
      strategy.validate(request(), { sub: 'u1', role: 'admin' }),
    ).rejects.toThrow('Unauthorized');
  });
});
