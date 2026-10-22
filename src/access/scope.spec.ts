import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  assertChildInScope,
  assertInstitutionInScope,
  childScopeWhere,
  groupScopeWhere,
} from './scope';

describe('scope helpers', () => {
  it('builds filters', () => {
    expect(childScopeWhere(null)).toEqual({});
    expect(childScopeWhere(['a'])).toEqual({
      group: { institutionId: { in: ['a'] } },
    });
    expect(groupScopeWhere(null)).toEqual({});
    expect(groupScopeWhere(['a', 'b'])).toEqual({
      institutionId: { in: ['a', 'b'] },
    });
  });

  it('rejects another institution', () => {
    expect(() => assertInstitutionInScope(null, 'x')).not.toThrow();
    expect(() => assertInstitutionInScope(null, null)).not.toThrow();
    expect(() => assertInstitutionInScope(['a'], 'a')).not.toThrow();
    expect(() => assertInstitutionInScope(['a'], 'b')).toThrow(
      new ForbiddenException('Outside access scope'),
    );
    expect(() => assertInstitutionInScope(['a'], null)).toThrow(
      'Outside access scope',
    );
  });

  it('hides children outside the scope as not found', async () => {
    const db = { child: { findFirst: jest.fn() } };
    await assertChildInScope(db, null, 'c1');
    expect(db.child.findFirst).not.toHaveBeenCalled();

    db.child.findFirst.mockResolvedValue({ id: 'c1' });
    await assertChildInScope(db, ['a'], 'c1');
    expect(db.child.findFirst).toHaveBeenCalledWith({
      where: { id: 'c1', group: { institutionId: { in: ['a'] } } },
      select: { id: true },
    });

    db.child.findFirst.mockResolvedValue(null);
    await expect(assertChildInScope(db, ['a'], 'c1')).rejects.toThrow(
      new NotFoundException('Child not found'),
    );
    await expect(
      assertChildInScope(db, ['a'], 'c1', 'Charge not found'),
    ).rejects.toThrow('Charge not found');
  });
});
