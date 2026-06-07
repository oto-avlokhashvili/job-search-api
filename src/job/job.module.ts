import { Module } from '@nestjs/common';
import { JobService } from './job.service';
import { JobController } from './job.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobEntity } from 'src/Entities/job.entity';
import { ScrapersModule } from '../scrapers/scrapers.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([JobEntity]),
    ScrapersModule,
  ],
  controllers: [JobController],
  providers: [JobService],
  exports: [JobService],
})
export class JobModule { }
