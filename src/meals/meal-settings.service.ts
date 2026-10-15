import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { parseTime } from './meals-calc';

export const DEADLINE_KEY = 'mealOrderDeadline';
export const DEFAULT_DEADLINE = '10:00';

@Injectable()
export class MealSettingsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async getDeadline(): Promise<string> {
    const setting = await this.prisma.appSetting.findUnique({
      where: { key: DEADLINE_KEY },
    });
    return setting && parseTime(setting.value) !== null
      ? setting.value
      : DEFAULT_DEADLINE;
  }

  async setDeadline(value: string, userId: string) {
    if (parseTime(value) === null)
      throw new BadRequestException('Invalid deadline');
    const previous = await this.getDeadline();
    await this.prisma.appSetting.upsert({
      where: { key: DEADLINE_KEY },
      create: { key: DEADLINE_KEY, value },
      update: { value },
    });

    await this.audit.recordChange(this.prisma, {
      actorId: userId,
      entityType: 'settings',
      entityId: 'mealOrderDeadline',
      action: AuditAction.update,
      before: { value: String(previous) },
      after: { value: String(value) },
      fields: ['value'],
    });
    return { mealOrderDeadline: value };
  }
}
