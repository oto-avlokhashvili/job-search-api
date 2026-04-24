import { forwardRef, Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { CvModule } from 'src/cv/cv.module';
import { SupabaseStorageService } from 'src/cv/supabase-storage.service';
import { JobModule } from 'src/job/job.module';
import { UserModule } from 'src/user/user.module';

@Module({
  imports: [CvModule, forwardRef(() => JobModule), UserModule],
  controllers: [AiController],
  providers: [AiService, SupabaseStorageService],
  exports: [AiService],
})
export class AiModule { }
