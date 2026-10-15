import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PermissionArea, PermissionLevel, Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Permission } from '../common/decorators/permission.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AttendancesService } from './attendances.service';
import { CreateAttendanceDto } from './dto/create-attendance.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('subscriptions/:subscriptionId/attendances')
export class AttendancesController {
  constructor(private service: AttendancesService) {}

  @Roles(Role.teacher)
  @Permission(PermissionArea.classes, PermissionLevel.edit)
  @Post()
  create(
    @Param('subscriptionId') subscriptionId: string,
    @Body() dto: CreateAttendanceDto,
  ) {
    return this.service.create(subscriptionId, dto);
  }

  @Roles(Role.teacher)
  @Permission(PermissionArea.classes, PermissionLevel.view)
  @Get()
  findAll(@Param('subscriptionId') subscriptionId: string) {
    return this.service.findBySubscription(subscriptionId);
  }

  @Permission(PermissionArea.classes, PermissionLevel.edit)
  @Delete(':id')
  delete(
    @Param('subscriptionId') subscriptionId: string,
    @Param('id') id: string,
  ) {
    return this.service.delete(subscriptionId, id);
  }
}
