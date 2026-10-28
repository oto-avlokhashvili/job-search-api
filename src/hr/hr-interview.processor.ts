import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { HrInterviewService, INTERVIEW_QUEUE, ReminderJob } from './hr-interview.service';

// Delayed interview reminders (24h and 1h before a confirmed interview).
@Processor(INTERVIEW_QUEUE)
export class HrInterviewProcessor extends WorkerHost {
  private readonly logger = new Logger(HrInterviewProcessor.name);

  constructor(private readonly interviewService: HrInterviewService) {
    super();
  }

  async process(job: Job<ReminderJob>): Promise<void> {
    if (job.name !== 'reminder') {
      this.logger.warn(`Unknown job "${job.name}" (${job.id})`);
      return;
    }
    await this.interviewService.sendReminder(job.data);
  }
}
