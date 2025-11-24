import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { JobService } from 'src/job/job.service';

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private bot: TelegramBot;
  private chatId: number | null = null;
  private jobQueue: any[] = [];
  private isActive: boolean = false; // Track if sending is active
  
  // Search query - change this to filter jobs
  private readonly SEARCH_QUERY = 'angular'; // Change to your search term

  constructor(private readonly jobService: JobService) {}

  onModuleInit() {
    const token = '8340426021:AAEy1dSIM-4WhRoIskQoKnPXRzgrSmsNKas';
    this.bot = new TelegramBot(token, { polling: true });
    this.setupCommands();
    this.logger.log('✅ Telegram Bot successfully started and running!');
  }

  private setupCommands() {
    this.bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      this.logger.log(`✅ /start command received from user: ${chatId}`);
      await this.startSendingJobs(chatId);
    });

    this.bot.onText(/\/stop/, async (msg) => {
      const chatId = msg.chat.id;
      this.stopSendingJobs(chatId);
    });

    this.bot.on('polling_error', (error) => {
      this.logger.error('❌ Polling error:', error.message);
    });
  }

  private async startSendingJobs(chatId: number) {
    try {
      this.chatId = chatId;
      this.isActive = true;
      
      await this.bot.sendMessage(chatId, `🔍 Searching for jobs: "${this.SEARCH_QUERY}"...`);
      this.logger.log(`📤 Loading jobs for user: ${chatId}`);
      
      const allJobs = await this.jobService.findAllByQuery(this.SEARCH_QUERY);
      
      // Filter jobs by search query
      this.jobQueue = allJobs.filter(job => {
        const searchTerm = this.SEARCH_QUERY.toLowerCase();
        const vacancy = (job.vacancy || '').toLowerCase();
        const company = (job.company || '').toLowerCase();
        return vacancy.includes(searchTerm) || company.includes(searchTerm);
      });
      
      if (this.jobQueue.length === 0) {
        await this.bot.sendMessage(chatId, `❌ No jobs found matching: "${this.SEARCH_QUERY}"`);
        this.logger.log(`⚠️ No matching jobs found for user: ${chatId}`);
        this.stopSendingJobs(chatId);
        return;
      }

      await this.bot.sendMessage(
        chatId,
        `✅ Found ${this.jobQueue.length} matching jobs!\n\n` +
        `📤 Sending first job now...\n` +
        `⏰ Next jobs will arrive every 10 minutes.`
      );
      
      this.logger.log(`✅ Found ${this.jobQueue.length} matching jobs for user: ${chatId}`);
      
      // Send first job immediately
      await this.sendNextJob();
      
    } catch (error) {
      this.logger.error(`❌ Error loading jobs for user ${chatId}:`, error.message);
      await this.bot.sendMessage(chatId, '❌ Error loading jobs from database');
      this.stopSendingJobs(chatId);
    }
  }

  private stopSendingJobs(chatId: number) {
    if (this.chatId === chatId || this.chatId === null) {
      const wasActive = this.isActive;
      this.chatId = null;
      this.jobQueue = [];
      this.isActive = false;
      
      if (wasActive) {
        this.bot.sendMessage(chatId, '🛑 Job sending stopped.');
        this.logger.log(`✅ Stopped sending jobs to user: ${chatId}`);
      } else {
        this.bot.sendMessage(chatId, 'No active job sending. Use /start to begin.');
      }
    } else {
      this.bot.sendMessage(chatId, 'No active job sending. Use /start to begin.');
    }
  }

  async sendNextJob() {
    // If not active or no more jobs, stop everything
    if (!this.isActive || !this.chatId || this.jobQueue.length === 0) {
      if (this.chatId && this.isActive) {
        await this.bot.sendMessage(this.chatId, '✅ All matching jobs have been sent! 🎉');
        this.logger.log(`✅ All jobs sent to user: ${this.chatId}. Stopping...`);
        
        const chatIdToStop = this.chatId;
        this.chatId = null;
        this.jobQueue = [];
        this.isActive = false;
        
        // Send final stop message
        await this.bot.sendMessage(chatIdToStop, '🛑 Job sending completed and stopped automatically.');
      }
      return;
    }

    const job = this.jobQueue.shift(); // Get and remove first job
    const remaining = this.jobQueue.length;

    try {
      let message = `💼 New Job (${remaining} remaining):\n\n`;
      message += `📋 ${job.vacancy || 'Untitled'}\n`;
      if (job.company) message += `🏢 ${job.company}\n`;
      if (job.deadline) message += `📅 Deadline: ${job.deadline}\n`;
      if (job.link) message += `🔗 ${job.link}\n`;

      await this.bot.sendMessage(this.chatId, message, { disable_web_page_preview: true });
      this.logger.log(`✅ Sent job to user ${this.chatId}, ${remaining} jobs remaining`);
      
    } catch (error) {
      this.logger.error(`❌ Error sending job to user ${this.chatId}:`, error.message);
      this.stopSendingJobs(this.chatId);
    }
  }

  // Method called by ScheduleService
  async processScheduledJob() {
    // Only process if active
    if (this.isActive) {
      await this.sendNextJob();
    }
  }

  // Getter to check if bot is active
  isJobSendingActive(): boolean {
    return this.isActive;
  }
}