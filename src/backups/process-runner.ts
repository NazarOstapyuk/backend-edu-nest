import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import type { CommandSpec } from './backup-command';

export interface RunOptions {
  stdoutFile?: string;
  stdinFile?: string;
  timeoutMs: number;
}

export interface RunResult {
  code: number | null;
  stderr: string;
  timedOut: boolean;
}

const MAX_STDERR = 10_000;
const KILL_GRACE_MS = 5000;

export class ProcessRunner {
  run(spec: CommandSpec, options: RunOptions): Promise<RunResult> {
    return new Promise((resolve) => {
      const child = spawn(spec.command, spec.args, {
        env: { ...process.env, ...spec.env },
        windowsHide: true,
        stdio: [
          options.stdinFile ? 'pipe' : 'ignore',
          options.stdoutFile ? 'pipe' : 'ignore',
          'pipe',
        ],
      });
      let stderr = '';
      let timedOut = false;
      let settled = false;
      let exitCode: number | null = null;
      let exited = false;
      let flushed = !options.stdoutFile;
      let writeFailed = false;
      let grace: NodeJS.Timeout | undefined;
      const finish = (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(grace);
        resolve({ code, stderr, timedOut });
      };
      const maybeFinish = () => {
        if (exited && flushed) finish(writeFailed ? null : exitCode);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
        grace = setTimeout(() => finish(null), KILL_GRACE_MS);
      }, options.timeoutMs);
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < MAX_STDERR) stderr += chunk.toString();
      });
      child.on('error', (error) => {
        stderr += error.message;
        finish(null);
      });
      if (options.stdoutFile && child.stdout) {
        const out = createWriteStream(options.stdoutFile);
        out.on('finish', () => {
          flushed = true;
          maybeFinish();
        });
        out.on('error', (error) => {
          stderr += error.message;
          writeFailed = true;
          flushed = true;
          child.kill();
          maybeFinish();
        });
        child.stdout.pipe(out);
      }
      if (options.stdinFile && child.stdin) {
        const input = createReadStream(options.stdinFile);
        input.on('error', (error) => {
          stderr += error.message;
          child.kill();
        });
        child.stdin.on('error', () => undefined);
        input.pipe(child.stdin);
      }
      child.on('close', (code) => {
        exitCode = code;
        exited = true;
        maybeFinish();
      });
    });
  }
}
