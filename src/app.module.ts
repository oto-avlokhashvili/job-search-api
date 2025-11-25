import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { pgConfig } from 'dbConfig';
import { JobModule } from './job/job.module';
import { ScheduleModule } from '@nestjs/schedule';
import { ScheduleService } from './Schedulers/schedule.service';
import { TelegramService } from './Schedulers/telegram.service';
import { ScraperService } from './Schedulers/scrapper.service';
import { UserModule } from './user/user.module';

@Module({
  imports: [TypeOrmModule.forRoot(pgConfig), JobModule, ScheduleModule.forRoot(), UserModule],
  controllers: [AppController],
  providers: [AppService, ScheduleService, ScraperService],
  
})
export class AppModule {}
