import { PermissionArea, PermissionLevel } from '@prisma/client';
import { PERMISSION_KEY } from '../common/decorators/permission.decorator';
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
  ])('%p requires tariffs view and no role access', (controller) => {
    expect(Reflect.getMetadata(PERMISSION_KEY, controller)).toEqual({
      area: PermissionArea.tariffs,
      level: PermissionLevel.view,
    });
    expect(Reflect.getMetadata(ROLES_KEY, controller)).toBeUndefined();
  });
});
