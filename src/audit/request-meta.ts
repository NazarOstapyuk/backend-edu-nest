import type { Request } from 'express';

export type RequestMeta = { ip: string | null; userAgent: string | null };

export const requestMeta = (
  req: Pick<Request, 'ip' | 'headers'>,
): RequestMeta => ({
  ip: req.ip ?? null,
  userAgent: req.headers['user-agent']?.slice(0, 500) ?? null,
});
