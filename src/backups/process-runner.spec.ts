import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProcessRunner } from './process-runner';

const node = (script: string, env: Record<string, string> = {}) => ({
  command: process.execPath,
  args: ['-e', script],
  env,
});

describe('ProcessRunner', () => {
  const runner = new ProcessRunner();
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'runner-'));
  });

  it('streams stdout into a file and collects stderr', async () => {
    const out = join(dir, 'out.bin');
    const result = await runner.run(
      node(
        "process.stdout.write(process.env.PGPASSWORD); process.stderr.write('warn')",
        { PGPASSWORD: 'dump-data' },
      ),
      { stdoutFile: out, timeoutMs: 10_000 },
    );
    expect(result).toEqual({ code: 0, stderr: 'warn', timedOut: false });
    expect(await readFile(out, 'utf8')).toBe('dump-data');
  });

  it('feeds a file to stdin', async () => {
    const input = join(dir, 'in.txt');
    const out = join(dir, 'echo.txt');
    await writeFile(input, 'restore-me');
    const result = await runner.run(
      node('process.stdin.pipe(process.stdout)'),
      {
        stdinFile: input,
        stdoutFile: out,
        timeoutMs: 10_000,
      },
    );
    expect(result.code).toBe(0);
    expect(await readFile(out, 'utf8')).toBe('restore-me');
  });

  it('reports a non-zero exit code', async () => {
    const result = await runner.run(node('process.exit(3)'), {
      timeoutMs: 10_000,
    });
    expect(result.code).toBe(3);
    expect(result.timedOut).toBe(false);
  });

  it('kills a process that runs too long', async () => {
    const result = await runner.run(node('setTimeout(() => {}, 20000)'), {
      timeoutMs: 300,
    });
    expect(result.timedOut).toBe(true);
    expect(result.code).not.toBe(0);
  });

  it('fails when the output file cannot be written', async () => {
    const bad = join(dir, 'missing-dir', 'out.bin');
    const small = await runner.run(node("process.stdout.write('data')"), {
      stdoutFile: bad,
      timeoutMs: 5000,
    });
    expect(small.code).not.toBe(0);
    expect(small.stderr).not.toBe('');

    const large = await runner.run(
      node(
        'const b = Buffer.alloc(1 << 20, 1); let i = 0; const w = () => { while (i < 8) { i++; if (!process.stdout.write(b)) return process.stdout.once("drain", w); } }; w();',
      ),
      { stdoutFile: bad, timeoutMs: 5000 },
    );
    expect(large.timedOut).toBe(false);
    expect(large.code).not.toBe(0);
    expect(large.stderr).not.toBe('');
  });

  it('reports a missing command', async () => {
    const result = await runner.run(
      { command: 'definitely-missing-command-xyz', args: [], env: {} },
      { timeoutMs: 10_000 },
    );
    expect(result.code).toBeNull();
    expect(result.stderr).not.toBe('');
  });
});
