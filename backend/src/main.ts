import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { corsOptions } from './common/cors-options';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3001);
  const logger = new Logger('Bootstrap');

  // Prefijo global de la API
  app.setGlobalPrefix('api/v1');

  // Seguridad
  // Helmet debe ir antes de CORS para no bloquear las cabeceras CORS
  app.use(cookieParser());
  app.enableCors(corsOptions(config.get('FRONTEND_URL', 'http://localhost:3000')));
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  // Validación global de DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Swagger — solo en desarrollo
  if (config.get('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('K13Group API')
      .setDescription('API REST de la plataforma K13Group')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
    logger.log(`Swagger disponible en http://localhost:${port}/api/docs`);
  }

  await app.listen(port);
  logger.log(`Backend activo en http://localhost:${port}/api/v1`);
}

bootstrap();
