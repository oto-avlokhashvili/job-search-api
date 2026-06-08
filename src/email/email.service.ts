import { Injectable } from '@nestjs/common';
import { BrevoClient } from '@getbrevo/brevo';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EmailService {
  private client: BrevoClient;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('BREVO_API_KEY') || process.env.BREVO_API_KEY || '';
    const maskedKey = apiKey ? `${apiKey.substring(0, 6)}... (length: ${apiKey.length})` : 'MISSING';
    console.log(`[EmailService] Initialized. API Key status: ${maskedKey}`);
    console.log(`[EmailService] Relevant env keys found:`, Object.keys(process.env).filter(k => k.includes('BREVO') || k.includes('API') || k.includes('KEY') || k.includes('MAIL')));
    this.client = new BrevoClient({
      apiKey,
    });
  }

  async sendEmail(
    to: string,
    subject: string,
    html: string,
    senderEmail?: string,
    senderName?: string,
  ) {
    const fromEmail = senderEmail || this.configService.get<string>('BREVO_SENDER_EMAIL') || 'noreply@jobsearch.ge';
    const fromName = senderName || this.configService.get<string>('BREVO_SENDER_NAME') || 'Job Search';
    try {
      const response = await this.client.transactionalEmails.sendTransacEmail({
        sender: {
          name: fromName,
          email: fromEmail,
        },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      });
      return response;
    } catch (error: any) {
      console.error('[EmailService] Error calling Brevo API:', {
        message: error.message,
        status: error.status || error.statusCode || error.response?.status,
        body: error.body || error.response?.data,
      });
      throw error;
    }
  }
}
