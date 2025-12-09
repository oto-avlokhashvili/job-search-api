import { Module } from '@nestjs/common';
import { SentJobsService } from './sent-jobs.service';
import { SentJobsController } from './sent-jobs.controller';
import { SentJob } from 'src/Entities/sent-jobs.entity';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports:[TypeOrmModule.forFeature([SentJob])],
  controllers: [SentJobsController],
  providers: [SentJobsService],
  exports: [SentJobsService], 
})
export class SentJobsModule {}
