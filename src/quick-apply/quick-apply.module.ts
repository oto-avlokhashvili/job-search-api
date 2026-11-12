import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cv } from 'src/Entities/cv.entity';
import { JobEntity } from 'src/Entities/job.entity';
import { JobApplication } from 'src/Entities/job-application.entity';
import { CvModule } from 'src/cv/cv.module';
import { EmailModule } from 'src/email/email.module';
import { QuickApplyController } from './quick-apply.controller';
import { QUICK_APPLY_QUEUE, QuickApplyService } from './quick-apply.service';
import { QuickApplyProcessor } from './quick-apply.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([JobApplication, JobEntity, Cv]),
    BullModule.registerQueue({ name: QUICK_APPLY_QUEUE }),
    CvModule,
    EmailModule,
  ],
  controllers: [QuickApplyController],
  providers: [QuickApplyService, QuickApplyProcessor],
})
export class QuickApplyModule {}
