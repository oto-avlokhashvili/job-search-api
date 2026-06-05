import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import { JobsGeScraperService } from '../scrapers/jobs-ge.scraper';
import { TelegramService } from 'src/telegram/telegram.service';
import { JobService } from 'src/job/job.service';

@Injectable()
export class ScheduleService {
  private readonly logger = new Logger(ScheduleService.name);

  constructor(private readonly telegramService: TelegramService, private readonly scraperService: JobsGeScraperService, private readonly jobsService: JobService) { }
  @Cron('10 06 * * *')
  async scrappper(): Promise<void> {
    await this.jobsService.scrapper();
  }


  @Cron('10 07 * * *')
  async removeOutdated(): Promise<void> {
    await this.jobsService.removeOutdated();
  }

  @Cron('00 10 * * *')
  async analyzeJobs() {
    await this.telegramService.runDailyAnalysis();
  }

  @Cron('10 10 * * *')
  async startTelegramBot() {
    this.logger.log('🚀 Starting Telegram bot via cron...');
    await this.telegramService.startBot();
  }

  @Cron('40 10 * * *')
  async stopTelegramBot() {
    this.logger.log('🛑 Stopping Telegram bot via cron...');
    await this.telegramService.stopBot();
  }
}
