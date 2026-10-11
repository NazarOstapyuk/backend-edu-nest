import { Role } from '@prisma/client';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { ChildFinanceController } from './child-finance.controller';
import { FinanceController } from './finance.controller';

describe('finance controllers', () => {
  it.each([ChildFinanceController, FinanceController])(
    '%p allows only root and admin',
    (controller) => {
      expect(Reflect.getMetadata(ROLES_KEY, controller)).toEqual([
        Role.root,
        Role.admin,
      ]);
    },
  );
});
