import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, forwardRef, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { TelegramService } from './telegram.service';

export interface SendUserTelegramAlertJobData {
  userId: number;
}

export interface SendDirectTelegramMessageJobData {
  chatId: string | number;
  text: string;
  options?: any;
}

@Processor('telegram', {
  concurrency: 2, // Process up to 2 user alert batches simultaneously
  limiter: {
    max: 20, // Max 20 messages per second (Telegram global limit is 30/s)
    duration: 1000,
  },
})
export class TelegramProcessor extends WorkerHost {
  private readonly logger = new Logger(TelegramProcessor.name);

  constructor(
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`[TelegramProcessor] Processing job ${job.id} of type "${job.name}"...`);

    switch (job.name) {
      case 'send-user-telegram-alerts': {
        const data = job.data as SendUserTelegramAlertJobData;
        const result = await this.telegramService.processUserTelegramAlert(data.userId);
        this.logger.log(
          `[TelegramProcessor] Completed Telegram alert processing for user ID ${data.userId} (job: ${job.id}): ${JSON.stringify(result)}`,
        );
        return result;
      }

      case 'send-direct-telegram-message': {
        const data = job.data as SendDirectTelegramMessageJobData;
        const result = await this.telegramService.sendDirectMessage(
          data.chatId,
          data.text,
          data.options,
        );
        this.logger.log(
          `[TelegramProcessor] Successfully sent direct Telegram message to ${data.chatId} (job: ${job.id})`,
        );
        return result;
      }

      default:
        this.logger.warn(`[TelegramProcessor] Unknown job name "${job.name}" for job ${job.id}`);
        return null;
    }
  }
}
