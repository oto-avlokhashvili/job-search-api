import { PartialType } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { CreateUserDto } from './create-user.dto';

export class UpdateUserDto extends PartialType(CreateUserDto) {
    // Only '' is accepted: clearing it disconnects Telegram. Linking goes through the bot.
    @IsOptional()
    @IsIn([''])
    telegramChatId?: string;
}
