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
  const db = { group: { findUnique: jest.fn() } };
  beforeEach(() => jest.clearAllMocks());

  it('uses the scope kind when no kind is given', async () => {
    await expect(
      resolveFilter(db, user(AccessScope.kindergarten), {}),
    ).resolves.toEqual({ kind: GroupKind.kindergarten, groupId: null });
  });
  it('rejects a kind outside the scope', async () => {
    await expect(
      resolveFilter(db, user(AccessScope.kindergarten), {
        kind: GroupKind.school_class,
      }),
    ).rejects.toThrow(ForbiddenException);
  });
  it('rejects a group outside the scope', async () => {
    db.group.findUnique.mockResolvedValue({
      id: 'g1',
      kind: GroupKind.school_class,
    });
    await expect(
      resolveFilter(db, user(AccessScope.kindergarten), { groupId: 'g1' }),
    ).rejects.toThrow('Outside access scope');
  });
  it('rejects an unknown group', async () => {
    db.group.findUnique.mockResolvedValue(null);
    await expect(
      resolveFilter(db, user(AccessScope.all), { groupId: 'g9' }),
    ).rejects.toThrow(NotFoundException);
  });
  it('lets root and scope all pick any kind', async () => {
    await expect(
      resolveFilter(db, user(AccessScope.kindergarten, Role.root), {
        kind: GroupKind.school_class,
      }),
    ).resolves.toEqual({ kind: GroupKind.school_class, groupId: null });
  });
});

describe('childFilterWhere', () => {
  it('combines kind, group and child', () => {
    expect(
      childFilterWhere({ kind: GroupKind.kindergarten, groupId: 'g1' }, 'c1'),
    ).toEqual({
      group: { kind: GroupKind.kindergarten },
      groupId: 'g1',
      id: 'c1',
    });
    expect(childFilterWhere({ kind: null, groupId: null })).toEqual({});
  });
});
