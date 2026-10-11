import { Role } from '@prisma/client';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { ClassGroupsController } from './class-groups.controller';
import { DirectionsController } from './directions.controller';
import { PackagesController } from './packages.controller';

const handlerRoles = (controller: { prototype: object }, method: string) =>
  Reflect.getMetadata(
    ROLES_KEY,
    (controller.prototype as Record<string, unknown>)[method] as object,
  ) as Role[] | undefined;

describe('classes controllers', () => {
  it('restricts directions and packages to root and admin', () => {
    expect(Reflect.getMetadata(ROLES_KEY, DirectionsController)).toEqual([
      Role.root,
      Role.admin,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, PackagesController)).toEqual([
      Role.root,
      Role.admin,
    ]);
  });

  it('opens class groups to teachers but keeps admin actions admin-only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ClassGroupsController)).toEqual([
      Role.root,
      Role.admin,
      Role.teacher,
    ]);
    for (const method of [
      'create',
      'update',
      'delete',
      'addMember',
      'endMember',
    ]) {
      expect(handlerRoles(ClassGroupsController, method)).toEqual([
        Role.root,
        Role.admin,
      ]);
    }
    for (const method of ['get', 'my', 'roster', 'mark']) {
      expect(handlerRoles(ClassGroupsController, method)).toBeUndefined();
    }
  });
});
