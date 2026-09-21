import { forwardRef, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { TelegramProcessor } from './telegram.processor';
import { JobModule } from 'src/job/job.module';
import { UserModule } from 'src/user/user.module';
import { SentJobsModule } from 'src/sent-jobs/sent-jobs.module';
import { AiMatchedJobsModule } from 'src/ai-matched-jobs/ai-matched-jobs.module';
import { AiModule } from 'src/ai/ai.module';
import { CvModule } from 'src/cv/cv.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'telegram',
    }),
    forwardRef(() => JobModule),
    UserModule,
    SentJobsModule,
    AiMatchedJobsModule,
    AiModule,
    CvModule,
  ],
  controllers: [TelegramController],
  providers: [TelegramService, TelegramProcessor],
  exports: [TelegramService, BullModule],
})
export class TelegramModule {}

