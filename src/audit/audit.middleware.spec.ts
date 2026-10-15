import { EventEmitter } from 'node:events';
import { Role } from '@prisma/client';
import { AuditMiddleware } from './audit.middleware';
import { setResponseId } from './request-context';

const makeRes = () => Object.assign(new EventEmitter(), { statusCode: 200 });

describe('AuditMiddleware', () => {
  const audit = { recordEvent: jest.fn() };
  const middleware = new AuditMiddleware(audit as never);

  beforeEach(() => audit.recordEvent.mockReset().mockResolvedValue(undefined));

  it('records a mutation after the response, with user, status and sanitized body', () => {
    const req = {
      method: 'PATCH',
      originalUrl: '/children/c1',
      baseUrl: '',
      route: { path: '/children/:id' },
      params: { id: 'c1' },
      body: { firstName: 'A', password: 'secret' },
      headers: { 'user-agent': 'jest' },
      ip: '::1',
      user: { id: 'u1', role: Role.admin },
    };
    const res = makeRes();
    middleware.use(req as never, res as never, () => undefined);
    expect(audit.recordEvent).not.toHaveBeenCalled();
    res.statusCode = 403;
    res.emit('finish');
    expect(audit.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'u1',
        actorRole: Role.admin,
        route: 'PATCH /children/:id',
        entityType: 'children',
        entityId: 'c1',
        statusCode: 403,
        body: { firstName: 'A' },
      }),
    );
  });

  it('uses the created id captured during the request', () => {
    const req = {
      method: 'POST',
      originalUrl: '/tariffs',
      baseUrl: '',
      route: { path: '/tariffs' },
      params: {},
      body: {},
      headers: {},
      ip: '::1',
    };
    const res = makeRes();
    middleware.use(req as never, res as never, () => setResponseId('t1'));
    res.emit('finish');
    expect(audit.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 't1', actorId: null }),
    );
  });

  it('skips reads and auth routes', () => {
    for (const [method, url] of [
      ['GET', '/children'],
      ['POST', '/auth/login'],
      ['POST', '/me/password'],
    ]) {
      const res = makeRes();
      middleware.use(
        {
          method,
          originalUrl: url,
          baseUrl: '',
          params: {},
          headers: {},
        } as never,
        res as never,
        () => undefined,
      );
      res.emit('finish');
    }
    expect(audit.recordEvent).not.toHaveBeenCalled();
  });
});
