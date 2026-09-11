import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { EmailService } from './email.service';
import { SendEmailDto } from './dto/send-email.dto';
import { ContactEmailDto } from './dto/contact-email.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

@ApiTags('Email')
@Controller('email')
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  @Post('send')
  @ApiOperation({ summary: 'Send a test email using Brevo (queued in BullMQ)' })
  async sendTestEmail(@Body() dto: SendEmailDto) {
    const job = await this.emailService.queueEmail(dto.to, dto.subject, dto.html, dto.senderEmail, dto.senderName);
    return { success: true, message: 'Email queued successfully for delivery', jobId: job.id };
  }

  @Post('contact')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 600000 } }) // Limit to max 3 contact emails per 10 minutes per IP
  @ApiOperation({ summary: 'Send a contact/feedback email from a user (rate-limited to 3/10m)' })
  async sendContactEmail(@Body() dto: ContactEmailDto) {
    const job = await this.emailService.sendContactEmail(dto.email, dto.comment);
    return { success: true, message: 'Contact email queued successfully', jobId: job?.id };
  }

  @Post('send-daily-alerts')
  @ApiOperation({ summary: 'Manually trigger sending daily email alerts to all users via BullMQ queue' })
  async triggerDailyEmailAlerts() {
    const result = await this.emailService.sendDailyEmailAlerts();
    return {
      success: true,
      message: `Daily email alerts successfully queued in BullMQ (${result.queuedCount} users).`,
      data: result,
    };
  }
}
