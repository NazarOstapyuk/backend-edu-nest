import { PermissionArea, PermissionLevel } from '@prisma/client';
import { PERMISSION_KEY } from '../common/decorators/permission.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { ChildFinanceController } from './child-finance.controller';
import { FinanceController } from './finance.controller';

describe('finance controllers', () => {
  it.each([ChildFinanceController, FinanceController])(
    '%p requires finance view and no role access',
    (controller) => {
      expect(Reflect.getMetadata(PERMISSION_KEY, controller)).toEqual({
        area: PermissionArea.finance,
        level: PermissionLevel.view,
      });
      expect(Reflect.getMetadata(ROLES_KEY, controller)).toBeUndefined();
    },
  );

  it('requires finance edit for creating charges and payments', () => {
    for (const method of ['createCharge', 'createPayment']) {
      const handler = (
        ChildFinanceController.prototype as unknown as Record<string, object>
      )[method];
      expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toEqual({
        area: PermissionArea.finance,
        level: PermissionLevel.edit,
      });
    }
  });
});
