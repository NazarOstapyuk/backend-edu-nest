import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, AuthEventType, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { parseDay } from '../classes/access';
import { addDays, isoDay } from '../tariffs/dates';
import { diffFields, kyivDayStart } from './audit-calc';
import { currentRequestId } from './request-context';
import {
  AuditChangesQueryDto,
  AuditEventsQueryDto,
  AuthEventsQueryDto,
} from './dto/audit-query.dto';

const PAGE = 50;
const person = {
  select: { id: true, firstName: true, lastName: true, login: true },
};

type Db = Prisma.TransactionClient | PrismaService;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private prisma: PrismaService) {}

  async recordEvent(input: {
    requestId: string;
    actorId: string | null;
    actorRole: Role | null;
    method: string;
    route: string;
    entityType: string | null;
    entityId: string | null;
    statusCode: number;
    ip: string | null;
    userAgent: string | null;
    body: Prisma.InputJsonValue | null;
  }): Promise<void> {
    try {
      await this.prisma.auditEvent.create({
        data: { ...input, body: input.body ?? Prisma.JsonNull },
      });
    } catch (error) {
      this.logger.error(`Audit event not recorded: ${String(error)}`);
    }
  }

  async recordAuth(input: {
    type: AuthEventType;
    login: string;
    userId: string | null;
    reason: string | null;
    ip: string | null;
    userAgent: string | null;
  }): Promise<void> {
    try {
      await this.prisma.authEvent.create({
        data: { ...input, login: input.login.slice(0, 100) },
      });
    } catch (error) {
      this.logger.error(`Auth event not recorded: ${String(error)}`);
    }
  }

  async recordChange(
    db: Db,
    input: {
      actorId: string | null;
      entityType: string;
      entityId: string;
      action: AuditAction;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
      fields: readonly string[];
    },
  ): Promise<void> {
    const changes = diffFields(input.before, input.after, input.fields);
    if (input.action === AuditAction.update && changes.length === 0) return;
    await db.auditChange.create({
      data: {
        requestId: currentRequestId() ?? '',
        actorId: input.actorId,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        changes,
      },
    });
  }

  private period(from?: string, to?: string) {
    if (!from && !to) return undefined;
    const start = from ? parseDay(from) : null;
    const end = to ? parseDay(to) : null;
    if (start && end && end.getTime() < start.getTime())
      throw new BadRequestException('Invalid period');
    return {
      ...(start ? { gte: kyivDayStart(isoDay(start)) } : {}),
      ...(end ? { lt: kyivDayStart(isoDay(addDays(end, 1))) } : {}),
    };
  }

  private paging(page?: number) {
    const current = page ?? 1;
    return { current, skip: (current - 1) * PAGE, take: PAGE };
  }

  async listEvents(query: AuditEventsQueryDto) {
    const at = this.period(query.from, query.to);
    const where: Prisma.AuditEventWhereInput = {
      ...(at ? { at } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.failedOnly === 'true' ? { statusCode: { gte: 400 } } : {}),
    };
    const { current, skip, take } = this.paging(query.page);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditEvent.findMany({
        where,
        include: { actor: person },
        orderBy: { at: 'desc' },
        skip,
        take,
      }),
      this.prisma.auditEvent.count({ where }),
    ]);
    return { items, total, page: current };
  }

  async getEvent(id: string) {
    const event = await this.prisma.auditEvent.findUnique({
      where: { id },
      include: { actor: person },
    });
    if (!event) throw new NotFoundException('Audit event not found');
    const changes = await this.prisma.auditChange.findMany({
      where: { requestId: event.requestId },
      orderBy: { at: 'asc' },
    });
    return { ...event, changes };
  }

  async listChanges(query: AuditChangesQueryDto) {
    const where = { entityType: query.entityType, entityId: query.entityId };
    const { current, skip, take } = this.paging(query.page);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditChange.findMany({
        where,
        include: { actor: person },
        orderBy: { at: 'desc' },
        skip,
        take,
      }),
      this.prisma.auditChange.count({ where }),
    ]);
    return { items, total, page: current };
  }

  async listAuth(query: AuthEventsQueryDto) {
    const at = this.period(query.from, query.to);
    const where: Prisma.AuthEventWhereInput = {
      ...(at ? { at } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.login
        ? {
            login: {
              contains: query.login,
              mode: Prisma.QueryMode.insensitive,
            },
          }
        : {}),
      ...(query.type ? { type: query.type } : {}),
    };
    const { current, skip, take } = this.paging(query.page);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.authEvent.findMany({
        where,
        include: { user: person },
        orderBy: { at: 'desc' },
        skip,
        take,
      }),
      this.prisma.authEvent.count({ where }),
    ]);
    return { items, total, page: current };
  }
}
