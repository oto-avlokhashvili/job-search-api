import { Module, forwardRef } from '@nestjs/common';
import { EmailService } from './email.service';
import { EmailController } from './email.controller';
import { UserModule } from '../user/user.module';
import { AiMatchedJobsModule } from '../ai-matched-jobs/ai-matched-jobs.module';
import { SentJobsModule } from '../sent-jobs/sent-jobs.module';

@Module({
  imports: [forwardRef(() => UserModule), AiMatchedJobsModule, SentJobsModule],
  controllers: [EmailController],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
