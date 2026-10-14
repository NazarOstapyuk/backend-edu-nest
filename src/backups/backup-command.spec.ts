import {
  dumpCommand,
  maskSecret,
  parseDatabaseUrl,
  passwordOf,
  resetSchemaCommand,
  restoreCommand,
} from './backup-command';

const db = parseDatabaseUrl(
  'postgresql://postgres:p%40ss@localhost:5432/edu_db?schema=public',
);

describe('parseDatabaseUrl', () => {
  it('decodes parts and drops query parameters', () => {
    expect(db).toEqual({
      user: 'postgres',
      password: 'p@ss',
      host: 'localhost',
      port: '5432',
      database: 'edu_db',
    });
  });

  it('defaults the port and rejects garbage', () => {
    expect(parseDatabaseUrl('postgresql://u:p@db/x').port).toBe('5432');
    expect(() => parseDatabaseUrl('nonsense')).toThrow('Invalid DATABASE_URL');
    expect(() => parseDatabaseUrl('postgresql://u:p@db/')).toThrow(
      'Invalid DATABASE_URL',
    );
    expect(passwordOf(undefined)).toBe('');
    expect(passwordOf('nonsense')).toBe('');
    expect(passwordOf('postgresql://u:secret@db/x')).toBe('secret');
  });
});

describe('dumpCommand', () => {
  it('runs pg_dump inside the container and streams stdout', () => {
    const { spec, stdoutToFile } = dumpCommand(
      db,
      'edu_postgres',
      'C:/b/x.part',
    );
    expect(spec).toEqual({
      command: 'docker',
      args: [
        'exec',
        '-e',
        'PGPASSWORD',
        'edu_postgres',
        'pg_dump',
        '-U',
        'postgres',
        '-d',
        'edu_db',
        '-Fc',
        '--exclude-table-data="BackupRun"',
      ],
      env: { PGPASSWORD: 'p@ss' },
    });
    expect(stdoutToFile).toBe(true);
  });

  it('runs a local pg_dump writing the file itself', () => {
    const { spec, stdoutToFile } = dumpCommand(db, null, 'C:/b/x.part');
    expect(spec).toEqual({
      command: 'pg_dump',
      args: [
        '-h',
        'localhost',
        '-p',
        '5432',
        '-U',
        'postgres',
        '-d',
        'edu_db',
        '-Fc',
        '--exclude-table-data="BackupRun"',
        '-f',
        'C:/b/x.part',
      ],
      env: { PGPASSWORD: 'p@ss' },
    });
    expect(stdoutToFile).toBe(false);
  });

  it('never puts the password into arguments', () => {
    for (const container of ['edu_postgres', null]) {
      expect(dumpCommand(db, container, 'f').spec.args.join(' ')).not.toContain(
        'p@ss',
      );
      expect(
        restoreCommand(db, container, 'f').spec.args.join(' '),
      ).not.toContain('p@ss');
      expect(resetSchemaCommand(db, container).args.join(' ')).not.toContain(
        'p@ss',
      );
    }
  });
});

describe('restoreCommand', () => {
  it('feeds the file to pg_restore inside the container', () => {
    const { spec, stdinFromFile } = restoreCommand(
      db,
      'edu_postgres',
      'C:/b/x.dump',
    );
    expect(spec.command).toBe('docker');
    expect(spec.args).toEqual([
      'exec',
      '-i',
      '-e',
      'PGPASSWORD',
      'edu_postgres',
      'pg_restore',
      '--no-owner',
      '--exit-on-error',
      '-U',
      'postgres',
      '-d',
      'edu_db',
    ]);
    expect(stdinFromFile).toBe(true);
  });

  it('passes the file to a local pg_restore', () => {
    const { spec, stdinFromFile } = restoreCommand(db, null, 'C:/b/x.dump');
    expect(spec.args).toEqual([
      '--no-owner',
      '--exit-on-error',
      '-h',
      'localhost',
      '-p',
      '5432',
      '-U',
      'postgres',
      '-d',
      'edu_db',
      'C:/b/x.dump',
    ]);
    expect(stdinFromFile).toBe(false);
  });
});

describe('resetSchemaCommand', () => {
  const sql = 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;';

  it('runs psql inside the container', () => {
    expect(resetSchemaCommand(db, 'edu_postgres')).toEqual({
      command: 'docker',
      args: [
        'exec',
        '-e',
        'PGPASSWORD',
        'edu_postgres',
        'psql',
        '-U',
        'postgres',
        '-d',
        'edu_db',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        sql,
      ],
      env: { PGPASSWORD: 'p@ss' },
    });
  });

  it('runs a local psql', () => {
    expect(resetSchemaCommand(db, null)).toEqual({
      command: 'psql',
      args: [
        '-h',
        'localhost',
        '-p',
        '5432',
        '-U',
        'postgres',
        '-d',
        'edu_db',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        sql,
      ],
      env: { PGPASSWORD: 'p@ss' },
    });
  });
});

describe('maskSecret', () => {
  it('masks every occurrence and truncates', () => {
    expect(maskSecret('bad p@ss and p@ss', 'p@ss')).toBe('bad *** and ***');
    expect(maskSecret('nothing', '')).toBe('nothing');
    expect(maskSecret('x'.repeat(3000), 'p').length).toBe(2000);
  });
});
