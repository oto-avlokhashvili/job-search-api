import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import { ScraperService } from './scrapper.service';
import { TelegramService } from 'src/telegram/telegram.service';

@Injectable()
export class ScheduleService {
    private readonly logger = new Logger(ScheduleService.name);

    constructor(private readonly telegramService: TelegramService, private readonly scraperService: ScraperService) { }
    /* @Cron(CronExpression.EVERY_10_MINUTES)
    async scrape() {
        const result = await this.scraperService.scrapeJobs('', 1, {
            maxJobs: 100,
            delayBetweenRequests: 2000,
            maxPages: 17
        });
    } */
  @Cron(CronExpression.EVERY_10_SECONDS) // Every 10 minutes
  // @Cron(CronExpression.EVERY_10_SECONDS) // For testing - uncomment this and comment above
  async handleCron() {
    const stats = this.telegramService.getStats();
    
    if (stats.activeUsers > 0) {
      this.logger.log(`⏰ Scheduled job - Processing ${stats.activeUsers} active user(s)...`);
      await this.telegramService.processScheduledJobs();
      this.logger.log(`✅ Scheduled job completed`);
    } else {
      this.logger.debug(`⏸️ Scheduler running - No active users (${stats.totalUsers} total users registered)`);
    }
  }

  // Optional: Run every hour to log statistics
  /* @Cron(CronExpression.EVERY_HOUR)
  async logStatistics() {
    const stats = this.telegramService.getStats();
    this.logger.log('📊 Hourly Statistics:');
    this.logger.log(`   Total Users: ${stats.totalUsers}`);
    this.logger.log(`   Active Users: ${stats.activeUsers}`);
    this.logger.log(`   Inactive Users: ${stats.inactiveUsers}`);
  } */
}
