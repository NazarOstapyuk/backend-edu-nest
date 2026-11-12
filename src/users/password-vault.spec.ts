import { randomBytes } from 'node:crypto';
import {
  openPassword,
  parseVaultKey,
  sealPassword,
  storePasswordCopy,
} from './password-vault';

type UpsertArgs = {
  where: { userId: string };
  create: { sealed: string };
  update: { sealed: string };
};

describe('password vault', () => {
  const key = randomBytes(32);

  it('round-trips a password', () => {
    const sealed = sealPassword('Пароль-123', key);
    expect(sealed).not.toContain('Пароль-123');
    expect(openPassword(sealed, key)).toBe('Пароль-123');
  });

  it('uses a fresh iv each time', () => {
    expect(sealPassword('same', key)).not.toBe(sealPassword('same', key));
  });

  it('returns null for another key or garbage', () => {
    const sealed = sealPassword('secret', key);
    expect(openPassword(sealed, randomBytes(32))).toBeNull();
    expect(openPassword('not-sealed', key)).toBeNull();
  });

  it('accepts only a 32-byte base64 key', () => {
    expect(parseVaultKey(key.toString('base64'))?.equals(key)).toBe(true);
    expect(parseVaultKey(randomBytes(16).toString('base64'))).toBeNull();
    expect(parseVaultKey(undefined)).toBeNull();
    expect(parseVaultKey('')).toBeNull();
  });

  describe('storePasswordCopy', () => {
    const original = process.env.PASSWORD_VIEW_KEY;
    afterEach(() => {
      if (original === undefined) delete process.env.PASSWORD_VIEW_KEY;
      else process.env.PASSWORD_VIEW_KEY = original;
    });

    it('upserts a sealed copy when the key is set', async () => {
      process.env.PASSWORD_VIEW_KEY = key.toString('base64');
      const upsert = jest.fn().mockResolvedValue(undefined);
      await storePasswordCopy({ userPasswordCopy: { upsert } }, 'u1', 'pw1234');
      const args = (upsert.mock.calls[0] as [UpsertArgs])[0];
      expect(args.where).toEqual({ userId: 'u1' });
      expect(openPassword(args.create.sealed, key)).toBe('pw1234');
      expect(args.update.sealed).toBe(args.create.sealed);
    });

    it('skips without a key', async () => {
      delete process.env.PASSWORD_VIEW_KEY;
      const upsert = jest.fn();
      await storePasswordCopy({ userPasswordCopy: { upsert } }, 'u1', 'pw1234');
      expect(upsert).not.toHaveBeenCalled();
    });
  });
});
