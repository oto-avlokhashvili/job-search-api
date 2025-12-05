import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { UserService } from 'src/user/user.service';
import { v4 as uuidv4 } from 'uuid';
import { ApiBearerAuth } from '@nestjs/swagger';
@Controller('telegram')
export class TelegramController {
  constructor(private readonly usersService: UserService) {}
      @ApiBearerAuth('bearerAuth')  
      @UseGuards(JwtAuthGuard)
  @Get('generate-link-token')
  async generateLinkToken(@Req() req) {
    const userId = req.user.id;

    // Create a unique token and save it to user
    const token = uuidv4(); // you could also use JWT with short expiration
    await this.usersService.saveTelegramToken(userId, token);

    return { token };
  }
}
