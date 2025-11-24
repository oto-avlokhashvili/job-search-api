import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import { TelegramService } from './telegram.service';
import { ScraperService } from './scrapper.service';

@Injectable()
export class ScheduleService {
    private readonly logger = new Logger(ScheduleService.name);

    constructor(private readonly telegramService: TelegramService, private readonly scraperService: ScraperService) { }
    @Cron(CronExpression.EVERY_11_HOURS)
    async scrape() {
        const result = await this.scraperService.scrapeJobs('', 1, {
            maxJobs: 100,
            delayBetweenRequests: 2000,
            maxPages: 17
        });
    }
    @Cron(CronExpression.EVERY_10_MINUTES)
    async handleCron() {
        if (this.telegramService.isJobSendingActive()) {
            this.logger.log('⏰ Scheduled job - sending next job...');
            await this.telegramService.processScheduledJob();
        } else {
            this.logger.debug('⏸️ Scheduler running but no active job sending');
        }
    }
}
