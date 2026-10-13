# Database backups design

Date: 2026-10-13. Status: approved in brainstorming, awaiting spec review.

First sub-project of Part «Звіти та захист» (order chosen by the user: backups → access separation and change history → reports with Excel export).

## Goal

The database is copied automatically every night to a folder that the user's cloud client (Google Drive / OneDrive for desktop) syncs off the machine. The head sees in the admin panel whether backups work and can make a copy on demand. A copy can be restored by a documented command.

## Decisions

| Topic | Decision |
|---|---|
| Where the system runs | The user's Windows PC: backend via npm, Postgres in Docker (`edu_postgres`) |
| Storage | A folder synced to the cloud, path in `.env` (`BACKUP_DIR`) |
| Schedule and retention | Daily at 02:00 Europe/Kyiv; keep the last 30 daily copies plus the newest copy of each of the last 12 months (Q4 A) |
| Encryption | None for now; relies on the cloud account (Q5 B) |
| Restore | Manual command with the backend stopped; a safety copy is made first (Q6 A) |
| Mechanism | The backend itself runs `pg_dump` from a NestJS cron (approach 1); no new npm dependencies |

## Configuration

`.env` (documented in `CLAUDE.md` Environment section):

- `BACKUP_DIR`: absolute folder path. Not set or empty → backups are disabled; the API reports `configured: false`, the cron does nothing.
- `BACKUP_PG_CONTAINER`: Docker container with Postgres, default `edu_postgres`. Set to an empty string to call a local `pg_dump` / `pg_restore` from `PATH` instead.

Connection data (user, password, host, port, database) are parsed from `DATABASE_URL`. With Docker the command is `docker exec -e PGPASSWORD=<password> <container> pg_dump -U <user> -d <db> -Fc` and stdout is streamed to the file; without Docker `pg_dump -h <host> -p <port> -U <user> -d <db> -Fc -f <path>` with `PGPASSWORD` in the environment. The password is passed only through the environment, never as an argument, and never logged.

## Data model

`BackupRun` (history of attempts):

- `id`, `kind` enum `BackupKind`: `scheduled`, `manual`, `pre_restore`.
- `status` enum `BackupStatus`: `running`, `succeeded`, `failed`.
- `fileName` nullable (set on success), `sizeBytes` BigInt nullable.
- `error` nullable (first 2000 characters of stderr / error message, with the password masked).
- `startedAt`, `finishedAt` nullable, `createdById` nullable (manual runs; `User`, `onDelete: Restrict`).
- `@@index([startedAt])`.

Users who created backup runs cannot be deleted (added to the existing user delete guard, same message).

## Creating a copy

- File name: `edu_db_YYYY-MM-DD_HHmmss.dump` (scheduled), `edu_db_YYYY-MM-DD_HHmmss_manual.dump`, `edu_db_YYYY-MM-DD_HHmmss_pre-restore.dump`; time in Europe/Kyiv (seconds avoid name clashes between two quick manual copies).
- The dump is written to `<name>.part`; on exit code 0 and size > 0 it is renamed to `<name>`; otherwise the `.part` file is removed and the run is `failed`.
- Only one copy runs at a time per process: a second request gets 409 `Backup is already running`. At startup every `running` row (left by a stopped process; the backend runs as a single process) is marked `failed` with error `Interrupted`.
- Timeout 10 minutes: the process is killed and the run is `failed` with error `Timed out`.
- The `BACKUP_DIR` folder is created if missing (`mkdir -p`); an unwritable folder fails the run with the OS error.
- Scheduled run: `@Cron('0 2 * * *', { timeZone: 'Europe/Kyiv' })`, errors are caught and stored, never thrown out of the scheduler.

## Retention

Pure function in `src/backups/backup-retention.ts`, applied after every successful copy, only to files in `BACKUP_DIR` matching our name pattern (`.part` files and foreign files are never touched):

