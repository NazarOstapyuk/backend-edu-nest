import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { dayRange } from '../attendance/register-calc';
import { isoWeekday } from '../timetable/schedule-calc';
import { templateWeek } from './meals-calc';
import { MenusService, parsePeriod } from './menus.service';
import {
  ApplyTemplateDto,
  CreateMenuTemplateDto,
  SaveTemplateItemsDto,
  UpdateMenuTemplateDto,
} from './dto/menu-template.dto';

const templateInclude = {
  items: {
    select: {
      week: true,
      weekday: true,
      dishId: true,
      dish: {
        select: {
          id: true,
          name: true,
          active: true,
          course: { select: { id: true, name: true, sortOrder: true } },
        },
      },
    },
    orderBy: [{ week: 'asc' }, { weekday: 'asc' }],
  },
} satisfies Prisma.MenuTemplateInclude;

@Injectable()
export class MenuTemplatesService {
  constructor(
    private prisma: PrismaService,
    private menus: MenusService,
  ) {}

  list() {
    return this.prisma.menuTemplate.findMany({
      include: templateInclude,
      orderBy: { name: 'asc' },
    });
  }

  private async get(id: string) {
    const template = await this.prisma.menuTemplate.findUnique({
      where: { id },
      include: templateInclude,
    });
    if (!template) throw new NotFoundException('Menu template not found');
    return template;
  }

  async create(dto: CreateMenuTemplateDto) {
    const name = dto.name.trim();
    if (await this.prisma.menuTemplate.findUnique({ where: { name } }))
      throw new ConflictException('Menu template already exists');
    const created = await this.prisma.menuTemplate.create({
      data: { name, weeks: dto.weeks },
    });
    return this.get(created.id);
  }

  async update(id: string, dto: UpdateMenuTemplateDto) {
    const template = await this.get(id);
    const name = dto.name?.trim();
    if (
      name &&
      name !== template.name &&
      (await this.prisma.menuTemplate.findUnique({ where: { name } }))
    )
      throw new ConflictException('Menu template already exists');
    if (
      dto.weeks !== undefined &&
      (await this.prisma.menuTemplateItem.count({
        where: { templateId: id, week: { gt: dto.weeks } },
      }))
    )
      throw new BadRequestException('Template week out of range');
    await this.prisma.menuTemplate.update({
      where: { id },
      data: { name, weeks: dto.weeks, active: dto.active },
    });
    return this.get(id);
  }

  async saveItems(id: string, dto: SaveTemplateItemsDto) {
    const template = await this.get(id);
    if (dto.items.some((i) => i.week > template.weeks))
      throw new BadRequestException('Template week out of range');
    const ids = [...new Set(dto.items.map((i) => i.dishId))];
    const dishes = ids.length
      ? await this.prisma.dish.findMany({
          where: { id: { in: ids } },
          select: { id: true, active: true },
        })
      : [];
    if (dishes.length !== ids.length)
      throw new NotFoundException('Dish not found');
    const current = template.items.map((i) => i.dishId);
    if (dishes.some((d) => !d.active && !current.includes(d.id)))
      throw new BadRequestException('Dish is inactive');
    const seen = new Set<string>();
    const items = dto.items.filter((i) => {
      const key = `${i.week}:${i.weekday}:${i.dishId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.menuTemplateItem.deleteMany({ where: { templateId: id } });
      await tx.menuTemplateItem.createMany({
        data: items.map((i) => ({
          templateId: id,
          week: i.week,
          weekday: i.weekday,
          dishId: i.dishId,
        })),
      });
    });
    return this.get(id);
  }

  async apply(id: string, dto: ApplyTemplateDto, user: AuthenticatedUser) {
    const institutions = await this.menus.resolveInstitutions(
      dto.institutionIds,
      user,
      true,
    );
    const template = await this.get(id);
    if (!template.active)
      throw new BadRequestException('Menu template is inactive');
    if (dto.startWeek > template.weeks)
      throw new BadRequestException('Template week out of range');
    const { from, to } = parsePeriod(dto.from, dto.to, 92);
    const plan = dayRange(from, to)
      .map((date) => {
        const week = templateWeek(from, dto.startWeek, template.weeks, date);
        const weekday = isoWeekday(date);
        return {
          date,
          dishIds: template.items
            .filter(
              (i) => i.week === week && i.weekday === weekday && i.dish.active,
            )
            .map((i) => i.dishId),
        };
      })
      .filter((p) => p.dishIds.length);
    return this.menus.fill(institutions, plan, dto.overwrite ?? false);
  }
}
