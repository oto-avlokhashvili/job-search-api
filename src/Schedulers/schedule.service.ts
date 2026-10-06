import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import { TelegramService } from 'src/telegram/telegram.service';
import { JobService } from 'src/job/job.service';
import { EmailService } from '../email/email.service';
import { AiService } from '../ai/ai.service';
import { ScrapeQueueService } from '../job/scrape-queue.service';

@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name);

  constructor(
    private readonly telegramService: TelegramService,
    private readonly jobsService: JobService,
    private readonly emailService: EmailService,
    private readonly aiService: AiService,
    private readonly scrapeQueueService: ScrapeQueueService,
  ) { }
  @Cron('10 23 * * *')
  async scrappper(): Promise<void> {
    this.logger.log('🚀 Queueing scheduled full scrape (jobs.ge + hr.ge + awork.ge + myjobs.ge + linkedin.com)...');
    const { flowId } = await this.scrapeQueueService.enqueueDailyScrape();
    this.logger.log(`✅ Scrape flow ${flowId} queued`);
  }


  @Cron('40 06 * * *')
  async removeOutdated(): Promise<void> {
    this.logger.log('🚀 Removing Outdated started');
    const result = await this.jobsService.removeOutdated();
    this.logger.log(`🚀 Removed ${result.deletedCount} outdated jobs`);
  }

  @Cron('00 07 * * *')
  async analyzeJobs() {
    this.logger.log('🤖 Starting scheduled daily AI analysis queue dispatch...');
    await this.aiService.dispatchDailyAiAnalysis();
  }

  /* @Cron('00 08 * * *')
  async analyzeJobsSecondRun() {
    await this.telegramService.runDailyAnalysis();
  } */
  
  @Cron('00 10 * * *')
  async sendDailyTelegramAlerts() {
    this.logger.log('🚀 Starting daily Telegram job alerts dispatch...');
    await this.telegramService.dispatchDailyTelegramAlerts();
  }

  @Cron('00 09 * * *')
  async sendDailyEmails() {
    this.logger.log('✉️ Starting daily job alerts email dispatch...');
    await this.emailService.sendDailyEmailAlerts();
  }
}
