import 'dotenv/config';
import { BackupKind } from '@prisma/client';
import { existsSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import {
  dumpCommand,
  maskSecret,
  parseDatabaseUrl,
  restoreCommand,
} from '../src/backups/backup-command';
import { backupFileName } from '../src/backups/backup-retention';
import { ProcessRunner } from '../src/backups/process-runner';

const TIMEOUT_MS = 60 * 60 * 1000;

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const portBusy = (port: number) =>
  new Promise<boolean>((done) => {
    const socket = connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('error', () => done(false));
  });

async function main() {
  const args = process.argv.slice(2);
  const yes = args.includes('--yes');
  const target = args.find((arg) => arg !== '--yes');
  if (!target) fail('Usage: npm run backup:restore -- <file> [--yes]');
  const dir = process.env.BACKUP_DIR?.trim() ?? '';
  if (!dir)
    fail('BACKUP_DIR is not set: a safety copy is required before restore');
  const file = /[\\/]/.test(target!) ? resolve(target!) : join(dir, target!);
  if (!existsSync(file)) fail(`File not found: ${file}`);
  const port = Number(process.env.PORT ?? 3000);
  if (await portBusy(port)) fail('Stop the backend first');
  const db = parseDatabaseUrl(process.env.DATABASE_URL ?? '');
  const raw = process.env.BACKUP_PG_CONTAINER;
  const container = raw === undefined ? 'edu_postgres' : raw.trim() || null;
  if (!yes) {
    const prompt = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await prompt.question(
      `This replaces all data in "${db.database}". Type the database name to continue: `,
    );
    prompt.close();
    if (answer.trim() !== db.database) fail('Cancelled');
  }
  const runner = new ProcessRunner();
  const safety = join(dir, backupFileName(BackupKind.pre_restore, new Date()));
  const dump = dumpCommand(db, container, safety);
  const dumped = await runner.run(dump.spec, {
    stdoutFile: dump.stdoutToFile ? safety : undefined,
    timeoutMs: TIMEOUT_MS,
  });
  if (dumped.timedOut || dumped.code !== 0) {
    rmSync(safety, { force: true });
    fail(
      `Safety copy failed, nothing restored: ${maskSecret(dumped.stderr, db.password)}`,
    );
  }
  console.log(`Safety copy: ${safety}`);
  const restore = restoreCommand(db, container, file);
  const restored = await runner.run(restore.spec, {
    stdinFile: restore.stdinFromFile ? file : undefined,
    timeoutMs: TIMEOUT_MS,
  });
  if (restored.timedOut || restored.code !== 0)
    fail(
      `Restore failed (safety copy kept: ${safety}):\n${maskSecret(restored.stderr, db.password)}`,
    );
  console.log(`Restored ${file} into ${db.database}`);
}

main().catch((error: unknown) =>
  fail(error instanceof Error ? error.message : String(error)),
);
