import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { from, lastValueFrom } from 'rxjs';
import { JobService } from 'src/job/job.service';
import { SentJobsService } from 'src/sent-jobs/sent-jobs.service';
import { UserService } from 'src/user/user.service';

interface UserSession {
    chatId: string;
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
        private readonly sentJobsService: SentJobsService,
        private readonly jobService: JobService, 
        private userService: UserService
    ) {}

    onModuleInit() {
        // Bot will be started by ScheduleService
        this.setupCommands();
    }

    setupCommands() {
        this.logger.log('✅ Telegram Bot successfully started and running!');
        this.logger.log('🔗 Bot link: https://t.me/job_notifcation_bot');
        this.bot = new TelegramBot(this.token, { polling: true });

        this.bot?.onText(/\/start(?: (.+))?/, async (msg, match) => {
            const chatId = msg.chat.id.toString();
            const user$ = from(this.userService.findByTelegramId(chatId));
            const linkedUser = await lastValueFrom(user$);
            console.log(linkedUser);
            
            if (linkedUser) {
                this.bot?.sendMessage(chatId, `✅ ტელეგრამ ბოტი წარმატებულად ჩაირთო, ${linkedUser.firstName}!`);
            } else {
                const token = match?.[1];
                if (!token) {
                    this.bot?.sendMessage(chatId, '❌ დამაკავშირებელი ტოკენბი ვერ მოიძებნა.');
                    return;
                }

                const user = await this.userService.linkTelegramToken(token, chatId);
                if (!user) {
                    this.bot?.sendMessage(chatId, '❌ ტოკენი არ არის ვალიდური.');
                    return;
                }

                this.bot?.sendMessage(chatId, `✅ ტელეგრამი წარმატებით დაუკავშირდა თქვენს ანგარიშს, ${user.firstName}! ვაკანსიებს მიიღებთ ყოველ დღე 10:00 საათზე.`);
            }
        });
    }

    async startBot() {
    if (this.isRunning) {
        this.logger.warn('⚠️ Bot is already running');
        return;
    }

    try {
        //this.bot = new TelegramBot(this.token, { polling: true });
        //this.setupCommands();
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

// Subscription limits configuration
private readonly SUBSCRIPTION_LIMITS = {
    BASIC: { min: 3, max: 5 },
    PRO: { limit: 20 },
    PREMIUM: { limit: Infinity }
};

private async autoStartForAllUsers() {
    try {
        const users = await this.userService.findAllWithTelegram();
        this.logger.log(`🚀 Starting sessions for ${users.length} users...`);

        // Process users in parallel batches to avoid rate limits
        const BATCH_SIZE = 10; // Process 10 users at a time
        const DELAY_BETWEEN_BATCHES = 2000; // 2 seconds between batches

        for (let i = 0; i < users.length; i += BATCH_SIZE) {
            const batch = users.slice(i, i + BATCH_SIZE);
            
            // Process batch in parallel
            await Promise.allSettled(
                batch.map(user => this.processUserStart(user))
            );

            // Delay between batches to respect Telegram rate limits
            if (i + BATCH_SIZE < users.length) {
                await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
            }
        }

        this.logger.log(`✅ Completed processing ${users.length} users`);
    } catch (error) {
        this.logger.error('Failed to auto-start for users:', error);
    }
}

private getJobLimitForUser(subscription: string): number {
    switch (subscription) {
        case 'BASIC':
            // Random number between 3-5 for BASIC users
            return Math.floor(Math.random() * (this.SUBSCRIPTION_LIMITS.BASIC.max - this.SUBSCRIPTION_LIMITS.BASIC.min + 1)) + this.SUBSCRIPTION_LIMITS.BASIC.min;
        case 'PRO':
            return this.SUBSCRIPTION_LIMITS.PRO.limit;
        case 'PREMIUM':
        case 'PREMIUN': // Handle typo in enum
            return this.SUBSCRIPTION_LIMITS.PREMIUM.limit;
        default:
            return 3; // Default to minimum
    }
}

private async processUserStart(user: any): Promise<void> {
    if (!user.telegramChatId) return;

    try {
        // Validate user has searchQuery
        if (!user.searchQuery || user.searchQuery.trim() === '') {
            this.logger.warn(`User ${user.telegramChatId} has no search query, skipping`);
            await this.bot?.sendMessage(
                user.telegramChatId,
                `⚠️ გამარჯობა, ${user.firstName}! გთხოვთ დააყენოთ ძიების პარამეტრები თქვენს პროფილში.`
            );
            return;
        }

        // Create user session
        this.userSessions.set(parseInt(user.telegramChatId), {
            chatId: user.telegramChatId,
            firstName: user.firstName,
            lastName: user.lastName,
            isActive: true,
            jobQueue: [],
            searchQuery: user.searchQuery,
            startedAt: new Date()
        });

        // Fetch jobs and sent jobs in parallel
        const [jobs, userSentJobs] = await Promise.all([
            this.jobService.findAllByQuery(user.searchQuery.trim()),
            this.sentJobsService.findByUserId(user.id)
        ]);

        // Create a Set for faster lookup
        const sentJobIds = new Set(userSentJobs.sentJobs.map(sj => sj.jobId));
        
        // Filter new jobs that haven't been sent
        const newJobs = jobs.filter(job => !sentJobIds.has(job.id));

        // Get job limit based on subscription
        const jobLimit = this.getJobLimitForUser(user.subscription);
        
        // Send welcome message with subscription info
        const subscriptionEmoji = {
            'BASIC': '🆓',
            'PRO': '⭐',
            'PREMIUM': '👑',
        };
        
        await this.bot?.sendMessage(
            user.telegramChatId, 
            `✅ გამარჯობა, ${user.firstName}! ბოტი აქტიურია და ეძებს ვაკანსიებს.
${subscriptionEmoji[user.subscription] || '🆓'} თქვენი გამოწერა: ${user.subscription}
📊 დღეს მიიღებთ: ${jobLimit === Infinity ? 'შეუზღუდავ' : jobLimit} ვაკანსიას`
        );

        if (newJobs.length === 0) {
            await this.bot?.sendMessage(
                user.telegramChatId,
                `ℹ️ ახალი ვაკანსია ვერ მოიძებნა`
            );
            return;
        }

        // Limit jobs based on subscription
        const jobsToSend = newJobs.slice(0, jobLimit === Infinity ? newJobs.length : jobLimit);

        this.logger.log(`📨 Sending ${jobsToSend.length} jobs to user ${user.telegramChatId} (${user.subscription})`);

        // Send jobs with delay between each
        for (const job of jobsToSend) {
            try {
                // Mark as sent first to avoid duplicates if process fails
                await this.sentJobsService.create({ userId: user.id, jobId: job.id });

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

                // Small delay between messages for same user
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (jobError) {
                this.logger.error(`Failed to send job ${job.id} to user ${user.telegramChatId}:`, jobError);
            }
        }

        // Notify if there are more jobs but limit reached
        if (newJobs.length > jobsToSend.length) {
            const remainingJobs = newJobs.length - jobsToSend.length;
            let upgradeMessage = '';
            
            if (user.subscription === 'BASIC') {
                upgradeMessage = '\n\n⭐ PRO გამოწერით მიიღებთ 20 ვაკანსიას დღეში!\n👑 PREMIUM-ით - შეუზღუდავად!';
            } else if (user.subscription === 'PRO') {
                upgradeMessage = '\n\n👑 PREMIUM გამოწერით მიიღებთ შეუზღუდავ ვაკანსიებს!';
            }
            
            await this.bot?.sendMessage(
                user.telegramChatId,
                `ℹ️ კიდევ ${remainingJobs} ვაკანსია არსებობს, მაგრამ თქვენი დღიური ლიმიტი ამოიწურა.${upgradeMessage}`
            );
        }

    } catch (error) {
        this.logger.error(`Failed to start session for user ${user.telegramChatId}:`, error);
    }
}

private async autoStopForAllUsers() {
    try {
        const users = await this.userService.findAllWithTelegram();
        
        // Process in parallel batches
        const BATCH_SIZE = 20; // Can be higher for stop messages
        
        for (let i = 0; i < users.length; i += BATCH_SIZE) {
            const batch = users.slice(i, i + BATCH_SIZE);
            
            await Promise.allSettled(
                batch.map(user => this.processUserStop(user))
            );

            // Small delay between batches
            if (i + BATCH_SIZE < users.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        // Clear all sessions
        this.userSessions.clear();
        
        this.logger.log(`🛑 Stopped sessions for ${users.length} users`);
    } catch (error) {
        this.logger.error('Failed to auto-stop for users:', error);
    }
}

private async processUserStop(user: any): Promise<void> {
    if (!user.telegramChatId) return;

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