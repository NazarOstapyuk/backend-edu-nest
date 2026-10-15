import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AccessScope,
  PermissionArea,
  PermissionLevel,
  Role,
} from '@prisma/client';
import { PERMISSION_KEY } from '../../common/decorators/permission.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { RolesGuard } from './roles.guard';

const context = (user: unknown) =>
  ({
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

const staff = (role: Role, permissions = {}) => ({
  id: 'u1',
  role,
  login: 'x',
  mustChangePassword: false,
  accessScope: AccessScope.all,
  permissions,
});

describe('RolesGuard', () => {
  const meta: Record<string, unknown> = {};
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => meta[key]),
  } as unknown as Reflector;
  const guard = new RolesGuard(reflector);

  beforeEach(() => {
    meta[ROLES_KEY] = undefined;
    meta[PERMISSION_KEY] = undefined;
  });

  it('allows routes without decorators', () => {
    expect(guard.canActivate(context(staff(Role.parent)))).toBe(true);
  });

  it('allows listed roles', () => {
    meta[ROLES_KEY] = [Role.teacher];
    expect(guard.canActivate(context(staff(Role.teacher)))).toBe(true);
    expect(guard.canActivate(context(staff(Role.admin)))).toBe(false);
  });

  it('does not give root extra access to role-only routes', () => {
    meta[ROLES_KEY] = [Role.parent];
    expect(guard.canActivate(context(staff(Role.root)))).toBe(false);
  });

  it('checks permissions and lets root through', () => {
    meta[PERMISSION_KEY] = {
      area: PermissionArea.finance,
      level: PermissionLevel.edit,
    };
    expect(guard.canActivate(context(staff(Role.root)))).toBe(true);
    expect(
      guard.canActivate(
        context(staff(Role.admin, { finance: PermissionLevel.edit })),
      ),
    ).toBe(true);
    expect(() =>
      guard.canActivate(
        context(staff(Role.admin, { finance: PermissionLevel.view })),
      ),
    ).toThrow('Insufficient permissions');
    expect(() => guard.canActivate(context(staff(Role.parent)))).toThrow(
      'Insufficient permissions',
    );
  });

  it('allows a listed role even without the permission', () => {
    meta[ROLES_KEY] = [Role.teacher];
    meta[PERMISSION_KEY] = {
      area: PermissionArea.register,
      level: PermissionLevel.view,
    };
    expect(guard.canActivate(context(staff(Role.teacher)))).toBe(true);
    expect(
      guard.canActivate(
        context(staff(Role.admin, { register: PermissionLevel.view })),
      ),
    ).toBe(true);
  });

  it('treats an empty @Roles() override as no role access', () => {
    meta[ROLES_KEY] = [];
    meta[PERMISSION_KEY] = {
      area: PermissionArea.classes,
      level: PermissionLevel.edit,
    };
    expect(() => guard.canActivate(context(staff(Role.teacher)))).toThrow(
      'Insufficient permissions',
    );
  });
});
