import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import { TelegramService } from 'src/telegram/telegram.service';
import { JobService } from 'src/job/job.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name);

  constructor(
    private readonly telegramService: TelegramService,
    private readonly jobsService: JobService,
    private readonly emailService: EmailService,
  ) { }
  @Cron('10 23 * * *')
  async scrappper(): Promise<void> {
    this.logger.log('🚀 Starting scheduled full scrape (jobs.ge + hr.ge + awork.ge + myjobs.ge) with deduplication...');
    const result = await this.jobsService.scrapeAndSaveAll();
    this.logger.log(
      `✅ Scheduled scrape completed: ${result.uniqueInsertedCount} total unique jobs saved into DB`,
    );
  }


  @Cron('40 06 * * *')
  async removeOutdated(): Promise<void> {
    this.logger.log('🚀 Removing Outdated started');
    const result = await this.jobsService.removeOutdated();
    this.logger.log(`🚀 Removed ${result.deletedCount} outdated jobs`);
  }

  @Cron('00 07 * * *')
  async analyzeJobs() {
    await this.telegramService.runDailyAnalysis();
  }

  /* @Cron('00 08 * * *')
  async analyzeJobsSecondRun() {
    await this.telegramService.runDailyAnalysis();
  } */
  
  @Cron('00 10 * * *')
  async startTelegramBot() {
    this.logger.log('🚀 Starting Telegram bot via cron...');
    await this.telegramService.startBot();
  }

  @Cron('40 10 * * *')
  async stopTelegramBot() {
    this.logger.log('🛑 Stopping Telegram bot via cron...');
    await this.telegramService.stopBot();
  }

  @Cron('00 09 * * *')
  async sendDailyEmails() {
    this.logger.log('✉️ Starting daily job alerts email dispatch...');
    await this.emailService.sendDailyEmailAlerts();
  }
}
