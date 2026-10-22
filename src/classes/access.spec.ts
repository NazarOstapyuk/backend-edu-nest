import { ForbiddenException } from '@nestjs/common';
import {
  AccessScope,
  PermissionArea,
  PermissionLevel,
  Role,
} from '@prisma/client';
import { allPermissions } from '../access/access-calc';
import { assertGroupAccess } from './access';

const user = (
  id: string,
  role: Role,
  permissions: Record<string, PermissionLevel>,
) => ({
  id,
  role,
  login: id,
  mustChangePassword: false,
  accessScope: AccessScope.all,
  institutionIds: [] as string[],
  scopeInstitutionIds: null as string[] | null,
  permissions,
});

const group = { teachers: [{ id: 't1' }] };

describe('assertGroupAccess', () => {
  it('lets a teacher of the group through', () => {
    expect(() =>
      assertGroupAccess(group, user('t1', Role.teacher, {})),
    ).not.toThrow();
  });

  it('lets another teacher with classes view through', () => {
    expect(() =>
      assertGroupAccess(
        group,
        user('t2', Role.teacher, { classes: PermissionLevel.view }),
      ),
    ).not.toThrow();
  });

  it('rejects an admin without permissions', () => {
    expect(() => assertGroupAccess(group, user('a1', Role.admin, {}))).toThrow(
      new ForbiddenException('Not your class group'),
    );
  });

  it('checks the given area', () => {
    const meals = user('t2', Role.teacher, { meals: PermissionLevel.view });
    expect(() => assertGroupAccess(group, meals)).toThrow(ForbiddenException);
    expect(() =>
      assertGroupAccess(group, meals, PermissionArea.meals),
    ).not.toThrow();
    expect(() =>
      assertGroupAccess(
        group,
        user('a1', Role.admin, allPermissions(PermissionLevel.edit)),
      ),
    ).not.toThrow();
  });
});
