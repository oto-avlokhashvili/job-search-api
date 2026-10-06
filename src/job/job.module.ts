import { forwardRef, Module } from '@nestjs/common';
import { JobService } from './job.service';
import { JobController } from './job.controller';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobEntity } from 'src/Entities/job.entity';
import { ScrapedJobEntity } from 'src/Entities/scraped-job.entity';
import { ScrapersModule } from '../scrapers/scrapers.module';
import { ENRICH_QUEUE, SCRAPE_FLOW, SCRAPE_QUEUE, ScrapeQueueService } from './scrape-queue.service';
import { ScrapeProcessor } from './scrape.processor';
import { EnrichProcessor } from './enrich.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([JobEntity, ScrapedJobEntity]),
    BullModule.registerQueue({ name: SCRAPE_QUEUE }, { name: ENRICH_QUEUE }),
    BullModule.registerFlowProducer({ name: SCRAPE_FLOW }),
    forwardRef(() => ScrapersModule),
  ],
  controllers: [JobController],
  providers: [JobService, ScrapeQueueService, ScrapeProcessor, EnrichProcessor],
  exports: [JobService, ScrapeQueueService],
})
export class JobModule { }
