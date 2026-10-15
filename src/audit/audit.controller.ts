import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { PermissionArea, PermissionLevel } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Permission } from '../common/decorators/permission.decorator';
import { AuditService } from './audit.service';
import {
  AuditChangesQueryDto,
  AuditEventsQueryDto,
  AuthEventsQueryDto,
} from './dto/audit-query.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Permission(PermissionArea.audit, PermissionLevel.view)
@Controller('audit')
export class AuditController {
  constructor(private audit: AuditService) {}

  @Get('events')
  events(@Query() query: AuditEventsQueryDto) {
    return this.audit.listEvents(query);
  }

  @Get('events/:id')
  event(@Param('id') id: string) {
    return this.audit.getEvent(id);
  }

  @Get('changes')
  changes(@Query() query: AuditChangesQueryDto) {
    return this.audit.listChanges(query);
  }

  @Get('auth')
  auth(@Query() query: AuthEventsQueryDto) {
    return this.audit.listAuth(query);
  }
}
