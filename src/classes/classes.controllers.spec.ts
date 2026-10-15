import { PermissionArea, PermissionLevel, Role } from '@prisma/client';
import { PERMISSION_KEY } from '../common/decorators/permission.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { ClassGroupsController } from './class-groups.controller';
import { DirectionsController } from './directions.controller';
import { PackagesController } from './packages.controller';

const handler = (controller: { prototype: object }, method: string) =>
  (controller.prototype as Record<string, unknown>)[method] as object;

describe('classes controllers', () => {
  it('requires classes view for directions and packages without role access', () => {
    for (const controller of [DirectionsController, PackagesController]) {
      expect(Reflect.getMetadata(PERMISSION_KEY, controller)).toEqual({
        area: PermissionArea.classes,
        level: PermissionLevel.view,
      });
      expect(Reflect.getMetadata(ROLES_KEY, controller)).toBeUndefined();
    }
  });

  it('opens class groups to teachers but keeps admin actions to classes edit', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ClassGroupsController)).toEqual([
      Role.teacher,
    ]);
    expect(Reflect.getMetadata(PERMISSION_KEY, ClassGroupsController)).toEqual({
      area: PermissionArea.classes,
      level: PermissionLevel.view,
    });
    for (const method of [
      'create',
      'update',
      'delete',
      'addMember',
      'endMember',
    ]) {
      const target = handler(ClassGroupsController, method);
      expect(Reflect.getMetadata(ROLES_KEY, target)).toEqual([]);
      expect(Reflect.getMetadata(PERMISSION_KEY, target)).toEqual({
        area: PermissionArea.classes,
        level: PermissionLevel.edit,
      });
    }
    for (const method of ['get', 'my', 'roster']) {
      const target = handler(ClassGroupsController, method);
      expect(Reflect.getMetadata(ROLES_KEY, target)).toBeUndefined();
      expect(Reflect.getMetadata(PERMISSION_KEY, target)).toBeUndefined();
    }
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY,
        handler(ClassGroupsController, 'mark'),
      ),
    ).toEqual({
      area: PermissionArea.classes,
      level: PermissionLevel.edit,
    });
    expect(
      Reflect.getMetadata(ROLES_KEY, handler(ClassGroupsController, 'mark')),
    ).toBeUndefined();
  });
});
