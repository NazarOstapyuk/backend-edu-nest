import {
  AccessScope,
  GroupKind,
  PermissionArea,
  PermissionLevel,
  Role,
} from '@prisma/client';
import {
  ALL_AREAS,
  allPermissions,
  coversUser,
  grantDenial,
  hasPermission,
  levelSatisfies,
  scopeCovers,
  scopeKind,
  toPermissionMap,
} from './access-calc';

const user = (
  role: Role,
  permissions = {},
  accessScope: AccessScope = AccessScope.all,
  id = 'u1',
) => ({ id, role, accessScope, permissions });

describe('levels and permissions', () => {
  it('lets edit satisfy view but not the other way round', () => {
    expect(levelSatisfies(PermissionLevel.edit, PermissionLevel.view)).toBe(
      true,
    );
    expect(levelSatisfies(PermissionLevel.view, PermissionLevel.edit)).toBe(
      false,
    );
    expect(levelSatisfies(undefined, PermissionLevel.view)).toBe(false);
  });

  it('gives root everything, parents nothing, staff what they hold', () => {
    expect(
      hasPermission(
        user(Role.root),
        PermissionArea.payroll,
        PermissionLevel.edit,
      ),
    ).toBe(true);
    expect(
      hasPermission(
        user(Role.parent, allPermissions(PermissionLevel.edit)),
        PermissionArea.finance,
        PermissionLevel.view,
      ),
    ).toBe(false);
    const accountant = user(Role.admin, { finance: PermissionLevel.view });
    expect(
      hasPermission(accountant, PermissionArea.finance, PermissionLevel.view),
    ).toBe(true);
    expect(
      hasPermission(accountant, PermissionArea.finance, PermissionLevel.edit),
    ).toBe(false);
    expect(
      hasPermission(accountant, PermissionArea.payroll, PermissionLevel.view),
    ).toBe(false);
    const teacher = user(Role.teacher, { register: PermissionLevel.edit });
    expect(
      hasPermission(teacher, PermissionArea.register, PermissionLevel.edit),
    ).toBe(true);
  });

  it('builds full maps and maps rows', () => {
    expect(ALL_AREAS).toHaveLength(12);
    expect(Object.keys(allPermissions(PermissionLevel.view))).toHaveLength(12);
    expect(
      toPermissionMap([
        { area: PermissionArea.meals, level: PermissionLevel.edit },
      ]),
    ).toEqual({ meals: PermissionLevel.edit });
  });
});

describe('scope', () => {
  it('maps scope to a group kind', () => {
    expect(scopeKind(user(Role.admin))).toBeNull();
    expect(scopeKind(user(Role.root, {}, AccessScope.kindergarten))).toBeNull();
    expect(scopeKind(user(Role.admin, {}, AccessScope.kindergarten))).toBe(
      GroupKind.kindergarten,
    );
    expect(scopeKind(user(Role.teacher, {}, AccessScope.school_class))).toBe(
      GroupKind.school_class,
    );
  });

  it('checks scope coverage', () => {
    expect(scopeCovers(AccessScope.all, AccessScope.kindergarten)).toBe(true);
    expect(
      scopeCovers(AccessScope.kindergarten, AccessScope.kindergarten),
    ).toBe(true);
    expect(scopeCovers(AccessScope.kindergarten, AccessScope.all)).toBe(false);
    expect(
      scopeCovers(AccessScope.kindergarten, AccessScope.school_class),
    ).toBe(false);
  });
});

