import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

type CopyDb = {
  userPasswordCopy: {
    upsert(args: {
      where: { userId: string };
      create: { userId: string; sealed: string };
      update: { sealed: string };
    }): Promise<unknown>;
  };
};

export function parseVaultKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  const key = Buffer.from(raw.trim(), 'base64');
  return key.length === 32 ? key : null;
}

export const vaultKey = (): Buffer | null =>
  parseVaultKey(process.env.PASSWORD_VIEW_KEY);

export function sealPassword(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data]
    .map((part) => part.toString('base64'))
    .join('.');
}

export function openPassword(sealed: string, key: Buffer): string | null {
  const parts = sealed.split('.');
  if (parts.length !== 3) return null;
  try {
    const [iv, tag, data] = parts.map((part) => Buffer.from(part, 'base64'));
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      'utf8',
    );
  } catch {
    return null;
  }
}

export async function storePasswordCopy(
  db: CopyDb,
  userId: string,
  plain: string,
): Promise<void> {
  const key = vaultKey();
  if (!key) return;
  const sealed = sealPassword(plain, key);
  await db.userPasswordCopy.upsert({
    where: { userId },
    create: { userId, sealed },
    update: { sealed },
  });
}
