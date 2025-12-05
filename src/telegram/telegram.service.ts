import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { JobService } from 'src/job/job.service';

interface UserSession {
  chatId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  isActive: boolean;
  jobQueue: any[];
  searchQuery: string;
  startedAt: Date;
}

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private bot: TelegramBot;
  private userSessions: Map<number, UserSession> = new Map();
  
  // Default search query
  private readonly DEFAULT_SEARCH_QUERY = 'ანალიტიკოსი';

  constructor(private readonly jobService: JobService) {
    
  }

  onModuleInit() {
    const token = '8564533553:AAFJs6B3VBOoS2CFUXf0jfQhsSDTBbAniXI';
    this.bot = new TelegramBot(token, { polling: true });
    this.setupCommands();
    this.logger.log('✅ Telegram Bot successfully started and running!');
    this.logger.log('🔗 Bot link: https://t.me/job_notifcation_bot');
  }


  private setupCommands() {
    // Handle /start command - Auto-initialize and start sending jobs
    this.bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      const username = msg.from?.username;
      const firstName = msg.from?.first_name;
      const lastName = msg.from?.last_name;
      
      // Log user information
      this.logger.log('='.repeat(60));
      this.logger.log('🆕 NEW USER STARTED BOT');
      this.logger.log(`📱 Chat ID: ${chatId}`);
      this.logger.log(`👤 Username: @${username || 'N/A'}`);
      this.logger.log(`📝 Name: ${firstName || ''} ${lastName || ''}`);
      this.logger.log(`⏰ Time: ${new Date().toISOString()}`);
      this.logger.log('='.repeat(60));

      // Check if user already exists
      let session = this.userSessions.get(chatId);
      
      if (session) {
        // Existing user
        await this.bot.sendMessage(
          chatId,
          `👋 Welcome back${firstName ? ' ' + firstName : ''}!\n\n` +
          `You're already registered.\n\n` +
          `Current search: "${session.searchQuery}"\n\n` +
          `Commands:\n` +
          `/jobs - Start receiving job notifications\n` +
          `/stop - Stop notifications\n` +
          `/search <query> - Change search term\n` +
          `/status - Check your status`
        );
      } else {
        // New user - create session
        session = {
          chatId,
          username,
          firstName,
          lastName,
          isActive: false,
          jobQueue: [],
          searchQuery: this.DEFAULT_SEARCH_QUERY,
          startedAt: new Date()
        };
        this.userSessions.set(chatId, session);

        await this.bot.sendMessage(
          chatId,
          `👋 Welcome${firstName ? ' ' + firstName : ''} to Job Notification Bot!\n\n` +
          `✅ You're now registered!\n` +
          `🔍 Default search: "${this.DEFAULT_SEARCH_QUERY}"\n\n` +
          `Commands:\n` +
          `/jobs - Start receiving job notifications\n` +
          `/stop - Stop notifications\n` +
          `/search <query> - Change search term\n` +
          `/status - Check your status`
        );

        // Log total users
        this.logger.log(`📊 Total registered users: ${this.userSessions.size}`);
      }
    });

    // Handle /jobs command - Start sending jobs
    this.bot.onText(/\/jobs/, async (msg) => {
      const chatId = msg.chat.id;
      await this.startSendingJobsToUser(chatId);
    });

    // Handle /stop command
    this.bot.onText(/\/stop/, async (msg) => {
      const chatId = msg.chat.id;
      this.stopSendingJobs(chatId);
    });

    // Handle /search command
    this.bot.onText(/\/search (.+)/, async (msg, match) => {
      const chatId = msg.chat.id;
      const searchQuery = match?.[1]?.trim();
      
      if (!searchQuery) {
        await this.bot.sendMessage(chatId, '❌ Please provide a search term.\n\nExample: /search მენეჯერი');
        return;
      }

      const session = this.userSessions.get(chatId);
      if (session) {
        session.searchQuery = searchQuery;
        await this.bot.sendMessage(
          chatId,
          `✅ Search query updated to: "${searchQuery}"\n\n` +
          `Use /jobs to start receiving jobs with this search term.`
        );
        this.logger.log(`🔍 User ${chatId} changed search query to: "${searchQuery}"`);
      } else {
        await this.bot.sendMessage(
          chatId,
          `⚠️ Please use /start first to register.`
        );
      }
    });

    // Handle /status command
    this.bot.onText(/\/status/, async (msg) => {
      const chatId = msg.chat.id;
      const session = this.userSessions.get(chatId);

      if (!session) {
        await this.bot.sendMessage(chatId, '❌ Not registered. Use /start to register.');
        return;
      }

      const statusMsg = 
        `📊 Your Status:\n\n` +
        `✅ Registered: Yes\n` +
        `🔔 Notifications: ${session.isActive ? 'Active' : 'Inactive'}\n` +
        `🔍 Search query: "${session.searchQuery}"\n` +
        `📦 Jobs in queue: ${session.jobQueue.length}\n` +
        `📅 Registered: ${session.startedAt.toLocaleString()}`;

      await this.bot.sendMessage(chatId, statusMsg);
    });

    // Handle /users command (for admin)
    this.bot.onText(/\/users/, async (msg) => {
      const chatId = msg.chat.id;
      
      let usersMsg = `👥 Total Users: ${this.userSessions.size}\n\n`;
      usersMsg += `🔔 Active: ${Array.from(this.userSessions.values()).filter(s => s.isActive).length}\n\n`;
      
      usersMsg += `Recent users:\n`;
      const recentUsers = Array.from(this.userSessions.values())
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
        .slice(0, 10);

      recentUsers.forEach((user, idx) => {
        usersMsg += `${idx + 1}. ${user.firstName || 'User'} (@${user.username || 'N/A'}) - ${user.isActive ? '🟢' : '⚪'}\n`;
      });

      await this.bot.sendMessage(chatId, usersMsg);
    });

    this.bot.on('polling_error', (error) => {
      this.logger.error('❌ Polling error:', error.message);
    });
  }

  /**
   * Start sending jobs to a specific user
   */
  async startSendingJobsToUser(chatId: number): Promise<boolean> {
    try {
      let session = this.userSessions.get(chatId);
      
      if (!session) {
        await this.bot.sendMessage(
          chatId, 
          '⚠️ Please use /start first to register.'
        );
        return false;
      }

      if (session.isActive) {
        await this.bot.sendMessage(
          chatId,
          `⚠️ You're already receiving job notifications!\n\n` +
          `📦 ${session.jobQueue.length} jobs remaining in queue.\n\n` +
          `Use /stop to stop receiving jobs.`
        );
        return false;
      }

      session.isActive = true;
      
      await this.bot.sendMessage(chatId, `🔍 Searching for jobs: "${session.searchQuery}"...`);
      this.logger.log(`📤 Loading jobs for user ${chatId} (@${session.username || 'N/A'})`);
      
      const allJobs = await this.jobService.findAllByQuery(session.searchQuery);
      
      // Filter jobs by search query
      session.jobQueue = allJobs.filter(job => {
        const searchTerm = session.searchQuery.toLowerCase();
        const vacancy = (job.vacancy || '').toLowerCase();
        const company = (job.company || '').toLowerCase();
        return vacancy.includes(searchTerm) || company.includes(searchTerm);
      });
      
      if (session.jobQueue.length === 0) {
        await this.bot.sendMessage(chatId, `❌ No jobs found matching: "${session.searchQuery}"\n\nTry /search to change your search term.`);
        this.logger.log(`⚠️ No matching jobs found for user ${chatId}`);
        session.isActive = false;
        return false;
      }

      await this.bot.sendMessage(
        chatId,
        `✅ Found ${session.jobQueue.length} matching jobs!\n\n` +
        `📤 Sending first job now...\n` +
        `⏰ Next jobs will arrive every 10 seconds.\n\n` +
        `Use /stop to stop receiving jobs.`
      );
      
      this.logger.log(`✅ Found ${session.jobQueue.length} matching jobs for user ${chatId}`);
      
      // Send first job immediately
      await this.sendNextJobToUser(chatId);
      return true;
      
    } catch (error) {
      this.logger.error(`❌ Error loading jobs for user ${chatId}:`, error.message);
      await this.bot.sendMessage(chatId, '❌ Error loading jobs from database. Please try again later.');
      return false;
    }
  }

  /**
   * Stop sending jobs to a specific user
   */
  private stopSendingJobs(chatId: number) {
    const session = this.userSessions.get(chatId);
    
    if (!session) {
      this.bot.sendMessage(chatId, '⚠️ Not registered. Use /start to register.');
      return;
    }

    if (session.isActive) {
      session.isActive = false;
      session.jobQueue = [];
      
      this.bot.sendMessage(chatId, '🛑 Job notifications stopped.\n\nUse /jobs to start again.');
      this.logger.log(`✅ Stopped sending jobs to user ${chatId}`);
    } else {
      this.bot.sendMessage(chatId, 'ℹ️ No active notifications. Use /jobs to start receiving jobs.');
    }
  }

  /**
   * Send next job to a specific user
   */
  async sendNextJobToUser(chatId: number) {
    const session = this.userSessions.get(chatId);
    
    if (!session || !session.isActive || session.jobQueue.length === 0) {
      if (session && session.isActive) {
        await this.bot.sendMessage(chatId, '✅ All matching jobs have been sent! 🎉\n\nUse /jobs to search for new jobs.');
        this.logger.log(`✅ All jobs sent to user ${chatId}. Stopping...`);
        
        session.isActive = false;
        session.jobQueue = [];
      }
      return;
    }

    const job = session.jobQueue.shift();
    const remaining = session.jobQueue.length;

    try {
      let message = `💼 New Job (${remaining} remaining):\n\n`;
      message += `📋 ${job.vacancy || 'Untitled'}\n`;
      if (job.company) message += `🏢 ${job.company}\n`;
      if (job.deadline) message += `📅 Deadline: ${job.deadline}\n`;
      if (job.link) message += `🔗 ${job.link}\n`;

      await this.bot.sendMessage(chatId, message, { disable_web_page_preview: true });
      this.logger.log(`✅ Sent job to user ${chatId}, ${remaining} jobs remaining`);
      
    } catch (error) {
      this.logger.error(`❌ Error sending job to user ${chatId}:`, error.message);
      this.stopSendingJobs(chatId);
    }
  }

  /**
   * Process scheduled jobs for all active users
   * Call this from your ScheduleService every 10 minutes
   */
  async processScheduledJobs() {
    const activeSessions = Array.from(this.userSessions.values()).filter(s => s.isActive);
    
    if (activeSessions.length === 0) {
      return;
    }

    this.logger.log(`⏰ Processing scheduled jobs for ${activeSessions.length} active users...`);
    
    for (const session of activeSessions) {
      await this.sendNextJobToUser(session.chatId);
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    const allSessions = Array.from(this.userSessions.values());
    return {
      totalUsers: this.userSessions.size,
      activeUsers: allSessions.filter(s => s.isActive).length,
      inactiveUsers: allSessions.filter(s => !s.isActive).length,
      users: allSessions.map(s => ({
        chatId: s.chatId,
        username: s.username,
        name: `${s.firstName || ''} ${s.lastName || ''}`.trim(),
        isActive: s.isActive,
        searchQuery: s.searchQuery,
        jobsInQueue: s.jobQueue.length,
        startedAt: s.startedAt
      }))
    };
  }
}