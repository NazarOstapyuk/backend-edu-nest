import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_WITHOUT_PASSWORD_CHANGE } from '../../common/decorators/allow-without-password-change.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  const reflector = { getAllAndOverride: jest.fn() };
  const guard = new JwtAuthGuard(reflector as unknown as Reflector);
  const handler = () => undefined;
  const context = (request: Record<string, unknown>) =>
    ({
      getHandler: () => handler,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  let parentActivate: jest.SpyInstance;
  beforeEach(() => {
    jest.clearAllMocks();
    parentActivate = jest
      .spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate')
      .mockResolvedValue(true);
  });
  afterEach(() => parentActivate.mockRestore());

  it('flags marked handlers to ignore the institution header', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const request: Record<string, unknown> = {
      user: { mustChangePassword: true },
    };

    await expect(guard.canActivate(context(request))).resolves.toBe(true);

    expect(request.ignoreInstitutionHeader).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      ALLOW_WITHOUT_PASSWORD_CHANGE,
      [handler, undefined],
    );
  });

  it('does not flag other handlers', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const request: Record<string, unknown> = {
      user: { mustChangePassword: false },
    };

    await expect(guard.canActivate(context(request))).resolves.toBe(true);

    expect(request.ignoreInstitutionHeader).toBeUndefined();
  });

  it('sets the flag before authenticating', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const request: Record<string, unknown> = { user: undefined };
    parentActivate.mockImplementation(() => {
      expect(request.ignoreInstitutionHeader).toBe(true);
      return Promise.resolve(true);
    });

    await guard.canActivate(context(request));

    expect(parentActivate).toHaveBeenCalled();
  });
});
