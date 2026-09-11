import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EmailService } from './email.service';
import { EmailController } from './email.controller';
import { EmailProcessor } from './email.processor';
import { UserModule } from '../user/user.module';
import { AiMatchedJobsModule } from '../ai-matched-jobs/ai-matched-jobs.module';
import { SentJobsModule } from '../sent-jobs/sent-jobs.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'email',
    }),
    forwardRef(() => UserModule),
    AiMatchedJobsModule,
    SentJobsModule,
  ],
  controllers: [EmailController],
  providers: [EmailService, EmailProcessor],
  exports: [EmailService, BullModule],
})
export class EmailModule {}
