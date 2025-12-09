import { forwardRef, Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { JobModule } from 'src/job/job.module';
import { UserModule } from 'src/user/user.module';
import { SentJobsModule } from 'src/sent-jobs/sent-jobs.module';
@Module({
  imports:[forwardRef(() => JobModule), UserModule, SentJobsModule],
  controllers: [TelegramController],
  providers: [TelegramService],
  exports: [TelegramService], 
})
export class TelegramModule {}
