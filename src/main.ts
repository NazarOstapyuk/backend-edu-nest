import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const trustProxy = process.env.TRUST_PROXY?.trim();
  app.set(
    'trust proxy',
    trustProxy === 'true' ? true : trustProxy || 'loopback',
  );
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.trim() || 'http://localhost:5173',
    credentials: true,
  });
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
