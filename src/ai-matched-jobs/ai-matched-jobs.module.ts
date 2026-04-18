import { Module } from '@nestjs/common';
import { AiMatchedJobsService } from './ai-matched-jobs.service';
import { AiMatchedJobsController } from './ai-matched-jobs.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiMatchedJob } from 'src/Entities/ai-matched-job.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AiMatchedJob])],
  controllers: [AiMatchedJobsController],
  providers: [AiMatchedJobsService],
  exports: [AiMatchedJobsService]
})
export class AiMatchedJobsModule {}
