import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { parseTime } from './meals-calc';

const DEADLINE_KEY = 'mealOrderDeadline';
const DEFAULT_DEADLINE = '10:00';

@Injectable()
export class MealSettingsService {
  constructor(private prisma: PrismaService) {}

  async getDeadline(): Promise<string> {
    const setting = await this.prisma.appSetting.findUnique({
      where: { key: DEADLINE_KEY },
    });
    return setting && parseTime(setting.value) !== null
      ? setting.value
      : DEFAULT_DEADLINE;
  }

  async setDeadline(value: string) {
    if (parseTime(value) === null)
      throw new BadRequestException('Invalid deadline');
    await this.prisma.appSetting.upsert({
      where: { key: DEADLINE_KEY },
      create: { key: DEADLINE_KEY, value },
      update: { value },
    });
    return { mealOrderDeadline: value };
  }
}
