import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { pgConfig } from 'dbConfig';
import { JobModule } from './job/job.module';
import { ScheduleModule } from '@nestjs/schedule';
import { ScheduleService } from './Schedulers/schedule.service';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegramModule } from './telegram/telegram.module';
import { SentJobsModule } from './sent-jobs/sent-jobs.module';
import { AiModule } from './ai/ai.module';
import { CvModule } from './cv/cv.module';
import { AiMatchedJobsModule } from './ai-matched-jobs/ai-matched-jobs.module';
import { ScrapersModule } from './scrapers/scrapers.module';
import { EmailModule } from './email/email.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisUrl =
          configService.get<string>('REDIS_URL') ||
          process.env.REDIS_URL ||
          configService.get<string>('REDIS_PUBLIC_URL') ||
          process.env.REDIS_PUBLIC_URL ||
          configService.get<string>('REDIS_PRIVATE_URL') ||
          process.env.REDIS_PRIVATE_URL;

        if (redisUrl) {
          try {
            const parsed = new URL(redisUrl);
            return {
              connection: {
                host: parsed.hostname,
                port: Number(parsed.port) || 6379,
                username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
                password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
                tls: parsed.protocol === 'rediss:' ? {} : undefined,
                maxRetriesPerRequest: null,
              },
            };
          } catch {
            return {
              connection: {
                url: redisUrl,
                maxRetriesPerRequest: null,
              },
            };
          }
        }

        return {
          connection: {
            host: configService.get<string>('REDIS_HOST') || process.env.REDIS_HOST || 'localhost',
            port: Number(configService.get<number>('REDIS_PORT') || process.env.REDIS_PORT) || 6379,
            password: configService.get<string>('REDIS_PASSWORD') || process.env.REDIS_PASSWORD || undefined,
            maxRetriesPerRequest: null,
          },
        };
      },
    }),
    TypeOrmModule.forRoot(pgConfig),
    JobModule,
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 60,
      },
    ]),
    UserModule,
    TelegramModule,
    AuthModule,
    SubscriptionModule,
    SentJobsModule,
    AiModule,
    CvModule,
    AiMatchedJobsModule,
    ScrapersModule,
    EmailModule,
  ],
  controllers: [AppController],
  providers: [AppService, ScheduleService],
})
export class AppModule {}
