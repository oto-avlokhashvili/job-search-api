import { forwardRef, Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { JobModule } from 'src/job/job.module';
import { UserModule } from 'src/user/user.module';
@Module({
  imports:[forwardRef(() => JobModule), UserModule],
  controllers: [TelegramController],
  providers: [TelegramService],
  exports: [TelegramService], 
})
export class TelegramModule {}
