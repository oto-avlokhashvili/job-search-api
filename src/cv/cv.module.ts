import { forwardRef, Module } from '@nestjs/common';
import { CvService } from './cv.service';
import { CvController } from './cv.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cv } from 'src/Entities/cv.entity';
import { R2StorageService } from './r2-storage.service';
import { CvParserService } from './cv-parser.service';
import { AiModule } from 'src/ai/ai.module';

@Module({
  imports: [TypeOrmModule.forFeature([Cv]), forwardRef(() => AiModule)],
  controllers: [CvController],
  providers: [CvService, R2StorageService, CvParserService],
  exports: [CvService, R2StorageService, CvParserService],
})
export class CvModule {}