describe('grantDenial', () => {
  const deputy = user(
    Role.admin,
    {
      users: PermissionLevel.edit,
      finance: PermissionLevel.view,
      register: PermissionLevel.edit,
    },
    AccessScope.all,
    'g1',
  );
  const target = (
    permissions = {},
    accessScope: AccessScope = AccessScope.all,
    role: Role = Role.admin,
  ) => ({ id: 't1', role, accessScope, permissions });
  const request = (
    permissions = {},
    accessScope: AccessScope = AccessScope.all,
  ) => ({
    permissions,
    accessScope,
  });

  it('protects root, parents and oneself', () => {
    expect(
      grantDenial(
        user(Role.root, {}, AccessScope.all, 'r1'),
        target({}, AccessScope.all, Role.root),
        request(),
      ),
    ).toBe('root');
    expect(
      grantDenial(deputy, target({}, AccessScope.all, Role.parent), request()),
    ).toBe('staff_only');
    expect(grantDenial(deputy, { ...target(), id: 'g1' }, request())).toBe(
      'self',
    );
  });

  it('lets root grant anything', () => {
    expect(
      grantDenial(
        user(Role.root, {}, AccessScope.all, 'r1'),
        target(),
        request(allPermissions(PermissionLevel.edit)),
      ),
    ).toBeNull();
  });

  it('requires users: edit', () => {
    const viewer = user(
      Role.admin,
      { users: PermissionLevel.view, finance: PermissionLevel.edit },
      AccessScope.all,
      'g2',
    );
    expect(
      grantDenial(viewer, target(), request({ finance: PermissionLevel.view })),
    ).toBe('too_much');
  });

  it('allows granting what the granter holds', () => {
    expect(
      grantDenial(
        deputy,
        target(),
        request({
          finance: PermissionLevel.view,
          register: PermissionLevel.edit,
        }),
      ),
    ).toBeNull();
  });

  it('refuses a higher level, an area not held, removing an area not held', () => {
    expect(
      grantDenial(deputy, target(), request({ finance: PermissionLevel.edit })),
    ).toBe('too_much');
    expect(
      grantDenial(deputy, target(), request({ payroll: PermissionLevel.view })),
    ).toBe('too_much');
    expect(
      grantDenial(
        deputy,
        target({ payroll: PermissionLevel.edit }),
        request({}),
      ),
    ).toBe('too_much');
  });

  it('ignores unchanged areas the granter does not hold', () => {
    expect(
      grantDenial(
        deputy,
        target({ payroll: PermissionLevel.edit }),
        request({
          payroll: PermissionLevel.edit,
          register: PermissionLevel.view,
        }),
      ),
    ).toBeNull();
  });

  it('refuses a scope wider than the granter or changing a wider target', () => {
    const kgDeputy = {
      ...deputy,
      id: 'g3',
      accessScope: AccessScope.kindergarten,
    };
    expect(
      grantDenial(
        kgDeputy,
        target({}, AccessScope.kindergarten),
        request({}, AccessScope.kindergarten),
      ),
    ).toBeNull();
    expect(
      grantDenial(
        kgDeputy,
        target({}, AccessScope.kindergarten),
        request({}, AccessScope.all),
      ),
    ).toBe('too_much');
    expect(
      grantDenial(
        kgDeputy,
        target({}, AccessScope.all),
        request({}, AccessScope.all),
      ),
    ).toBe('too_much');
    expect(
      grantDenial(
        kgDeputy,
        target({}, AccessScope.school_class),
        request({}, AccessScope.kindergarten),
      ),
    ).toBe('too_much');
  });
});

describe('coversUser', () => {
  const edit = PermissionLevel.edit;
  const view = PermissionLevel.view;
  const actor = user(Role.admin, {
    [PermissionArea.users]: edit,
    [PermissionArea.finance]: edit,
  });

  it('lets root cover anyone', () => {
    expect(coversUser(user(Role.root), user(Role.root))).toBe(true);
  });

  it('never covers root for a non-root actor', () => {
    expect(coversUser(actor, user(Role.root))).toBe(false);
  });

  it('covers parents', () => {
    expect(coversUser(actor, user(Role.parent))).toBe(true);
  });

  it('covers a target whose levels the actor satisfies', () => {
    expect(
      coversUser(actor, user(Role.admin, { [PermissionArea.finance]: view })),
    ).toBe(true);
  });

  it('refuses a target with an area the actor lacks', () => {
    expect(
      coversUser(actor, user(Role.admin, { [PermissionArea.payroll]: view })),
    ).toBe(false);
  });

  it('refuses a wider scope target', () => {
    const narrow = user(
      Role.admin,
      { [PermissionArea.users]: edit },
      AccessScope.kindergarten,
    );
    expect(coversUser(narrow, user(Role.admin))).toBe(false);
  });
});
