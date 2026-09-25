import { forwardRef, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { AiProcessor } from './ai.processor';
import { CvModule } from 'src/cv/cv.module';
import { JobModule } from 'src/job/job.module';
import { UserModule } from 'src/user/user.module';
import { AiMatchedJobsModule } from 'src/ai-matched-jobs/ai-matched-jobs.module';
import { CvParserService } from 'src/cv/cv-parser.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'ai',
    }),
    CvModule,
    forwardRef(() => JobModule),
    forwardRef(() => UserModule),
    forwardRef(() => AiMatchedJobsModule),
  ],
  controllers: [AiController],
  providers: [AiService, AiProcessor, CvParserService],
  exports: [AiService, BullModule],
})
export class AiModule {}
