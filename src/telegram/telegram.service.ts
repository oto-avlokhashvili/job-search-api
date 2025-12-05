import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
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
    private bot: TelegramBot;
    private userSessions: Map<number, UserSession> = new Map();

    // Default search query
    private readonly DEFAULT_SEARCH_QUERY = 'ანალიტიკოსი';
    private token = process.env.TELEGRAM_TOKEN!;
    constructor(private readonly jobService: JobService, private userService: UserService) {

    }

    onModuleInit() {
        this.setupCommands();
    }

    setupCommands() {
        this.bot = new TelegramBot(this.token, { polling: true });
        this.logger.log('✅ Telegram Bot successfully started and running!');
        this.logger.log('🔗 Bot link: https://t.me/job_notifcation_bot');
        this.bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
            const chatId = msg.chat.id;

            // match[1] contains the token from the deep link
            const token = match?.[1];

            if (!token) {
                this.bot.sendMessage(chatId, '❌ No token provided.');
                return;
            }

            // Verify the token in your database
            const user = await this.userService.linkTelegramToken(token, chatId);
            if (!user) {
                this.bot.sendMessage(chatId, '❌ Invalid or expired token.');
                return;
            }

            this.bot.sendMessage(chatId, `✅ Telegram successfully linked to your account, ${user.firstName}!`);
        });

    }

}