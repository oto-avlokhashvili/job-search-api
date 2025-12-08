import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { from, lastValueFrom } from 'rxjs';
import { JobService } from 'src/job/job.service';
import { UserService } from 'src/user/user.service';

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
    private bot: TelegramBot | null = null;  // ← Changed this line
    private userSessions: Map<number, UserSession> = new Map();
    private isRunning = false;

    // Default search query
    private readonly DEFAULT_SEARCH_QUERY = 'angular';
    private token = process.env.TELEGRAM_TOKEN!;
    
    constructor(
        private readonly jobService: JobService, 
        private userService: UserService
    ) {}

    onModuleInit() {
        // Bot will be started by ScheduleService
    }

    setupCommands() {
        this.logger.log('✅ Telegram Bot successfully started and running!');
        this.logger.log('🔗 Bot link: https://t.me/job_notifcation_bot');
        
        this.bot?.onText(/\/start(?: (.+))?/, async (msg, match) => {
            const chatId = msg.chat.id.toString();
            const user$ = from(this.userService.findByTelegramId(chatId));
            const linkedUser = await lastValueFrom(user$);
            
            if (linkedUser) {
                this.bot?.sendMessage(chatId, `✅ Telegram Started Successfully, ${linkedUser.firstName}!`);
            } else {
                const token = match?.[1];
                if (!token) {
                    this.bot?.sendMessage(chatId, '❌ No token provided.');
                    return;
                }

                const user = await this.userService.linkTelegramToken(token, chatId);
                if (!user) {
                    this.bot?.sendMessage(chatId, '❌ Invalid or expired token.');
                    return;
                }

                this.bot?.sendMessage(chatId, `✅ Telegram successfully linked to your account, ${user.firstName}!`);
            }
        });
    }

    async startBot() {
    if (this.isRunning) {
        this.logger.warn('⚠️ Bot is already running');
        return;
    }

    try {
        this.bot = new TelegramBot(this.token, { polling: true });
        this.setupCommands();
        this.isRunning = true;
        this.logger.log('🚀 Telegram Bot started successfully!');

        // Automatically execute start logic for all linked users
        await this.autoStartForAllUsers();
    } catch (error) {
        this.logger.error('❌ Failed to start bot:', error);
    }
}

async stopBot() {
    if (!this.isRunning) {
        this.logger.warn('⚠️ Bot is not running');
        return;
    }

    try {
        // Automatically execute stop logic for all linked users
        await this.autoStopForAllUsers();

        if (this.bot) {
            await this.bot.stopPolling();
            this.logger.log('🛑 Telegram Bot stopped successfully!');
            this.isRunning = false;
            this.bot = null;
        }
    } catch (error) {
        this.logger.error('❌ Failed to stop bot:', error);
    }
}

private async autoStartForAllUsers() {
    try {
        const users = await this.userService.findAllWithTelegram();
        
        for (const user of users) {
            if (user.telegramChatId) {
                try {
                    // Create or activate user session
                    this.userSessions.set(parseInt(user.telegramChatId), {
                        chatId: parseInt(user.telegramChatId),
                        firstName: user.firstName,
                        lastName: user.lastName,
                        isActive: true,
                        jobQueue: [],
                        searchQuery: this.DEFAULT_SEARCH_QUERY,
                        startedAt: new Date()
                    });
                    const jobs = await this.jobService.findAllByQuery(this.DEFAULT_SEARCH_QUERY)
                    await this.bot?.sendMessage(
                        user.telegramChatId, 
                        `✅ გამარჯობა, ${user.firstName}! ბოტი აქტიურია და ეძებს ვაკანსიებს.`
                    );
                    for(const job of jobs){
                        await new Promise(resolve => setTimeout(resolve, 1000));
await this.bot?.sendMessage(
    user.telegramChatId, 
    `━━━━━━━━━━━━━━━━━━━
🔔 *ახალი ვაკანსია*
━━━━━━━━━━━━━━━━━━━
📌 *${job.vacancy}*
🏢 ${job.company}

📅 ${job.publishDate} - ${job.deadline}
🔗 [დეტალები](${job.link})
━━━━━━━━━━━━━━━━━━━`,
    { parse_mode: 'Markdown' }

);
                    }
                } catch (error) {
                    this.logger.error(`Failed to start session for user ${user.telegramChatId}:`, error);
                }
            }
        }

        this.logger.log(`✅ Started sessions for ${users.length} users`);
    } catch (error) {
        this.logger.error('Failed to auto-start for users:', error);
    }
}

private async autoStopForAllUsers() {
    try {
        const users = await this.userService.findAllWithTelegram();
        
        for (const user of users) {
            if (user.telegramChatId) {
                try {
                    // Deactivate user session
                    const session = this.userSessions.get(parseInt(user.telegramChatId));
                    if (session) {
                        session.isActive = false;
                    }

                    await this.bot?.sendMessage(
                        user.telegramChatId, 
                        `🛑 ბოტმა საქმე შეასრულა, დროებით ${user.firstName}!`
                    );
                } catch (error) {
                    this.logger.error(`Failed to stop session for user ${user.telegramChatId}:`, error);
                }
            }
        }

        // Clear all sessions
        this.userSessions.clear();
        
        this.logger.log(`🛑 Stopped sessions for ${users.length} users`);
    } catch (error) {
        this.logger.error('Failed to auto-stop for users:', error);
    }
}
}