import { forwardRef, Module } from '@nestjs/common';
import { CvService } from './cv.service';
import { CvController } from './cv.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cv } from 'src/Entities/cv.entity';
import { R2StorageService } from './r2-storage.service';
import { CvParserService } from './cv-parser.service';
import { AiModule } from 'src/ai/ai.module';
import { JobModule } from 'src/job/job.module';
import { PublicCvLimitsService } from './public-cv-limits.service';
import { PublicCvSearchService } from './public-cv-search.service';
import { TurnstileService } from './turnstile.service';

@Module({
  imports: [TypeOrmModule.forFeature([Cv]), forwardRef(() => AiModule), forwardRef(() => JobModule)],
  controllers: [CvController],
  providers: [CvService, R2StorageService, CvParserService, PublicCvLimitsService, PublicCvSearchService, TurnstileService],
  exports: [CvService, R2StorageService, CvParserService, PublicCvLimitsService],
})
export class CvModule {}
