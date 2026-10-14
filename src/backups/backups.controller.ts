import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { BackupKind, Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { BackupsService } from './backups.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.root, Role.admin)
@Controller('backups')
export class BackupsController {
  constructor(private backups: BackupsService) {}

  @Get()
  status() {
    return this.backups.status();
  }

  @Get('runs')
  runs() {
    return this.backups.runs();
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser) {
    return this.backups.create(BackupKind.manual, user.id);
  }
}
