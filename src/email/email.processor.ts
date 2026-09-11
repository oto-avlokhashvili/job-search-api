import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { EmailService } from './email.service';

export interface SendEmailJobData {
  to: string;
  subject: string;
  html: string;
  senderEmail?: string;
  senderName?: string;
}

export interface SendUserAlertJobData {
  userId: number;
}

@Processor('email', {
  concurrency: 5, // Process up to 5 email jobs simultaneously
})
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(private readonly emailService: EmailService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`[EmailProcessor] Processing job ${job.id} of type "${job.name}"...`);

    switch (job.name) {
      case 'send-email': {
        const data = job.data as SendEmailJobData;
        const result = await this.emailService.sendDirectEmail(
          data.to,
          data.subject,
          data.html,
          data.senderEmail,
          data.senderName,
        );
        this.logger.log(`[EmailProcessor] Successfully sent email to ${data.to} (job: ${job.id})`);
        return result;
      }

      case 'send-user-alert': {
        const data = job.data as SendUserAlertJobData;
        const result = await this.emailService.processUserDailyAlert(data.userId);
        this.logger.log(
          `[EmailProcessor] Completed alert processing for user ID ${data.userId} (job: ${job.id}): ${JSON.stringify(result)}`,
        );
        return result;
      }

      default:
        this.logger.warn(`[EmailProcessor] Unknown job name "${job.name}" for job ${job.id}`);
        return null;
    }
  }
}
