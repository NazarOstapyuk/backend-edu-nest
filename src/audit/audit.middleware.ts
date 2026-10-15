import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { entityFromRoute, sanitizeBody, shouldRecordEvent } from './audit-calc';
import { AuditService } from './audit.service';
import { responseIdReader, runWithRequest } from './request-context';
import { requestMeta } from './request-meta';

type RoutedRequest = Omit<Request, 'route'> & {
  route?: { path?: string };
  user?: AuthenticatedUser;
};

@Injectable()
export class AuditMiddleware implements NestMiddleware {
  constructor(private audit: AuditService) {}

  use(req: RoutedRequest, res: Response, next: NextFunction) {
    const requestId = randomUUID();
    runWithRequest(requestId, () => {
      const readResponseId = responseIdReader();
      res.on('finish', () => {
        if (!shouldRecordEvent(req.method, req.originalUrl)) return;
        const path = req.route?.path
          ? `${req.baseUrl}${req.route.path}`
          : req.originalUrl.split('?')[0];
        const route = `${req.method} ${path}`;
        const params = (req.params ?? {}) as Record<string, string>;
        const { entityType, entityId } = entityFromRoute(
          route,
          params,
          readResponseId(),
        );
        const meta = requestMeta(req);
        void this.audit.recordEvent({
          requestId,
          actorId: req.user?.id ?? null,
          actorRole: req.user?.role ?? null,
          method: req.method,
          route,
          entityType,
          entityId,
          statusCode: res.statusCode,
          ip: meta.ip,
          userAgent: meta.userAgent,
          body: sanitizeBody(req.body),
        });
      });
      next();
    });
  }
}
