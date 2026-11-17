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

describe('ReportsController xlsx file name', () => {
  it('does not append a period suffix to a dated report', async () => {
    const set = jest.fn();
    const finance = {
      cash: jest.fn().mockResolvedValue({
        title: 'Каса',
        fileName: 'каса-зміна-10.11.2026',
        datedFileName: true,
        period: null,
        columns: [],
        rows: [],
        totals: null,
        sheets: [],
      }),
    };
    const controller = new ReportsController(finance as never, {} as never);
    await controller.cash(
      { shiftId: 's1', format: 'xlsx' },
      user({ cash: PermissionLevel.view }),
      { set } as never,
    );
    const header = (set.mock.calls as [Record<string, string>][])[0][0][
      'Content-Disposition'
    ];
    expect(decodeURIComponent(header)).toMatch(/каса-зміна-10.11.2026.xlsx$/);
  });
});
