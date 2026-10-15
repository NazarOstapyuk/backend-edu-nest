import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { GroupKind } from '@prisma/client';
import {
  assertChildInScope,
  assertKindInScope,
  childScopeWhere,
  groupScopeWhere,
} from './scope';

describe('scope helpers', () => {
  it('builds filters', () => {
    expect(childScopeWhere(null)).toEqual({});
    expect(childScopeWhere(GroupKind.kindergarten)).toEqual({
      group: { kind: GroupKind.kindergarten },
    });
    expect(groupScopeWhere(null)).toEqual({});
    expect(groupScopeWhere(GroupKind.school_class)).toEqual({
      kind: GroupKind.school_class,
    });
  });

  it('rejects another kind', () => {
    expect(() => assertKindInScope(null, GroupKind.kindergarten)).not.toThrow();
    expect(() =>
      assertKindInScope(GroupKind.kindergarten, GroupKind.kindergarten),
    ).not.toThrow();
    expect(() =>
      assertKindInScope(GroupKind.kindergarten, GroupKind.school_class),
    ).toThrow(new ForbiddenException('Outside access scope'));
    expect(() => assertKindInScope(GroupKind.kindergarten, null)).toThrow(
      'Outside access scope',
    );
  });

  it('hides children outside the scope as not found', async () => {
    const db = { child: { findFirst: jest.fn() } };
    await assertChildInScope(db, null, 'c1');
    expect(db.child.findFirst).not.toHaveBeenCalled();

    db.child.findFirst.mockResolvedValue({ id: 'c1' });
    await assertChildInScope(db, GroupKind.kindergarten, 'c1');
    expect(db.child.findFirst).toHaveBeenCalledWith({
      where: { id: 'c1', group: { kind: GroupKind.kindergarten } },
      select: { id: true },
    });

    db.child.findFirst.mockResolvedValue(null);
    await expect(
      assertChildInScope(db, GroupKind.kindergarten, 'c1'),
    ).rejects.toThrow(new NotFoundException('Child not found'));
    await expect(
      assertChildInScope(db, GroupKind.kindergarten, 'c1', 'Charge not found'),
    ).rejects.toThrow('Charge not found');
  });
});
