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
            const chatId = msg.chat.id.toString();
            const user$ = from(this.userService.findByTelegramId('5079587175'));
            const linkedUser = await lastValueFrom(user$);
            if(linkedUser){
                this.bot.sendMessage(chatId, `✅ Telegram Started Successfully, ${linkedUser.firstName}!`);
            }else{
                const token = match?.[1];
                if (!token) {
    
                    this.bot.sendMessage(chatId, '❌ No token provided.');
                    return;
                }
    
                const user = await this.userService.linkTelegramToken(token, chatId);
                if (!user) {
                    this.bot.sendMessage(chatId, '❌ Invalid or expired token.');
                    return;
                }
    
                this.bot.sendMessage(chatId, `✅ Telegram successfully linked to your account, ${user.firstName}!`);
            }
        });

    }

}