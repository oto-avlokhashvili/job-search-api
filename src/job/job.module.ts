import { Module } from '@nestjs/common';
import { JobService } from './job.service';
import { JobController } from './job.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobEntity } from 'src/Entities/job.entity';
import { ScheduleService } from 'src/Schedulers/schedule.service';
import { TelegramService } from 'src/Schedulers/telegram.service';
import { ScraperService } from 'src/Schedulers/scrapper.service';

@Module({
  imports:[TypeOrmModule.forFeature([JobEntity])],
  controllers: [JobController],
  providers: [JobService, TelegramService, ScraperService],
  exports: [JobService, TelegramService]
})
export class JobModule {}
