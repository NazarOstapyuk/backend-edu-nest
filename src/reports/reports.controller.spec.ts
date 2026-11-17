import { ForbiddenException } from '@nestjs/common';
import { AccessScope, PermissionLevel, Role } from '@prisma/client';
import { ReportsController } from './reports.controller';

const user = (permissions: Record<string, PermissionLevel>) =>
  ({
    id: 'u1',
    role: Role.admin,
    login: 'a',
    mustChangePassword: false,
    accessScope: AccessScope.all,
    institutionIds: [],
    scopeInstitutionIds: null,
    permissions,
  }) as never;

describe('ReportsController cash', () => {
  const report = { title: 'Каса' };
  const finance = { cash: jest.fn() };
  const controller = new ReportsController(finance as never, {} as never);
  const res = {} as never;

  beforeEach(() => {
    finance.cash.mockReset();
    finance.cash.mockResolvedValue(report);
  });

  it('forbids cash view without a shift', async () => {
    await expect(
      controller.cash({}, user({ cash: PermissionLevel.view }), res),
    ).rejects.toThrow(new ForbiddenException('Insufficient permissions'));
    expect(finance.cash).not.toHaveBeenCalled();
  });

  it('allows cash view with a shift', async () => {
    const result = await controller.cash(
      { shiftId: 's1' },
      user({ cash: PermissionLevel.view }),
      res,
    );
    expect(result).toBe(report);
  });

  it('allows cash_control view without a shift', async () => {
    const result = await controller.cash(
      {},
      user({ cash_control: PermissionLevel.view }),
      res,
    );
    expect(result).toBe(report);
  });
});
