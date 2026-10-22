import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AccessScope, GroupKind, Role } from '@prisma/client';
import { childFilterWhere, reportPeriod, resolveFilter } from './report-query';

const user = (accessScope: AccessScope, role: Role = Role.admin) => ({
  id: 'u1',
  role,
  login: 'a',
  mustChangePassword: false,
  accessScope,
  institutionIds: accessScope === AccessScope.institutions ? ['inst-k'] : [],
  scopeInstitutionIds:
    accessScope === AccessScope.institutions && role !== Role.root
      ? ['inst-k']
      : null,
  permissions: {},
});

describe('reportPeriod', () => {
  it('parses an inclusive period', () => {
    const p = reportPeriod('2026-10-01', '2026-10-31');
    expect(p.from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(p.to.toISOString()).toBe('2026-10-31T00:00:00.000Z');
  });
  it('rejects a missing or invalid date', () => {
    expect(() => reportPeriod(undefined, '2026-10-01')).toThrow('Invalid date');
    expect(() => reportPeriod('2026-13-01', '2026-10-01')).toThrow(
      BadRequestException,
    );
  });
  it('rejects to before from', () => {
    expect(() => reportPeriod('2026-10-02', '2026-10-01')).toThrow(
      'Invalid period',
    );
  });
  it('allows 366 days and rejects 367', () => {
    expect(() => reportPeriod('2026-01-01', '2027-01-01')).not.toThrow();
    expect(() => reportPeriod('2026-01-01', '2027-01-02')).toThrow(
      'Period too long',
    );
  });
});

describe('resolveFilter', () => {
  const db = {
    group: { findUnique: jest.fn() },
    institution: { findUnique: jest.fn() },
  };
  beforeEach(() => jest.clearAllMocks());

  it('uses the scope institutions when no kind is given', async () => {
    await expect(
      resolveFilter(db, user(AccessScope.institutions), {}),
    ).resolves.toEqual({
      kind: null,
      institutionIds: ['inst-k'],
      groupId: null,
    });
  });
  it('intersects a kind with the scope', async () => {
    await expect(
      resolveFilter(db, user(AccessScope.institutions), {
        kind: GroupKind.school_class,
      }),
    ).resolves.toEqual({
      kind: GroupKind.school_class,
      institutionIds: ['inst-k'],
      groupId: null,
    });
  });
  it('rejects a group outside the scope', async () => {
    db.group.findUnique.mockResolvedValue({
      id: 'g1',
      institutionId: 'inst-s',
    });
    await expect(
      resolveFilter(db, user(AccessScope.institutions), { groupId: 'g1' }),
    ).rejects.toThrow(new ForbiddenException('Outside access scope'));
  });
  it('narrows to one institution inside the scope', async () => {
    db.institution.findUnique.mockResolvedValue({ id: 'inst-k' });
    await expect(
      resolveFilter(db, user(AccessScope.institutions), {
        institutionId: 'inst-k',
        kind: GroupKind.kindergarten,
      }),
    ).resolves.toEqual({
      kind: GroupKind.kindergarten,
      institutionIds: ['inst-k'],
      groupId: null,
    });
  });
  it('rejects an institution outside the scope', async () => {
    db.institution.findUnique.mockResolvedValue({ id: 'inst-s' });
    await expect(
      resolveFilter(db, user(AccessScope.institutions), {
        institutionId: 'inst-s',
      }),
    ).rejects.toThrow(new ForbiddenException('Outside access scope'));
  });
  it('rejects an unknown institution', async () => {
    db.institution.findUnique.mockResolvedValue(null);
    await expect(
      resolveFilter(db, user(AccessScope.all), { institutionId: 'x' }),
    ).rejects.toThrow(new NotFoundException('Institution not found'));
  });
  it('rejects a group of another institution than the filter', async () => {
    db.institution.findUnique.mockResolvedValue({ id: 'inst-k' });
    db.group.findUnique.mockResolvedValue({
      id: 'g1',
      institutionId: 'inst-s',
    });
    await expect(
      resolveFilter(db, user(AccessScope.all), {
        institutionId: 'inst-k',
        groupId: 'g1',
      }),
    ).rejects.toThrow(new ForbiddenException('Outside access scope'));
  });
  it('rejects an unknown group', async () => {
    db.group.findUnique.mockResolvedValue(null);
    await expect(
      resolveFilter(db, user(AccessScope.all), { groupId: 'g9' }),
    ).rejects.toThrow(NotFoundException);
  });
  it('lets root and scope all pick any kind', async () => {
    await expect(
      resolveFilter(db, user(AccessScope.institutions, Role.root), {
        kind: GroupKind.school_class,
      }),
    ).resolves.toEqual({
      kind: GroupKind.school_class,
      institutionIds: null,
      groupId: null,
    });
  });
});

describe('childFilterWhere', () => {
  it('combines kind, institutions, group and child', () => {
    expect(
      childFilterWhere(
        {
          kind: GroupKind.kindergarten,
          institutionIds: ['inst-k'],
          groupId: 'g1',
        },
        'c1',
      ),
    ).toEqual({
      group: {
        kind: GroupKind.kindergarten,
        institutionId: { in: ['inst-k'] },
      },
      groupId: 'g1',
      id: 'c1',
    });
    expect(
      childFilterWhere({ kind: null, institutionIds: null, groupId: null }),
    ).toEqual({});
  });
});
