import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject, forwardRef } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { from, lastValueFrom } from 'rxjs';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AiMatchedJobsService } from 'src/ai-matched-jobs/ai-matched-jobs.service';
import { AiService } from 'src/ai/ai.service';
import { CvService } from 'src/cv/cv.service';
import { JobService } from 'src/job/job.service';
import { SentJobsService } from 'src/sent-jobs/sent-jobs.service';
import { UserService } from 'src/user/user.service';
import { EntitlementService } from 'src/subscription/entitlement.service';

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
    private bot: TelegramBot | null = null;
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
        @Inject(forwardRef(() => UserService))
        private userService: UserService,
        @Inject(forwardRef(() => AiService))
        private aiService: AiService,
        private readonly entitlementService: EntitlementService,
        @InjectQueue('telegram') private readonly telegramQueue: Queue,
    ) { }

    onModuleInit() {
        this.setupCommands();
    }

    async onModuleDestroy() {
        if (this.bot?.isPolling()) {
            try {
                await this.bot.stopPolling();
            } catch (err) {
                this.logger.debug('Error stopping telegram bot polling:', err);
            }
        }
        await this.stopBot();
    }

    private setupCommands() {
        if (!this.token) {
            this.logger.error('TELEGRAM_TOKEN is not defined in environment variables');
            return;
        }

        this.bot = new TelegramBot(this.token, {
            polling: {
                interval: 2000,
                autoStart: true,
                params: {
                    timeout: 10,
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
                if (!this.entitlementService.canReceiveTelegramAlerts(linkedUser)) {
                    await this.sendDirectMessage(
                        chatId,
                        `⚠️ გამარჯობა, ${linkedUser.firstName}!\n` +
                        `ტელეგრამ შეტყობინებები ხელმისაწვდომია მხოლოდ BASIC/PRO მომხმარებლებისთვის.\n` +
                        `გთხოვთ, გაააქტიუროთ გამოწერა.`
                    );
                } else {
                    await this.sendDirectMessage(
                        chatId,
                        `✅ ტელეგრამ ბოტი წარმატებულად ჩაირთო, ${linkedUser.firstName}! თქვენ ყოველდღიურად მიიღებთ ახალ ვაკანსიებს თქვენი პროფილის მიხედვით.`
                    );
                    await this.telegramQueue.add('send-user-telegram-alerts', { userId: linkedUser.id });
                }
            } else {
                const token = match?.[1];
                if (!token) {
                    await this.sendDirectMessage(chatId, '❌ დამაკავშირებელი ტოკენი ვერ მოიძებნა.');
                    return;
                }

                const user = await this.userService.linkTelegramToken(token, chatId);
                if (!user) {
                    await this.sendDirectMessage(chatId, '❌ ტოკენი არ არის ვალიდური.');
                    return;
                }

                if (!this.entitlementService.canReceiveTelegramAlerts(user)) {
                    await this.sendDirectMessage(
                        chatId,
                        `✅ ტელეგრამი წარმატებით დაუკავშირდა თქვენს ანგარიშს, ${user.firstName}!\n` +
                        `⚠️ გაითვალისწინეთ: ვაკანსიების მისაღებად საჭიროა გამოწერის გააქტიურება.`
                    );
                } else {
                    await this.sendDirectMessage(
                        chatId,
                        `✅ ტელეგრამი წარმატებით დაუკავშირდა თქვენს ანგარიშს, ${user.firstName}!\n` +
                        `🔔 თქვენ ყოველდღიურად მიიღებთ ახალ ვაკანსიებს თქვენი პროფილის მიხედვით.`
                    );
                    await this.telegramQueue.add('send-user-telegram-alerts', { userId: user.id });
                }
            }
        });
    }

    /**
     * Directly sends a message via the Telegram bot API.
     */
    async sendDirectMessage(
        chatId: string | number,
        text: string,
        options?: TelegramBot.SendMessageOptions,
    ): Promise<TelegramBot.Message | null> {
        if (!this.bot) {
            this.logger.error('Telegram bot instance is not initialized');
            return null;
        }

        try {
            return await this.bot.sendMessage(chatId, text, options);
        } catch (error: any) {
            this.logger.error(`Failed to send direct message to Telegram chat ${chatId}:`, error.message || error);
            throw error;
        }
    }

    /**
     * Enqueues a single message job into BullMQ.
     */
    async queueDirectMessage(
        chatId: string | number,
        text: string,
        options?: TelegramBot.SendMessageOptions,
    ) {
        return await this.telegramQueue.add(
            'send-direct-telegram-message',
            { chatId, text, options },
            {
                attempts: 3,
                backoff: { type: 'exponential', delay: 2000 },
                removeOnComplete: true,
                removeOnFail: false,
            },
        );
    }

    /**
     * Dispatches daily Telegram job alert tasks to BullMQ for all eligible users.
     * Non-blocking: returns in milliseconds.
     */
    async dispatchDailyTelegramAlerts(): Promise<{ queuedCount: number }> {
        const allUsers = await this.userService.findAllWithTelegram();
        const eligibleUsers = allUsers.filter(
            (u) => this.entitlementService.canReceiveTelegramAlerts(u) && u.receiveMessages !== false && u.telegramChatId,
        );

        this.logger.log(`🚀 Queueing daily Telegram alerts for ${eligibleUsers.length} eligible users...`);

        let queuedCount = 0;
        for (const user of eligibleUsers) {
            await this.telegramQueue.add(
                'send-user-telegram-alerts',
                { userId: user.id },
                {
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 3000 },
                    removeOnComplete: true,
                    removeOnFail: false,
                },
            );
            queuedCount++;
        }

        this.logger.log(`✅ Successfully queued ${queuedCount} Telegram alert jobs into BullMQ.`);
        return { queuedCount };
    }

    /**
     * Worker Handler: Processes and sends Telegram alerts for a single user.
     */
    async processUserTelegramAlert(userId: number) {
        const user = await this.userService.findOne(userId);
        if (
            !user ||
            !user.telegramChatId ||
            !this.entitlementService.canReceiveTelegramAlerts(user) ||
            user.receiveMessages === false
        ) {
            return { status: 'skipped', reason: 'user ineligible or no telegramChatId' };
        }

        try {
            // 1. Fetch user's stored CV and search queries
            const cv = await this.cvService.getCvByUser(user.id).catch(() => null);
            const searchQueries: string[] = cv?.summary?.searchQueries ?? [];

            if (searchQueries.length === 0) {
                this.logger.warn(`No search queries found for user ${user.id}`);
                await this.sendDirectMessage(
                    user.telegramChatId,
                    `ℹ️ გამარჯობა, ${user.firstName}! თქვენს პროფილში საძიებო სიტყვები ვერ მოიძებნა. გთხოვთ ატვირთოთ CV ან მიუთითოთ თქვენი პროფილი.`
                );
                return { status: 'skipped', reason: 'no search queries' };
            }

            // 2. Fetch matching raw jobs directly from DB and sent jobs in parallel
            const [matchingJobs, sentJobIdsArr] = await Promise.all([
                this.jobService.findAllByQuery(searchQueries),
                this.sentJobsService.findAllJobIdsByUserId(user.id),
            ]);

            const sentJobIds = new Set<number>(sentJobIdsArr);

            // 3. Exclude already sent jobs & slice to dynamic daily limit
            const dailyLimit = this.entitlementService.getDailyJobLimit(user);
            const effectivePlan = this.entitlementService.getEffectivePlan(user);
            const newJobs = matchingJobs
                .filter((job) => !sentJobIds.has(job.id))
                .slice(0, dailyLimit === Infinity ? undefined : dailyLimit);

            // Send welcome message
            await this.sendDirectMessage(
                user.telegramChatId,
                `✅ გამარჯობა, ${user.firstName}! ბოტი აქტიურია და ეძებს ვაკანსიებს.\n` +
                `⭐ თქვენი გამოწერა: ${effectivePlan}\n` +
                `📊 დღეს მიიღებთ: ${newJobs.length} ვაკანსიას`
            );

            if (newJobs.length === 0) {
                await this.sendDirectMessage(
                    user.telegramChatId,
                    `ℹ️ ახალი ვაკანსია ვერ მოიძებნა`
                );
                return { status: 'skipped', reason: 'no new jobs' };
            }

            this.logger.log(`📨 Sending ${newJobs.length} jobs to user ${user.telegramChatId} (${effectivePlan})`);

            // Send jobs with a small pacing delay between each message for the same chat
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

                    await this.sendDirectMessage(
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

                    // Small 300ms pacing delay per chat
                    await new Promise((resolve) => setTimeout(resolve, 300));
                } catch (jobError: any) {
                    this.logger.error(`Failed to send job ${job.id} to user ${user.telegramChatId}:`, jobError.message || jobError);
                }
            }

            await this.sendDirectMessage(
                user.telegramChatId,
                `✅ ყველა ვაკანსია გამოიგზავნა. დარჩენილია: 0.`
            );

            return { status: 'sent', recipient: user.telegramChatId, jobsCount: newJobs.length };
        } catch (error: any) {
            this.logger.error(`Failed processing Telegram alert for user ${user.telegramChatId}:`, error.message || error);
            throw error;
        }
    }

    async startBot() {
        if (this.isRunning) {
            this.logger.warn('⚠️ Bot alert dispatch is already in progress');
            return;
        }

        try {
            this.isRunning = true;
            this.logger.log('🚀 Telegram Bot started successfully! Triggering alert queue...');
            await this.dispatchDailyTelegramAlerts();
            this.isRunning = false;
        } catch (error) {
            this.isRunning = false;
            this.logger.error('❌ Failed to dispatch telegram alerts:', error);
        }
    }

    async stopBot() {
        try {
            this.logger.log('🛑 Cleaning up Telegram sessions...');
            this.userSessions.clear();
            this.isRunning = false;
            this.logger.log('✅ Bot stopped and cleaned up successfully');
        } catch (error) {
            this.logger.error('❌ Failed to stop bot:', error);
        }
    }

    private buildMatchBar(match: number): string {
        const filled = Math.round(match / 10);
        return '🟩'.repeat(filled) + '⬜'.repeat(10 - filled);
    }

    async runDailyAnalysis() {
        return this.aiService.dispatchDailyAiAnalysis();
    }
}