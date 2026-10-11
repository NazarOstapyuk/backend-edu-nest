import { Role } from '@prisma/client';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { AdaptationController } from './adaptation.controller';
import { BillingController } from './billing.controller';
import { EnrollmentsController } from './enrollments.controller';
import { TariffsController } from './tariffs.controller';

describe('tariff controllers', () => {
  it.each([
    TariffsController,
    EnrollmentsController,
    BillingController,
    AdaptationController,
  ])('%p allows only root and admin', (controller) => {
    expect(Reflect.getMetadata(ROLES_KEY, controller)).toEqual([
      Role.root,
      Role.admin,
    ]);
  });
});
