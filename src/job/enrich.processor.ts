import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { JobService } from './job.service';
import { ENRICH_QUEUE } from './scrape-queue.service';

export interface EnrichDescriptionJobData {
  jobId: number;
}

@Processor(ENRICH_QUEUE, {
  concurrency: 1,
  // Replaces the old manual 1.5s sleep between detail-page requests
  limiter: { max: 1, duration: 1500 },
})
export class EnrichProcessor extends WorkerHost {
  private readonly logger = new Logger(EnrichProcessor.name);

  constructor(private readonly jobService: JobService) {
    super();
  }

  async process(job: Job<EnrichDescriptionJobData, any, string>): Promise<any> {
    switch (job.name) {
      case 'enrich-description': {
        const saved = await this.jobService.enrichJobDescription(job.data.jobId);
        if (saved) this.logger.log(`Saved description for job ${job.data.jobId}`);
        return { jobId: job.data.jobId, saved };
      }

      default:
        this.logger.warn(`Unknown job name "${job.name}" for job ${job.id}`);
        return null;
    }
  }
}
