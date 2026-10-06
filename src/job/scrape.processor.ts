import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { JobService } from './job.service';
import { SCRAPE_QUEUE, ScrapeMergeJobData, ScrapeQueueService, ScrapeSourceJobData } from './scrape-queue.service';

@Processor(SCRAPE_QUEUE, {
  concurrency: 5, // one slot per source so all sources scrape in parallel
  lockDuration: 5 * 60_000,
})
export class ScrapeProcessor extends WorkerHost {
  private readonly logger = new Logger(ScrapeProcessor.name);

  constructor(
    private readonly jobService: JobService,
    private readonly scrapeQueueService: ScrapeQueueService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    switch (job.name) {
      case 'scrape-source': {
        const { source, runId } = job.data as ScrapeSourceJobData;
        return this.jobService.scrapeSourceToStaging(source, runId);
      }

      case 'scrape-merge': {
        const { runId } = job.data as ScrapeMergeJobData;
        const failures = await job.getIgnoredChildrenFailures();
        for (const [key, reason] of Object.entries(failures)) {
          this.logger.error(`Scrape step ${key} failed: ${reason}`);
        }

        const merge = await this.jobService.mergeStagedJobs(runId);
        for (const r of merge.perSource) {
          this.logger.log(
            `[${r.source}] staged ${r.staged}, ${r.duplicatesRemoved} duplicates removed, ${r.inserted} inserted`,
          );
        }
        this.logger.log(
          `Scrape flow complete: ${merge.totalInserted} unique jobs saved, ${Object.keys(failures).length} sources failed`,
        );

        const { queuedCount } = await this.scrapeQueueService.enqueueEnrichment();
        return { ...merge, failedSteps: Object.keys(failures), enrichmentQueued: queuedCount };
      }

      default:
        this.logger.warn(`Unknown job name "${job.name}" for job ${job.id}`);
        return null;
    }
  }
}
