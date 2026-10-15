import { Prisma } from '@prisma/client';

export type FieldChange = {
  field: string;
  before: string | null;
  after: string | null;
};

const SECRET_KEYS = new Set([
  'password',
  'currentPassword',
  'newPassword',
  'refreshToken',
  'accessToken',
  'token',
]);
const MAX_BODY = 10_000;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SKIPPED = new Set([
  '/auth/login',
  '/auth/refresh',
  '/auth/logout',
  '/me/password',
]);

export function normalizeValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (value instanceof Prisma.Decimal) return value.toFixed(2);
  if (value instanceof Date) {
    const iso = value.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
  }
  if (Array.isArray(value))
    return value
      .map((item) => normalizeValue(item) ?? '')
      .sort()
      .join(', ');
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  )
    return String(value);
  return JSON.stringify(value) ?? null;
}

export function diffFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  fields: readonly string[],
): FieldChange[] {
  return fields.flatMap((field) => {
    const was = before ? normalizeValue(before[field]) : null;
    const now = after ? normalizeValue(after[field]) : null;
    return was === now ? [] : [{ field, before: was, after: now }];
  });
}

const strip = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === 'object' && !(value instanceof Date))
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SECRET_KEYS.has(key))
        .map(([key, item]) => [key, strip(item)]),
    );
  return value;
};

export function sanitizeBody(body: unknown): Prisma.InputJsonValue | null {
  if (body === undefined || body === null) return null;
  const clean = strip(body);
  const json = JSON.stringify(clean);
  if (json === undefined) return null;
  if (json.length > MAX_BODY) return { truncated: true, size: json.length };
  return JSON.parse(json) as Prisma.InputJsonValue;
}

export function entityFromRoute(
  route: string,
  params: Record<string, string>,
  responseId: string | null,
): { entityType: string | null; entityId: string | null } {
  const path = route.slice(route.indexOf(' ') + 1);
  const entityType = path.split('/').filter(Boolean)[0] ?? null;
  const entityId =
    params.id ?? params.childId ?? params.teacherId ?? responseId ?? null;
  return { entityType, entityId };
}

export function shouldRecordEvent(method: string, path: string): boolean {
  if (!MUTATING.has(method.toUpperCase())) return false;
  return !SKIPPED.has(path.split('?')[0]);
}

export function kyivDayStart(day: string): Date {
  const utcMidnight = new Date(`${day}T00:00:00.000Z`);
  const zone =
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Kyiv',
      timeZoneName: 'shortOffset',
    })
      .formatToParts(utcMidnight)
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT+2';
  const hours = Number(zone.replace('GMT', '') || '0');
  return new Date(utcMidnight.getTime() - hours * 3_600_000);
}
