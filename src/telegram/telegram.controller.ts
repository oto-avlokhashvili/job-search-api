import { Controller, Get } from '@nestjs/common';
import { TelegramService } from './telegram.service';

@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegramService: TelegramService) { }
  /* @Get('init')
  async initTelegram() {
    const obj = this.telegramService.getLastChatId();
    return  obj;
  } */
}
