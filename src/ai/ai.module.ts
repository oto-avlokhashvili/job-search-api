import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { CvModule } from 'src/cv/cv.module';
import { SupabaseStorageService } from 'src/cv/supabase-storage.service';
import { JobModule } from 'src/job/job.module';

@Module({
  imports: [CvModule, JobModule],
  controllers: [AiController],
  providers: [AiService, SupabaseStorageService],
})
export class AiModule { }
