import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

export class BackupStorage {
  async ensureDir(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
  }

  async list(dir: string): Promise<{ name: string; size: number }[]> {
    const names = await readdir(dir).catch(() => [] as string[]);
    const files: { name: string; size: number }[] = [];
    for (const name of names) {
      const info = await stat(join(dir, name)).catch(() => null);
      if (info?.isFile()) files.push({ name, size: info.size });
    }
    return files;
  }

  size(path: string): Promise<number> {
    return stat(path)
      .then((info) => info.size)
      .catch(() => 0);
  }

  rename(from: string, to: string): Promise<void> {
    return rename(from, to);
  }

  remove(path: string): Promise<void> {
    return rm(path, { force: true });
  }
}
