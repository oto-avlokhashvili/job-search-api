import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import { ScraperService } from './scrapper.service';
import { TelegramService } from 'src/telegram/telegram.service';
import { JobService } from 'src/job/job.service';

@Injectable()
export class ScheduleService {
    private readonly logger = new Logger(ScheduleService.name);

    constructor(private readonly telegramService: TelegramService, private readonly scraperService: ScraperService, private readonly jobsService: JobService) { }
@Cron('34 17 * * *')
async removeOutDated(): Promise<void> {
  await this.jobsService.removeOutDated();
}

@Cron('15 23 * * *')
async startTelegramBot() {
    this.logger.log('🚀 Starting Telegram bot via cron...');
    await this.telegramService.startBot();
}

@Cron('20 23 * * *')
async stopTelegramBot() {
    this.logger.log('🛑 Stopping Telegram bot via cron...');
    await this.telegramService.stopBot();
}
}
