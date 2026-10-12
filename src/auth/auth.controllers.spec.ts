import { ALLOW_WITHOUT_PASSWORD_CHANGE } from '../common/decorators/allow-without-password-change.decorator';
import { AuthController } from './auth.controller';
import { MeController } from './me.controller';

const allowed = (controller: { prototype: object }, method: string) =>
  Reflect.getMetadata(
    ALLOW_WITHOUT_PASSWORD_CHANGE,
    (controller.prototype as Record<string, unknown>)[method] as object,
  ) as boolean | undefined;

describe('password change gate markers', () => {
  it('marks only me, logout and password change', () => {
    expect(allowed(AuthController, 'me')).toBe(true);
    expect(allowed(AuthController, 'logout')).toBe(true);
    expect(allowed(MeController, 'changePassword')).toBe(true);
    expect(allowed(MeController, 'updateContacts')).toBeUndefined();
  });
});
