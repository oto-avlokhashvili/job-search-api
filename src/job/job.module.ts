import { Module, forwardRef } from '@nestjs/common';
import { JobService } from './job.service';
import { JobController } from './job.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobEntity } from 'src/Entities/job.entity';
import { ScheduleService } from 'src/Schedulers/schedule.service';
import { TelegramService } from 'src/Schedulers/telegram.service';
import { ScraperService } from 'src/Schedulers/scrapper.service';

@Module({
  imports: [TypeOrmModule.forFeature([JobEntity])],
  controllers: [JobController],
  providers: [
    JobService,
    TelegramService,
    {
      provide: ScraperService,
      useClass: ScraperService,
    },
  ],
  exports: [JobService, TelegramService, ScraperService],
})
export class JobModule {}
