import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { setResponseId } from './request-context';

@Injectable()
export class AuditResponseInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      tap((data: unknown) => {
        if (data && typeof data === 'object' && 'id' in data) {
          const id = data.id;
          if (typeof id === 'string') setResponseId(id);
        }
      }),
    );
  }
}
