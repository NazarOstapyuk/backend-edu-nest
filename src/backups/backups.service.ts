import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BackupKind, BackupStatus, Prisma } from '@prisma/client';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { kyivToday } from '../tariffs/dates';
import {
  dumpCommand,
  maskSecret,
  parseDatabaseUrl,
  passwordOf,
} from './backup-command';
import {
  backupFileName,
  filesToDelete,
  parseBackupName,
  takenAtOf,
} from './backup-retention';
import { BackupStorage } from './backup-storage';
import { ProcessRunner } from './process-runner';

const TIMEOUT_MS = 10 * 60 * 1000;
const STALE_MS = 26 * 60 * 60 * 1000;
const DEFAULT_CONTAINER = 'edu_postgres';

const runInclude = {
  createdBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.BackupRunInclude;

type RunRow = Prisma.BackupRunGetPayload<{ include: typeof runInclude }>;

const toRunView = (run: RunRow) => ({
  id: run.id,
  kind: run.kind,
  status: run.status,
  fileName: run.fileName,
  sizeBytes: run.sizeBytes === null ? null : Number(run.sizeBytes),
  error: run.error,
  startedAt: run.startedAt.toISOString(),
  finishedAt: run.finishedAt?.toISOString() ?? null,
  createdBy: run.createdBy,
});

export type RunView = ReturnType<typeof toRunView>;

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

@Injectable()
export class BackupsService implements OnModuleInit {
  private readonly logger = new Logger(BackupsService.name);
  private running = false;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private runner: ProcessRunner,
    private storage: BackupStorage,
  ) {}

  async onModuleInit() {
    await this.prisma.backupRun.updateMany({
      where: { status: BackupStatus.running },
      data: {
        status: BackupStatus.failed,
        error: 'Interrupted',
        finishedAt: new Date(),
      },
    });
  }

  private settings() {
    const dir = this.config.get<string>('BACKUP_DIR')?.trim() || null;
    const raw = this.config.get<string>('BACKUP_PG_CONTAINER');
    const container =
      raw === undefined ? DEFAULT_CONTAINER : raw.trim() || null;
    return { dir, container };
  }

  async create(kind: BackupKind, userId: string | null = null) {
    const { dir, container } = this.settings();
    if (!dir) throw new BadRequestException('Backups are not configured');
    if (this.running) throw new ConflictException('Backup is already running');
    this.running = true;
    const databaseUrl = this.config.get<string>('DATABASE_URL');
    const secret = passwordOf(databaseUrl);
    try {
      const run = await this.prisma.backupRun.create({
        data: { kind, status: BackupStatus.running, createdById: userId },
      });
      try {
        const db = parseDatabaseUrl(databaseUrl ?? '');
        const name = backupFileName(kind, new Date());
        const target = join(dir, name);
        const part = `${target}.part`;
        await this.storage.ensureDir(dir);
        const { spec, stdoutToFile } = dumpCommand(db, container, part);
        const result = await this.runner.run(spec, {
          stdoutFile: stdoutToFile ? part : undefined,
          timeoutMs: TIMEOUT_MS,
        });
        const size = await this.storage.size(part);
        if (result.timedOut || result.code !== 0 || size === 0) {
          await this.storage.remove(part);
          const error = result.timedOut
            ? 'Timed out'
            : result.code !== 0
              ? maskSecret(
                  result.stderr.trim() || `Exit code ${result.code}`,
                  secret,
                )
              : 'Empty dump';
          return this.finish(run.id, {
            status: BackupStatus.failed,
            error,
          });
        }
        await this.storage.rename(part, target);
        const view = await this.finish(run.id, {
          status: BackupStatus.succeeded,
          fileName: name,
          sizeBytes: BigInt(size),
        });
        await this.applyRetention(dir);
        return view;
      } catch (error) {
        return this.finish(run.id, {
          status: BackupStatus.failed,
          error: maskSecret(messageOf(error), secret),
        });
      }
    } finally {
      this.running = false;
    }
  }

  async status() {
    const { dir } = this.settings();
    const [lastSuccess, lastFailure, lastRun] = await Promise.all([
      this.prisma.backupRun.findFirst({
        where: { status: BackupStatus.succeeded },
        orderBy: { startedAt: 'desc' },
        include: runInclude,
      }),
      this.prisma.backupRun.findFirst({
        where: { status: BackupStatus.failed },
        orderBy: { startedAt: 'desc' },
        include: runInclude,
      }),
      this.prisma.backupRun.findFirst({
        where: { status: { not: BackupStatus.running } },
        orderBy: { startedAt: 'desc' },
        include: runInclude,
      }),
    ]);
    const files = dir
      ? (await this.storage.list(dir))
          .flatMap((file) => {
            const info = parseBackupName(file.name);
            return info
              ? [
                  {
                    name: file.name,
                    kind: info.kind,
                    sizeBytes: file.size,
                    takenAt: takenAtOf(info.stamp),
                    stamp: info.stamp,
                  },
                ]
              : [];
          })
          .sort((a, b) => b.stamp.localeCompare(a.stamp))
          .map(({ name, kind, sizeBytes, takenAt }) => ({
            name,
            kind,
            sizeBytes,
            takenAt,
          }))
      : [];
    const successAt = lastSuccess?.finishedAt?.getTime();
    const stale =
      !!dir &&
      (successAt === undefined ||
        Date.now() - successAt > STALE_MS ||
        lastRun?.status === BackupStatus.failed);
    return {
      configured: !!dir,
      dir,
      running: this.running,
      lastSuccess: lastSuccess ? toRunView(lastSuccess) : null,
      lastFailure: lastFailure ? toRunView(lastFailure) : null,
      stale,
      files,
    };
  }

  async runs() {
    const rows = await this.prisma.backupRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 50,
      include: runInclude,
    });
    return rows.map(toRunView);
  }

  private async finish(
    id: string,
    data: Pick<
      Prisma.BackupRunUpdateInput,
      'status' | 'error' | 'fileName' | 'sizeBytes'
    >,
  ) {
    const run = await this.prisma.backupRun.update({
      where: { id },
      data: { ...data, finishedAt: new Date() },
      include: runInclude,
    });
    return toRunView(run);
  }

  private async applyRetention(dir: string) {
    try {
      const files = (await this.storage.list(dir)).flatMap((file) => {
        const info = parseBackupName(file.name);
        return info ? [info] : [];
      });
      for (const name of filesToDelete(files, kyivToday())) {
        await this.storage
          .remove(join(dir, name))
          .catch((error) =>
            this.logger.warn(`Could not delete ${name}: ${messageOf(error)}`),
          );
      }
    } catch (error) {
      this.logger.warn(`Retention failed: ${messageOf(error)}`);
    }
  }
}
