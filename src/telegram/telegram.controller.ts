import { Controller, Get, Post, Param, Body, Req, UseGuards, ParseIntPipe } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { UserService } from 'src/user/user.service';
import { v4 as uuidv4 } from 'uuid';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Telegram')
@Controller('telegram')
export class TelegramController {
  constructor(
    private readonly usersService: UserService,
    private readonly telegramService: TelegramService,
  ) { }

  @ApiBearerAuth('bearerAuth')
  @UseGuards(JwtAuthGuard)
  @Get('generate-link-token')
  @ApiOperation({ summary: 'Generate a linking token to connect Telegram account' })
  async generateLinkToken(@Req() req) {
    const userId = req.user.id;
    const token = uuidv4();
    await this.usersService.saveTelegramToken(userId, token);
    return { token };
  }

  @Post('dispatch-alerts')
  @ApiOperation({ summary: 'Manually trigger daily Telegram job alerts dispatch via BullMQ queue' })
  async triggerDailyAlerts() {
    const result = await this.telegramService.dispatchDailyTelegramAlerts();
    return {
      success: true,
      message: `Daily Telegram alerts successfully queued in BullMQ (${result.queuedCount} users).`,
      data: result,
    };
  }

  @Post('test-user-alert/:userId')
  @ApiOperation({ summary: 'Enqueue a Telegram job alert test for a specific user ID' })
  async testUserAlert(@Param('userId', ParseIntPipe) userId: number) {
    // Directly process or queue for this user
    const result = await this.telegramService.processUserTelegramAlert(userId);
    return {
      success: true,
      message: `Telegram alert processed for user ${userId}`,
      data: result,
    };
  }
}

