import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';

import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Railway's edge proxy sits in front of the app; trust its X-Forwarded-For so req.ip
  // is the real caller instead of the proxy (used for per-IP rate limits).
  app.set('trust proxy', 1);
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  }));
  
  // Updated CORS configuration to allow credentials
app.enableCors({
  origin: ['http://localhost:4200', 'https://job-search-app-production-d867.up.railway.app', 'https://www.jobup.ge', 'https://jobup.ge'], // ← removed trailing slash
  credentials: true,
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  allowedHeaders: 'Content-Type, Authorization',
});

  // Swagger configuration
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('API Documentation')
      .setDescription('The API description')
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', in: 'header' },
        'bearerAuth',
      )
      .addApiKey({ type: 'apiKey', in: 'header', name: 'X-Internal-Key' }, 'internalKey')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api', app, document);
  }

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();