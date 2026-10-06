import { Injectable, Logger } from '@nestjs/common';
import { InjectFlowProducer, InjectQueue } from '@nestjs/bullmq';
import { FlowJob, FlowJobNode, FlowProducer, Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { JobService, SCRAPE_SOURCE_PRIORITY, ScrapeSource } from './job.service';

export const SCRAPE_QUEUE = 'scrape';
export const ENRICH_QUEUE = 'enrich';
export const SCRAPE_FLOW = 'scrape-flow';

export interface ScrapeSourceJobData {
  source: ScrapeSource;
  runId: string;
}

export interface ScrapeMergeJobData {
  runId: string;
}

const sourceJobOpts = {
  attempts: 2,
  backoff: { type: 'exponential', delay: 60_000 },
  // A failed source must not block the sources that depend on it
  ignoreDependencyOnFailure: true,
  removeOnComplete: { age: 24 * 3600 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

@Injectable()
export class ScrapeQueueService {
  private readonly logger = new Logger(ScrapeQueueService.name);

  constructor(
    @InjectFlowProducer(SCRAPE_FLOW) private readonly flowProducer: FlowProducer,
    @InjectQueue(SCRAPE_QUEUE) private readonly scrapeQueue: Queue,
    @InjectQueue(ENRICH_QUEUE) private readonly enrichQueue: Queue,
    private readonly jobService: JobService,
  ) {}

  private sourceNode(source: ScrapeSource, runId: string): FlowJobNode {
    return {
      name: 'scrape-source',
      queueName: SCRAPE_QUEUE,
      data: { source, runId } satisfies ScrapeSourceJobData,
      opts: sourceJobOpts,
    };
  }

  /**
   * Enqueues the full multi-source scrape as a flow: every source scrapes in parallel and stages its
   * results, then a single merge job dedupes across sources and the DB (in priority order) and inserts.
   */
  async enqueueDailyScrape(): Promise<{ flowId: string; runId: string }> {
    const runId = randomUUID();
    const tree: FlowJob = {
      name: 'scrape-merge',
      queueName: SCRAPE_QUEUE,
      data: { runId } satisfies ScrapeMergeJobData,
      opts: {
        attempts: 2,
        backoff: { type: 'fixed', delay: 30_000 },
        removeOnComplete: { age: 24 * 3600 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
      children: SCRAPE_SOURCE_PRIORITY.map((source) => this.sourceNode(source, runId)),
    };

    const node = await this.flowProducer.add(tree);
    this.logger.log(`Queued scrape flow ${node.job.id} (run ${runId})`);
    return { flowId: node.job.id as string, runId };
  }

  /**
   * Enqueues one description-enrichment job per job that is missing a description.
   * jobId makes re-runs idempotent while a previous job for the same row is still retained.
   */
  async enqueueEnrichment(): Promise<{ queuedCount: number }> {
    const ids = await this.jobService.getJobIdsNeedingEnrichment();
    if (ids.length === 0) return { queuedCount: 0 };

    const chunkSize = 1000;
    for (let i = 0; i < ids.length; i += chunkSize) {
      await this.enrichQueue.addBulk(
        ids.slice(i, i + chunkSize).map((jobId) => ({
          name: 'enrich-description',
          data: { jobId },
          opts: {
            jobId: `enrich-${jobId}`,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: { age: 3600 },
            removeOnFail: { age: 24 * 3600 },
          },
        })),
      );
    }

    this.logger.log(`Queued ${ids.length} description enrichment jobs`);
    return { queuedCount: ids.length };
  }

  /**
   * Returns the state of every job in a scrape flow, keyed by source.
   */
  async getFlowStatus(flowId: string) {
    const tree = await this.flowProducer.getFlow({ id: flowId, queueName: SCRAPE_QUEUE, depth: 10 });
    if (!tree) return null;

    const steps: { name: string; source?: string; state: string; result?: any; failedReason?: string }[] = [];
    const walk = async (node: any) => {
      for (const child of node.children ?? []) await walk(child);
      // The flow tree is a snapshot; re-read each job so state and result are consistent
      const job = (await this.scrapeQueue.getJob(node.job.id)) ?? node.job;
      steps.push({
        name: job.name,
        source: job.data?.source,
        state: await job.getState(),
        result: job.returnvalue ?? undefined,
        failedReason: job.failedReason || undefined,
      });
    };
    await walk(tree);

    const finalState = steps[steps.length - 1].state;
    return { flowId, state: finalState, steps };
  }
}
