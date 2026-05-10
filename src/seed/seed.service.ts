// src/seed/seed.service.ts
import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    const login = this.config.get<string>('ROOT_LOGIN')!;
    const existing = await this.prisma.user.findUnique({ where: { login } });
    if (existing) return;

    const rawPassword = this.config.get<string>('ROOT_PASSWORD')!;
    const hash = await bcrypt.hash(rawPassword, 10);
    await this.prisma.user.create({
      data: {
        login,
        password: hash,
        role: 'root',
        firstName: 'Root',
        lastName: 'Admin',
      },
    });
    this.logger.log(`Root user "${login}" created`);
  }
}
