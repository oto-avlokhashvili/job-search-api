import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { pgConfig } from 'dbConfig';
import { JobModule } from './job/job.module';
import { ScheduleModule } from '@nestjs/schedule';
import { ScheduleService } from './Schedulers/schedule.service';
import { ScraperService } from './Schedulers/scrapper.service';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { TelegramModule } from './telegram/telegram.module';
import { SentJobsModule } from './sent-jobs/sent-jobs.module';

@Module({
  imports: [TypeOrmModule.forRoot(pgConfig), JobModule, ScheduleModule.forRoot(), UserModule, TelegramModule, AuthModule , ConfigModule.forRoot({
    isGlobal:true
  }), SentJobsModule],
  controllers: [AppController],
  providers: [AppService, ScheduleService],
  
})
export class AppModule {}
