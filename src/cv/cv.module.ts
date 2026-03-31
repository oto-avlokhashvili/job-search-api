import { Module } from '@nestjs/common';
import { CvService } from './cv.service';
import { CvController } from './cv.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cv } from 'src/Entities/cv.entity';
import { SupabaseStorageService } from './supabase-storage.service';

@Module({
  imports: [TypeOrmModule.forFeature([Cv])],
  controllers: [CvController],
  providers: [CvService, SupabaseStorageService],
})
export class CvModule { }
