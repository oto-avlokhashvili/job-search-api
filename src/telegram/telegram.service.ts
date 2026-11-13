import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject, forwardRef } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import { from, lastValueFrom } from 'rxjs';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, UnrecoverableError } from 'bullmq';
import { AiMatchedJobsService } from 'src/ai-matched-jobs/ai-matched-jobs.service';
import { AiService } from 'src/ai/ai.service';
import { CvService } from 'src/cv/cv.service';
import { scoreJobForCv } from 'src/cv/public-cv-search.service';
import { JobService } from 'src/job/job.service';
import { SentJobsService } from 'src/sent-jobs/sent-jobs.service';
import { UserService } from 'src/user/user.service';
import { EntitlementService } from 'src/subscription/entitlement.service';
import { SubscriptionService } from 'src/subscription/subscription.service';
import { User } from 'src/Entities/user.entity';
import { jobPageUrl } from 'src/job/public-link';

/** Only jobs at least this good a fit are sent to Telegram. */
const TELEGRAM_MIN_MATCH = 60;

/**
 * Telegram errors a retry can't fix: the bot can't reach the chat (never started, blocked,
 * deleted account) or the chat id doesn't belong to this bot's token. Jobs failing with these
 * are not retried.
 */
export function isPermanentTelegramError(error: any): boolean {
    if (error?.code !== 'ETELEGRAM') return false;
    const status = error.response?.body?.error_code ?? error.response?.statusCode;
    const description: string = error.response?.body?.description ?? error.message ?? '';
    return status === 403 || (status === 400 && /chat not found|user not found|PEER_ID_INVALID/i.test(description));
}

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
        private readonly subscriptionService: SubscriptionService,
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

    private pollingErrorStreak = 0;
    private lastPollingErrorAt = 0;

    private handlePollingError(error: any) {
        const code: string | undefined = error?.code;
        const status: number | undefined =
            error?.response?.body?.error_code ?? error?.response?.statusCode;

        // Network-level hiccups (connection recycled, timeouts, dev hot-reload).
        const isNetworkIssue = code === 'EFATAL' || code === 'ECONNRESET' || code === 'ETIMEDOUT';
        // Telegram-side outages (502/503/504...) and rate limiting are transient too.
        const isTelegramTransient = code === 'ETELEGRAM' && (status === 429 || (status !== undefined && status >= 500));

        if (isNetworkIssue || isTelegramTransient) {
            // No "poll succeeded" event exists, so treat a quiet gap as recovery.
            const now = Date.now();
            if (now - this.lastPollingErrorAt > 2 * 60_000) this.pollingErrorStreak = 0;
            this.lastPollingErrorAt = now;
            this.pollingErrorStreak++;
            // Log the first failure and then every 10th, so a long outage doesn't flood the logs.
            if (this.pollingErrorStreak === 1 || this.pollingErrorStreak % 10 === 0) {
                this.logger.warn(
                    `Telegram polling transient error (${status ?? code}): ${error.message}. ` +
                    `Retrying automatically (consecutive failures: ${this.pollingErrorStreak}).`,
                );
            }
            return;
        }

        if (code === 'ETELEGRAM' && status === 401) {
            // Invalid/revoked token: retrying will never succeed, stop hammering the API.
            this.logger.error('Telegram rejected TELEGRAM_TOKEN (401 Unauthorized). Stopping polling.');
            this.bot?.stopPolling().catch(() => undefined);
            return;
        }

        if (code === 'ETELEGRAM' && status === 409) {
            this.logger.error(
                'Telegram polling conflict (409): another instance is polling with this token, or a webhook is set. ' +
                'Run only one polling instance per bot token.',
            );
            return;
        }

        this.logger.error(`Unhandled Telegram polling error: ${error?.message}`, error?.stack);
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
                    timeout: 50, // Telegram's max long-poll; updates still arrive instantly, idle polling drops 5x
                },
            },
        });

        // The library keeps polling after an error (next attempt after `interval`), so most
        // errors only need logging. Classify them so transient outages don't log as ERRORs.
        this.bot.on('polling_error', (error: any) => this.handlePollingError(error));

        this.bot?.onText(/\/start(?: (.+))?/, async (msg, match) => {
            const chatId = msg.chat.id.toString();
            const user$ = from(this.userService.findByTelegramId(chatId));
            let linkedUser = await lastValueFrom(user$);

            if (linkedUser) {
                linkedUser = await this.withTelegramPlan(linkedUser);

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

                const linked = await this.userService.linkTelegramToken(token, chatId);
                if (!linked) {
                    await this.sendDirectMessage(chatId, '❌ ტოკენი არ არის ვალიდური.');
                    return;
                }
                const user = await this.withTelegramPlan(linked);

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

        this.bot?.onText(/^\/stop\b/, async (msg) => {
            const chatId = msg.chat.id.toString();
            const user = await this.userService.findByTelegramId(chatId);
            if (!user) {
                await this.sendDirectMessage(chatId, 'ℹ️ ეს ჩატი არცერთ ანგარიშთან არ არის დაკავშირებული.');
                return;
            }
            await this.disconnect(user.id);
        });
    }

    /**
     * Unlinks the user's Telegram chat and says goodbye there. The subscription is left as is:
     * a paid BASIC also has no end date, so it can't be told apart from the free Telegram one.
     */
    async disconnect(userId: number): Promise<{ disconnected: boolean }> {
        const chatId = await this.userService.disconnectTelegram(userId);
        if (!chatId) return { disconnected: false };

        try {
            await this.sendDirectMessage(
                chatId,
                `👋 Telegram გათიშულია თქვენი ანგარიშიდან. ვაკანსიებს აღარ მიიღებთ.\n` +
                `ხელახლა დასაკავშირებლად გამოიყენეთ პროფილის გვერდი.`
            );
        } catch {
            // Best effort: the chat may already be blocked or deleted
        }
        return { disconnected: true };
    }

    /** Connecting Telegram comes with free BASIC (no end date); returns the user with that plan loaded. */
    private async withTelegramPlan(user: User): Promise<User> {
        try {
            await this.subscriptionService.grantTelegramBasic(user.id);
            return (await this.userService.findOne(user.id)) ?? user;
        } catch (error: any) {
            this.logger.error(`Could not grant Telegram BASIC to user ${user.id}: ${error.message}`);
            return user;
        }
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
            if (isPermanentTelegramError(error)) {
                // One short line: these repeat daily for every unreachable chat
                this.logger.warn(`Telegram chat ${chatId} is unreachable: ${error.message}`);
                // BullMQ fails the job right away instead of retrying it
                throw new UnrecoverableError(error.message);
            }
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
                removeOnFail: { age: 7 * 24 * 3600 },
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
                    removeOnFail: { age: 7 * 24 * 3600 },
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
            const summary = cv ? await this.aiService.getUsableCvSummary(user.id, cv) : null;
            const searchQueries: string[] = summary?.searchQueries ?? [];

            if (searchQueries.length === 0) {
                this.logger.warn(`No search queries found for user ${user.id}`);
                await this.sendDirectMessage(
                    user.telegramChatId,
                    `ℹ️ გამარჯობა, ${user.firstName}! თქვენს პროფილში საძიებო სიტყვები ვერ მოიძებნა. გთხოვთ ატვირთოთ CV ან მიუთითოთ თქვენი პროფილი.`
                );
                return { status: 'skipped', reason: 'no search queries' };
            }

            // 2. Fetch every matching job the user hasn't received yet (no limit: all are scored)
            const sentJobIds = await this.sentJobsService.findAllJobIdsByUserId(user.id);
            const matchingJobs = await this.jobService.findAllByQuery(searchQueries, {
                limit: null,
                excludeIds: sentJobIds,
            });

            // 3. Score them like the public site (keyword-based, no AI), keep only strong
            //    matches, best first & slice to dynamic daily limit
            const dailyLimit = this.entitlementService.getDailyJobLimit(user);
            const effectivePlan = this.entitlementService.getEffectivePlan(user);
            const newJobs = matchingJobs
                .map((job) => ({ ...job, ...scoreJobForCv(job, summary!) }))
                .filter((job) => job.match >= TELEGRAM_MIN_MATCH)
                .sort((a, b) => b.match - a.match)
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
                    await this.sendDirectMessage(
                        user.telegramChatId,
                        `━━━━━━━━━━━━━━━━━━━\n` +
                        `🔔 *ახალი ვაკანსია*\n` +
                        `━━━━━━━━━━━━━━━━━━━\n` +
                        `📌 *${job.vacancy}*\n` +
                        `🏢 ${job.company}\n` +
                        `📍 ${job.location ?? 'თბილისი'}\n` +
                        `📅 ${job.publishDate ?? ''} – ${job.deadline ?? ''}\n` +
                        `🎯 დამთხვევა: *${job.match}%*\n` +
                        `${this.buildMatchBar(job.match)}\n` +
                        (job.matchedKeywords.length
                            ? `🔑 ${job.matchedKeywords.map((k) => k.replace(/[_*`\[\]]/g, '')).join(', ')}\n`
                            : '') +
                        `🔗 [დეტალები](${jobPageUrl(job)})\n` +
                        `━━━━━━━━━━━━━━━━━━━`,
                        { parse_mode: 'Markdown' }
                    );

                    // Recorded only once delivered, so a failed send is retried on the next run
                    await this.sentJobsService.create({
                        userId: user.id,
                        jobId: job.id,
                        vacancy: job.vacancy,
                        location: job.location,
                        company: job.company,
                        match: job.match,
                    });

                    // Small 300ms pacing delay per chat
                    await new Promise((resolve) => setTimeout(resolve, 300));
                } catch (jobError: any) {
                    // The chat is gone: the remaining jobs would fail the same way
                    if (jobError instanceof UnrecoverableError) throw jobError;
                    this.logger.error(`Failed to send job ${job.id} to user ${user.telegramChatId}:`, jobError.message || jobError);
                }
            }

            await this.sendDirectMessage(
                user.telegramChatId,
                `✅ ყველა ვაკანსია გამოიგზავნა. დარჩენილია: 0.`
            );

            return { status: 'sent', recipient: user.telegramChatId, jobsCount: newJobs.length };
        } catch (error: any) {
            // Unreachable chats were already logged once by sendDirectMessage
            if (!(error instanceof UnrecoverableError)) {
                this.logger.error(`Failed processing Telegram alert for user ${user.telegramChatId}:`, error.message || error);
            }
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