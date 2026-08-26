import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { from, lastValueFrom } from 'rxjs';
import { AiMatchedJobsService } from 'src/ai-matched-jobs/ai-matched-jobs.service';
import { AiService } from 'src/ai/ai.service';
import { CvService } from 'src/cv/cv.service';
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
    searchQuery: string[];
    startedAt: Date;
}

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
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
        private readonly aiMatchedJobsService: AiMatchedJobsService,
        private readonly cvService: CvService,
        private userService: UserService,
        private aiService: AiService,
    ) { }

    onModuleInit() {
        // Bot will be started by ScheduleService
        this.setupCommands();
    }

    onModuleDestroy() {
        this.stopBot();
    }

    setupCommands() {
        this.logger.log('✅ Telegram Bot successfully started and running!');
        this.logger.log('🔗 Bot link: https://t.me/job_notifcation_bot');

        if (this.bot) {
            this.bot.stopPolling();
        }

        this.bot = new TelegramBot(this.token, {
            polling: {
                interval: 2000, // Increased to 2s to be less aggressive
                autoStart: true,
                params: {
                    timeout: 50, // Increased to 50s for more stable long polling
                },
            },
        });

        // Add error listener to handle ECONNRESET and other polling errors gracefully
        this.bot.on('polling_error', (error: any) => {
            // These errors are commonly related to the long polling connection being recycled
            // or the dev server hot-reloading. We'll log them as warnings instead of errors.
            if (error.code === 'EFATAL' || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
                this.logger.warn(`Telegram Polling connection issue (${error.code}). Usually transient, retrying...`);
                return;
            }
            this.logger.error(`Unhandled Telegram polling error: ${error.message}`, error.stack);
        });

        this.bot?.onText(/\/start(?: (.+))?/, async (msg, match) => {
            const chatId = msg.chat.id.toString();
            const user$ = from(this.userService.findByTelegramId(chatId));
            const linkedUser = await lastValueFrom(user$);
            console.log(linkedUser);

            if (linkedUser) {
                if (linkedUser.subscription !== 'BASIC') {
                    this.bot?.sendMessage(
                        chatId,
                        `⚠️ გამარჯობა, ${linkedUser.firstName}!\n` +
                        `ტელეგრამ შეტყობინებები ხელმისაწვდომია მხოლოდ BASIC მომხმარებლებისთვის.\n` +
                        `გთხოვთ, გაააქტიუროთ BASIC გამოწერა.`
                    );
                } else {
                    this.bot?.sendMessage(
                        chatId,
                        `✅ ტელეგრამ ბოტი წარმატებულად ჩაირთო, ${linkedUser.firstName}! თქვენ ყოველდღიურად მიიღებთ 5-10 ახალ ვაკანსიას.`
                    );
                }
            } else {
                const token = match?.[1];
                if (!token) {
                    this.bot?.sendMessage(chatId, '❌ დამაკავშირებელი ტოკენი ვერ მოიძებნა.');
                    return;
                }

                const user = await this.userService.linkTelegramToken(token, chatId);
                if (!user) {
                    this.bot?.sendMessage(chatId, '❌ ტოკენი არ არის ვალიდური.');
                    return;
                }

                if (user.subscription !== 'BASIC') {
                    this.bot?.sendMessage(
                        chatId,
                        `✅ ტელეგრამი წარმატებით დაუკავშირდა თქვენს ანგარიშს, ${user.firstName}!\n` +
                        `⚠️ გაითვალისწინეთ: ვაკანსიების მისაღებად საჭიროა BASIC გამოწერის გააქტიურება.`
                    );
                } else {
                    this.bot?.sendMessage(
                        chatId,
                        `✅ ტელეგრამი წარმატებით დაუკავშირდა თქვენს ანგარიშს, ${user.firstName}!\n` +
                        `🔔 თქვენ ყოველდღიურად მიიღებთ 5-10 ახალ ვაკანსიას თქვენი პროფილის მიხედვით.`
                    );
                }
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

    private async autoStartForAllUsers() {
        try {
            const allUsers = await this.userService.findAllWithTelegram();
            const users = allUsers.filter(u => u.subscription === 'BASIC' && u.receiveMessages !== false);
            this.logger.log(`🚀 Starting queue for ${users.length} BASIC users...`);

            let successCount = 0;
            let failCount = 0;

            for (let i = 0; i < users.length; i++) {
                const user = users[i];

                try {
                    await this.processUserStart(user);
                    successCount++;
                    this.logger.log(`✅ [${i + 1}/${users.length}] Processed user ${user.telegramChatId}`);
                } catch (error) {
                    failCount++;
                    this.logger.error(`❌ [${i + 1}/${users.length}] Failed for user ${user.telegramChatId}:`, error);
                }

                // Wait 1.5s between each user to respect Telegram rate limits
                if (i < users.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1500));
                }
            }

            this.logger.log(`✅ Queue finished. Success: ${successCount}, Failed: ${failCount}`);
        } catch (error) {
            this.logger.error('Failed to process user queue:', error);
        }
    }

    private async processUserStart(user: any): Promise<void> {
        if (!user.telegramChatId) return;
        if (user.subscription !== 'BASIC') return;
        if (user.receiveMessages === false) return;

        try {
            // 1. Fetch user's stored CV and search queries
            const cv = await this.cvService.getCvByUser(user.id).catch(() => null);
            const searchQueries: string[] = cv?.summary?.searchQueries ?? [];

            if (searchQueries.length === 0) {
                this.logger.warn(`No search queries found for user ${user.id}`);
                await this.bot?.sendMessage(
                    user.telegramChatId,
                    `ℹ️ გამარჯობა, ${user.firstName}! თქვენს პროფილში საძიებო სიტყვები ვერ მოიძებნა. გთხოვთ ატვირთოთ CV ან მიუთითოთ თქვენი პროფილი.`
                );
                return;
            }

            // 2. Fetch matching raw jobs directly from DB and sent jobs in parallel
            const [matchingJobs, sentJobIdsArr] = await Promise.all([
                this.jobService.findAllByQuery(searchQueries),
                this.sentJobsService.findAllJobIdsByUserId(user.id),
            ]);

            const sentJobIds = new Set<number>(sentJobIdsArr);

            // 3. Exclude already sent jobs & slice to daily limit (5-10)
            const DAILY_LIMIT = 10;
            const newJobs = matchingJobs
                .filter(job => !sentJobIds.has(job.id))
                .slice(0, DAILY_LIMIT);

            // Send welcome message
            await this.bot?.sendMessage(
                user.telegramChatId,
                `✅ გამარჯობა, ${user.firstName}! ბოტი აქტიურია და ეძებს ვაკანსიებს.\n` +
                `⭐ თქვენი გამოწერა: BASIC\n` +
                `📊 დღეს მიიღებთ: ${newJobs.length} ვაკანსიას`
            );

            if (newJobs.length === 0) {
                await this.bot?.sendMessage(
                    user.telegramChatId,
                    `ℹ️ ახალი ვაკანსია ვერ მოიძებნა`
                );
                return;
            }

            this.logger.log(`📨 Sending ${newJobs.length} jobs to user ${user.telegramChatId} (BASIC)`);

            // Send jobs with delay between each
            for (const job of newJobs) {
                try {
                    await this.sentJobsService.create({
                        userId: user.id,
                        jobId: job.id,
                        vacancy: job.vacancy,
                        location: job.location,
                        company: job.company,
                        match: 0,
                    });

                    await this.bot?.sendMessage(
                        user.telegramChatId,
                        `━━━━━━━━━━━━━━━━━━━\n` +
                        `🔔 *ახალი ვაკანსია*\n` +
                        `━━━━━━━━━━━━━━━━━━━\n` +
                        `📌 *${job.vacancy}*\n` +
                        `🏢 ${job.company}\n` +
                        `📍 ${job.location ?? 'თბილისი'}\n` +
                        `📅 ${job.publishDate ?? ''} – ${job.deadline ?? ''}\n` +
                        `🔗 [დეტალები](${job.link})\n` +
                        `━━━━━━━━━━━━━━━━━━━`,
                        { parse_mode: 'Markdown' }
                    );

                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (jobError) {
                    this.logger.error(`Failed to send job ${job.id} to user ${user.telegramChatId}:`, jobError);
                }
            }

            await this.bot?.sendMessage(
                user.telegramChatId,
                `✅ ყველა ვაკანსია გამოიგზავნა. დარჩენილია: 0.`
            );

        } catch (error) {
            this.logger.error(`Failed to start session for user ${user.telegramChatId}:`, error);
        }
    }

    private buildMatchBar(match: number): string {
        const filled = Math.round(match / 10);
        return '🟩'.repeat(filled) + '⬜'.repeat(10 - filled);
    }

    private async autoStopForAllUsers() {
        try {
            const allUsers = await this.userService.findAllWithTelegram();
            const users = allUsers.filter(u => u.subscription === 'BASIC' && u.receiveMessages !== false);

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

            this.logger.log(`🛑 Stopped sessions for ${users.length} BASIC users`);
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


    async runDailyAnalysis() {
        const users = await this.userService.findAll();
        const proUsers = users.filter(
            (u) => u.subscription === 'PRO' && u.receiveMessages !== false && (u.telegramChatId || (u.email && u.isEmailVerified)),
        );

        this.logger.log(`🤖 Running AI analysis for ${proUsers.length} PRO/PREMIUM users...`);

        for (let i = 0; i < proUsers.length; i++) {
            const user = proUsers[i];
            try {
                const { response, comment } = await this.aiService.jobsearchWithCv(user.id);

                const topJobs = response?.topJobs ?? [];
                this.logger.log(`✅ [${i + 1}/${proUsers.length}] ${comment} for user ${user.id} — ${topJobs.length} jobs`);

            } catch (error) {
                this.logger.error(`❌ Failed analysis for user ${user.id}:`, error);
            }

            if (i < proUsers.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        }
    }
}