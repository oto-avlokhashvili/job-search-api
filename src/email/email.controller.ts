import { Controller, Post, Body } from '@nestjs/common';
import { EmailService } from './email.service';
import { SendEmailDto } from './dto/send-email.dto';
import { ContactEmailDto } from './dto/contact-email.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Email')
@Controller('email')
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  @Post('send')
  @ApiOperation({ summary: 'Send a test email using Brevo' })
  async sendTestEmail(@Body() dto: SendEmailDto) {
    const response = await this.emailService.sendEmail(dto.to, dto.subject, dto.html, dto.senderEmail, dto.senderName);
    return { success: true, message: 'Email sent successfully', data: response };
  }

  @Post('contact')
  @ApiOperation({ summary: 'Send a contact/feedback email from a user' })
  async sendContactEmail(@Body() dto: ContactEmailDto) {
    const response = await this.emailService.sendContactEmail(dto.email, dto.comment);
    return { success: true, message: 'Contact email sent successfully', data: response };
  }

  @Post('send-daily-alerts')
  @ApiOperation({ summary: 'Manually trigger sending daily email alerts to all users' })
  async triggerDailyEmailAlerts() {
    await this.emailService.sendDailyEmailAlerts();
    return { success: true, message: 'Daily email alerts triggered successfully' };
  }
}