- `scheduled`: keep the newest 30; additionally keep the newest scheduled file of each of the 12 most recent calendar months that have one.
- `manual`: keep those younger than 30 days.
- `pre_restore`: never deleted automatically.
- Deletion errors are logged and ignored (a locked file in a syncing folder must not fail the backup).

## API

Controller `backups`, `@Roles(root, admin)`:

- `GET /backups` →
  `{ configured: boolean, dir: string | null, running: boolean, lastSuccess: RunView | null, lastFailure: RunView | null, stale: boolean, files: [{ name, kind, sizeBytes, takenAt }] }`, `takenAt` = Kyiv local time parsed from the file name (`YYYY-MM-DDTHH:mm:ss`, no zone).
  `stale` = configured and (no success yet, or the last success is older than 26 hours, or the last run failed). `files` newest first; `sizeBytes` as a number (copies are far below 2^53). `dir` is shown so the head can check the path.
- `POST /backups` → creates a manual copy and waits for it (≤ 10 min) → `RunView`. 400 `Backups are not configured` when `BACKUP_DIR` is empty; 409 `Backup is already running`.
- `GET /backups/runs` → last 50 runs, newest first.
- `RunView`: `{ id, kind, status, fileName, sizeBytes, error, startedAt, finishedAt, createdBy: { id, firstName, lastName } | null }`.

There is no download, delete or restore endpoint.

## Restore

`npm run backup:restore -- <file name or path>` → `scripts/backup-restore.ts` (run with `ts-node` already present, or compiled; no new dependency):

1. Reads `.env`, resolves the file inside `BACKUP_DIR` if a bare name is given; missing file → exit 1.
2. Refuses to run while the backend answers on `PORT` (default 3000): prints «Stop the backend first» and exits 1.
3. Asks for confirmation by typing the database name (skipped with `--yes`).
4. Makes a `pre_restore` copy into `BACKUP_DIR` with the same dump command (not recorded in `BackupRun`: the restore replaces that table anyway); if it fails, the restore is aborted.
5. Runs `pg_restore --clean --if-exists --no-owner -d <db>` (through `docker exec -i` with the file on stdin, or locally).
6. Prints the result; non-zero exit on failure, leaving the pre-restore copy for rollback.

Step-by-step instructions (including restoring on a new PC: install Docker, `docker compose up -d`, `npx prisma migrate deploy` is NOT needed before restore because the dump contains the schema) go to `docs/backups.md`.

## Frontend

- Page «Резервні копії» (`/backups`, nav item for root/admin): state card (налаштовано / не налаштовано з підказкою про `BACKUP_DIR`, остання успішна копія, остання помилка), button «Зробити копію зараз» (disabled while running; spinner; result in a snackbar), table of files (назва, тип, розмір, дата), table of the last runs with errors.
- Dashboard banner for root/admin when `configured` is false or `stale` is true: «Резервні копії не налаштовані» / «Остання резервна копія невдала або застаріла» with a link to `/backups`.
- New error messages translated: `Backups are not configured` → «Резервні копії не налаштовані», `Backup is already running` → «Копія вже створюється».

## Errors (new messages)

| Status | Message |
|---|---|
| 400 | `Backups are not configured` |
| 409 | `Backup is already running` |

## Testing

- `backup-retention.spec.ts` (pure): 40 daily files → newest 30 kept plus month representatives; manual files older than 30 days removed; pre-restore and foreign files untouched; months with no file skipped; parsing of file names (kind and timestamp).
- `backups.service.spec.ts` with mocked process runner and file system: success renames `.part` and records size; non-zero exit removes `.part` and stores masked error; timeout; concurrent call → 409; not configured → 400; stale computation; startup cleanup of interrupted runs.
- Command building is a pure function (`backup-command.ts`) tested for the Docker and local variants, including that the password is never in the argument list.

## Out of scope

Encryption, downloading or deleting copies from the UI, restore from the UI, off-site copies other than via the synced folder, backing up uploaded files (there are none yet).
