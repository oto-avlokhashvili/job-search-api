import { Module, forwardRef } from '@nestjs/common';
import { JobService } from './job.service';
import { JobController } from './job.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobEntity } from 'src/Entities/job.entity';
import { ScheduleService } from 'src/Schedulers/schedule.service';
import { ScraperService } from 'src/Schedulers/scrapper.service';
import { TelegramModule } from 'src/telegram/telegram.module';

@Module({
  imports: [TypeOrmModule.forFeature([JobEntity])],
  controllers: [JobController],
  providers: [
    JobService,
    TelegramModule,
    {
      provide: ScraperService,
      useClass: ScraperService,
    },
  ],
  exports: [JobService, ScraperService],
})
export class JobModule {}
