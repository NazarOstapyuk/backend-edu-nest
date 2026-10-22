import {
  AccessScope,
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
  baseScope,
  effectiveScope,
  scopeCovers,
  scopeIds,
  toPermissionMap,
} from './access-calc';

const user = (
  role: Role,
  permissions = {},
  accessScope: AccessScope = AccessScope.all,
  id = 'u1',
) => ({ id, role, accessScope, institutionIds: [] as string[], permissions });

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
  it('computes the base scope', () => {
    expect(baseScope(user(Role.root))).toBeNull();
    expect(baseScope(user(Role.admin))).toBeNull();
    expect(
      baseScope({
        role: Role.parent,
        accessScope: AccessScope.institutions,
        institutionIds: ['a'],
      }),
    ).toBeNull();
    expect(
      baseScope({
        role: Role.root,
        accessScope: AccessScope.institutions,
        institutionIds: ['a'],
      }),
    ).toBeNull();
    expect(
      baseScope({
        role: Role.admin,
        accessScope: AccessScope.institutions,
        institutionIds: ['a', 'b'],
      }),
    ).toEqual(['a', 'b']);
    expect(
      baseScope({
        role: Role.teacher,
        accessScope: AccessScope.institutions,
        institutionIds: [],
      }),
    ).toEqual([]);
  });

  it('applies the selected institution', () => {
    expect(effectiveScope(null, null)).toBeNull();
    expect(effectiveScope(['a', 'b'], null)).toEqual(['a', 'b']);
    expect(effectiveScope(null, 'x')).toEqual(['x']);
    expect(effectiveScope(['a', 'b'], 'b')).toEqual(['b']);
    expect(effectiveScope(['a'], 'b')).toBe('outside');
    expect(effectiveScope([], 'b')).toBe('outside');
  });

  it('reads the effective scope ids', () => {
    expect(scopeIds({ scopeInstitutionIds: null })).toBeNull();
    expect(scopeIds({ scopeInstitutionIds: ['a'] })).toEqual(['a']);
  });

  it('checks scope coverage', () => {
    const all = { accessScope: AccessScope.all, institutionIds: [] };
    const some = (...institutionIds: string[]) => ({
      accessScope: AccessScope.institutions,
      institutionIds,
    });
    expect(scopeCovers(all, all)).toBe(true);
    expect(scopeCovers(all, some('a'))).toBe(true);
    expect(scopeCovers(some('a', 'b'), some('a'))).toBe(true);
    expect(scopeCovers(some('a'), some('a', 'b'))).toBe(false);
    expect(scopeCovers(some('a'), some('b'))).toBe(false);
    expect(scopeCovers(some('a', 'b'), all)).toBe(false);
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
    institutionIds: string[] = [],
  ) => ({ id: 't1', role, accessScope, institutionIds, permissions });
  const request = (
    permissions = {},
    accessScope: AccessScope = AccessScope.all,
    institutionIds: string[] = [],
  ) => ({
    permissions,
    accessScope,
    institutionIds,
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
    const I = AccessScope.institutions;
    const abDeputy = {
      ...deputy,
      id: 'g3',
      accessScope: I,
      institutionIds: ['a', 'b'],
    };
    const aDeputy = { ...abDeputy, institutionIds: ['a'] };
    expect(
      grantDenial(
        aDeputy,
        target({}, I, Role.admin, ['a']),
        request({}, I, ['a']),
      ),
    ).toBeNull();
    expect(
      grantDenial(
        abDeputy,
        target({}, I, Role.admin, ['a']),
        request({}, I, ['a', 'b']),
      ),
    ).toBeNull();
    expect(
      grantDenial(
        aDeputy,
        target({}, I, Role.admin, ['a']),
        request({}, I, ['a', 'b']),
      ),
    ).toBe('too_much');
    expect(
      grantDenial(
        aDeputy,
        target({}, I, Role.admin, ['a']),
        request({}, AccessScope.all),
      ),
    ).toBe('too_much');
    expect(
      grantDenial(
        aDeputy,
        target({}, AccessScope.all),
        request({}, AccessScope.all),
      ),
    ).toBe('too_much');
    expect(
      grantDenial(
        aDeputy,
        target({}, I, Role.admin, ['b']),
        request({}, I, ['a']),
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
    const narrow = {
      ...user(
        Role.admin,
        { [PermissionArea.users]: edit },
        AccessScope.institutions,
      ),
      institutionIds: ['a'],
    };
    expect(coversUser(narrow, user(Role.admin))).toBe(false);
  });

  it('covers a target whose institutions are a subset', () => {
    const base = user(
      Role.admin,
      { [PermissionArea.users]: edit },
      AccessScope.institutions,
    );
    const granter = { ...base, institutionIds: ['a', 'b'] };
    expect(coversUser(granter, { ...base, institutionIds: ['b'] })).toBe(true);
    expect(coversUser(granter, { ...base, institutionIds: ['b', 'c'] })).toBe(
      false,
    );
  });
});
