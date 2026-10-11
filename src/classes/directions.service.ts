import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { kyivToday } from '../tariffs/dates';
import { directionInclude, toDirectionView } from './class-views';
import { CreateDirectionDto } from './dto/create-direction.dto';
import { UpdateDirectionDto } from './dto/update-direction.dto';

@Injectable()
export class DirectionsService {
  constructor(private prisma: PrismaService) {}

  async list(today: Date = kyivToday()) {
    const directions = await this.prisma.direction.findMany({
      include: directionInclude,
      orderBy: { name: 'asc' },
    });
    return directions.map((d) => toDirectionView(d, today));
  }

  private async get(id: string) {
    const direction = await this.prisma.direction.findUnique({ where: { id } });
    if (!direction) throw new NotFoundException('Direction not found');
    return direction;
  }

  private async assertNameFree(name: string) {
    const existing = await this.prisma.direction.findUnique({
      where: { name },
    });
    if (existing)
      throw new BadRequestException('Direction with this name already exists');
  }

  async create(dto: CreateDirectionDto) {
    await this.assertNameFree(dto.name);
    await this.prisma.direction.create({
      data: { name: dto.name, missedRule: dto.missedRule },
    });
    return this.list();
  }

  async update(id: string, dto: UpdateDirectionDto) {
    const direction = await this.get(id);
    if (dto.name !== undefined && dto.name !== direction.name)
      await this.assertNameFree(dto.name);
    await this.prisma.direction.update({
      where: { id },
      data: {
        name: dto.name,
        missedRule: dto.missedRule,
        isActive: dto.isActive,
      },
    });
    return this.list();
  }

  async delete(id: string) {
    await this.get(id);
    const [groups, packages] = await Promise.all([
      this.prisma.classGroup.count({ where: { directionId: id } }),
      this.prisma.package.count({ where: { directionId: id } }),
    ]);
    if (groups + packages > 0)
      throw new BadRequestException('Cannot delete: direction is in use');
    await this.prisma.direction.delete({ where: { id } });
    return this.list();
  }
}
