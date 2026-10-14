export interface DbConfig {
  user: string;
  password: string;
  host: string;
  port: string;
  database: string;
}

export interface CommandSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

const MAX_ERROR = 2000;

export function parseDatabaseUrl(url: string): DbConfig {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid DATABASE_URL');
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!parsed.hostname || !database) throw new Error('Invalid DATABASE_URL');
  return {
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    host: parsed.hostname,
    port: parsed.port || '5432',
    database,
  };
}

export function passwordOf(url: string | undefined): string {
  try {
    return parseDatabaseUrl(url ?? '').password;
  } catch {
    return '';
  }
}

const passwordEnv = (db: DbConfig) => ({ PGPASSWORD: db.password });

const connection = (db: DbConfig) => [
  '-h',
  db.host,
  '-p',
  db.port,
  '-U',
  db.user,
  '-d',
  db.database,
];

export function dumpCommand(
  db: DbConfig,
  container: string | null,
  file: string,
): { spec: CommandSpec; stdoutToFile: boolean } {
  if (container)
    return {
      spec: {
        command: 'docker',
        args: [
          'exec',
          '-e',
          'PGPASSWORD',
          container,
          'pg_dump',
          '-U',
          db.user,
          '-d',
          db.database,
          '-Fc',
        ],
        env: passwordEnv(db),
      },
      stdoutToFile: true,
    };
  return {
    spec: {
      command: 'pg_dump',
      args: [...connection(db), '-Fc', '-f', file],
      env: passwordEnv(db),
    },
    stdoutToFile: false,
  };
}

const RESTORE_FLAGS = ['--clean', '--if-exists', '--no-owner'];

export function restoreCommand(
  db: DbConfig,
  container: string | null,
  file: string,
): { spec: CommandSpec; stdinFromFile: boolean } {
  if (container)
    return {
      spec: {
        command: 'docker',
        args: [
          'exec',
          '-i',
          '-e',
          'PGPASSWORD',
          container,
          'pg_restore',
          ...RESTORE_FLAGS,
          '-U',
          db.user,
          '-d',
          db.database,
        ],
        env: passwordEnv(db),
      },
      stdinFromFile: true,
    };
  return {
    spec: {
      command: 'pg_restore',
      args: [...RESTORE_FLAGS, ...connection(db), file],
      env: passwordEnv(db),
    },
    stdinFromFile: false,
  };
}

export function maskSecret(text: string, secret: string): string {
  const masked = secret ? text.split(secret).join('***') : text;
  return masked.slice(0, MAX_ERROR);
}
