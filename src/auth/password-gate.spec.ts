import { ForbiddenException } from '@nestjs/common';
import { assertPasswordChanged } from './password-gate';

describe('assertPasswordChanged', () => {
  it('blocks a user who must change the password', () => {
    expect(() =>
      assertPasswordChanged({ mustChangePassword: true }, false),
    ).toThrow(new ForbiddenException('Password change required'));
  });

  it('lets allowed handlers through', () => {
    expect(() =>
      assertPasswordChanged({ mustChangePassword: true }, true),
    ).not.toThrow();
  });

  it('lets users without the flag through', () => {
    expect(() =>
      assertPasswordChanged({ mustChangePassword: false }, false),
    ).not.toThrow();
    expect(() => assertPasswordChanged(undefined, false)).not.toThrow();
  });
});
