import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, forwardRef, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AiService } from './ai.service';

export interface AnalyzeUserCvJobData {
  userId: number;
}

@Processor('ai', {
  concurrency: 2,
  limiter: {
    max: 15,
    duration: 60000,
  },
})
export class AiProcessor extends WorkerHost {
  private readonly logger = new Logger(AiProcessor.name);

  constructor(
    @Inject(forwardRef(() => AiService))
    private readonly aiService: AiService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`[AiProcessor] Processing job ${job.id} of type "${job.name}"...`);

    switch (job.name) {
      case 'analyze-user-cv': {
        const data = job.data as AnalyzeUserCvJobData;
        const result = await this.aiService.jobsearchWithCv(data.userId);
        if (result?.comment?.includes('AI-ს შეცდომა')) {
          throw new Error(`AI analysis temporary failure for user ${data.userId}: ${result.comment}`);
        }
        const topJobsCount = result?.response?.topJobs?.length ?? 0;
        this.logger.log(
          `[AiProcessor] Completed AI analysis for user ID ${data.userId} (job: ${job.id}): ${result.comment} — ${topJobsCount} top jobs`,
        );
        return result;
      }

      default:
        this.logger.warn(`[AiProcessor] Unknown job name "${job.name}" for job ${job.id}`);
        return null;
    }
  }
}
