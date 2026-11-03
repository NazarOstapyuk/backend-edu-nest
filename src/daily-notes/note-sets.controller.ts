import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PermissionArea, PermissionLevel } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permission } from '../common/decorators/permission.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { CreateNoteSetDto } from './dto/create-note-set.dto';
import { UpdateNoteSetDto } from './dto/update-note-set.dto';
import { NoteSetsService } from './note-sets.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Permission(PermissionArea.register, PermissionLevel.edit)
@Controller('note-sets')
export class NoteSetsController {
  constructor(private noteSets: NoteSetsService) {}

  @Permission(PermissionArea.register, PermissionLevel.view)
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.noteSets.list(user);
  }

  @Post()
  create(
    @Body() dto: CreateNoteSetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.noteSets.create(dto, user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateNoteSetDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.noteSets.update(id, dto, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.noteSets.remove(id, user);
  }
}
