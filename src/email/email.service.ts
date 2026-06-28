import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { BrevoClient } from '@getbrevo/brevo';
import { ConfigService } from '@nestjs/config';
import { UserService } from '../user/user.service';
import { AiMatchedJobsService } from '../ai-matched-jobs/ai-matched-jobs.service';
import { SentJobsService } from '../sent-jobs/sent-jobs.service';

@Injectable()
export class EmailService {
  private client: BrevoClient;

  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => UserService))
    private readonly userService: UserService,
    private readonly aiMatchedJobsService: AiMatchedJobsService,
    private readonly sentJobsService: SentJobsService,
  ) {
    const apiKey = this.configService.get<string>('BREVO_API_KEY') || process.env.BREVO_API_KEY || '';
    const maskedKey = apiKey ? `${apiKey.substring(0, 6)}... (length: ${apiKey.length})` : 'MISSING';
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
    let fromEmail = senderEmail || this.configService.get<string>('BREVO_SENDER_EMAIL') || 'oto.aldagi10@gmail.com';
    if (fromEmail === 'noreply@jobsearch.ge') {
      fromEmail = 'oto.aldagi10@gmail.com';
    }
    const fromName = senderName || this.configService.get<string>('BREVO_SENDER_NAME') || 'Job Scout';
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

  async sendDailyEmailAlerts() {
    const users = await this.userService.findAll();
    console.log(`[EmailService] Starting daily email alerts for ${users.length} users...`);

    const SAFETY_DAILY_LIMIT = 250;
    let sentEmailsCount = 0;

    for (const user of users) {
      if (!user.email || !user.isEmailVerified || user.subscription !== 'PRO') continue;

      if (sentEmailsCount >= SAFETY_DAILY_LIMIT) {
        console.warn(`[EmailService] Daily safety limit of ${SAFETY_DAILY_LIMIT} emails reached. Stopping alerts dispatch.`);
        break;
      }

      try {
        // Fetch matched jobs and sent jobs in parallel, matching Telegram bot daily flow
        const [matchedJobs, sentJobIdsArr] = await Promise.all([
          this.aiMatchedJobsService.findAllMatched(user.id),
          this.sentJobsService.findAllJobIdsByUserId(user.id),
        ]);

        const sentJobIds = new Set<number>(sentJobIdsArr);

        // Filter new jobs that haven't been sent
        const newJobs = matchedJobs.filter((job: any) => !sentJobIds.has(job.id));

        if (newJobs.length === 0) {
          console.log(`[EmailService] No new jobs found for user ${user.email} (all were already sent). Skipping email alert.`);
          continue;
        }

        const jobsToSend = newJobs; // Send everything to PRO users
        console.log(`[EmailService] Sending ${jobsToSend.length} jobs to user ${user.email} (PRO)`);

        // Mark them as sent in database using bulk upsert
        const sentJobDtos = jobsToSend.map((job) => ({
          userId: user.id,
          jobId: job.id,
          vacancy: job.vacancy,
          location: job.location,
          company: job.company,
          match: job.match,
          salaryRange: job.salaryRange,
        }));
        await this.sentJobsService.createBulk(sentJobDtos);

        // Build HTML
        const htmlBody = this.buildJobsEmailHtml(
          user.firstName,
          jobsToSend,
          0,
          user.subscription,
        );

        // Send Email
        const subject = `🔔 Job Scout ${jobsToSend.length} ახალი ვაკანსია თქვენთვის!`;
        await this.sendEmail(user.email, subject, htmlBody);
        
        sentEmailsCount++;

        // Add 1.5 seconds delay between emails to respect rates and safety limits
        await new Promise((resolve) => setTimeout(resolve, 1500));
      } catch (err: any) {
        console.error(`[EmailService] Failed to process email alerts for user ${user.id}:`, err);
      }
    }

    console.log(`[EmailService] Completed daily email alerting run. Dispatched ${sentEmailsCount} emails.`);
  }

  private buildJobsEmailHtml(
    firstName: string,
    jobs: any[],
    remainingCount: number,
    subscription: string,
  ): string {
    const jobsHtml = jobs
      .map((job) => {
        const salaryText = job.salaryRange
          ? `<p style="margin: 4px 0; font-size: 14px; color: #10b981; font-weight: bold;">💰 ${job.salaryRange}</p>`
          : '';
        const matchScore = Math.max(0, Math.min(100, typeof job.match === 'number' ? job.match : 0));
        const matchColor = matchScore >= 80 ? '#10b981' : matchScore >= 60 ? '#f59e0b' : '#ef4444';
        const matchBarFilled = '🟩'.repeat(Math.round(matchScore / 10)) + '⬜'.repeat(10 - Math.round(matchScore / 10));

        const gapsHtml = job.matchGaps && job.matchGaps.length > 0
          ? `<div style="margin-top: 10px; padding: 8px 12px; background-color: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px; font-size: 13px; color: #92400e;">
               <strong>⚠️ გაფრთხილება (ნაკლოვანებები):</strong> ${job.matchGaps.join(', ')}
             </div>`
          : '';

        return `
          <div style="background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
            <h3 style="margin: 0 0 8px 0; font-size: 18px; color: #1f2937;">📌 ${job.vacancy}</h3>
            <p style="margin: 0 0 6px 0; font-size: 14px; color: #4b5563; font-weight: 600;">🏢 ${job.company}</p>
            <p style="margin: 0 0 6px 0; font-size: 14px; color: #6b7280;">📍 ${job.location ?? 'თბილისი'}</p>
            ${salaryText}
            <p style="margin: 4px 0 10px 0; font-size: 13px; color: #6b7280;">📅 ${job.publishDate} – ${job.deadline}</p>
            
            <div style="margin: 12px 0; font-size: 14px; color: #1f2937;">
              <strong>🎯 შესაბამისობა:</strong> 
              <span style="font-family: monospace; letter-spacing: 1px;">${matchBarFilled}</span> 
              <span style="color: ${matchColor}; font-weight: bold; margin-left: 4px;">${job.match}%</span>
            </div>
            
            ${gapsHtml}
            
            <div style="margin-top: 15px;">
              <a href="${job.link}" target="_blank" style="display: inline-block; background-color: #3b82f6; color: #ffffff; text-decoration: none; padding: 8px 16px; font-size: 14px; font-weight: 600; border-radius: 6px;">ვაკანსიის ნახვა →</a>
            </div>
          </div>
        `;
      })
      .join('');

    let footerMessage = '';
    if (remainingCount > 0) {
      if (subscription === 'BASIC') {
        footerMessage = `<div style="background-color: #eff6ff; border-radius: 8px; padding: 15px; text-align: center; margin-top: 20px; border: 1px dashed #3b82f6;">
          <p style="margin: 0; font-size: 14px; color: #1e40af;">
            ℹ️ კიდევ <strong>${remainingCount}</strong> ვაკანსია არსებობს, მაგრამ თქვენი დღიური ლიმიტი ამოიწურა.
          </p>
          <p style="margin: 5px 0 0 0; font-size: 13px; color: #2563eb;">
            ⭐ PRO გამოწერით მიიღებთ შეუზღუდავ ვაკანსიებს!
          </p>
        </div>`;
      }
    } else {
      footerMessage = `<p style="text-align: center; color: #6b7280; font-size: 13px; margin-top: 25px;">
        ✅ ყველა შესაფერისი ვაკანსია გამოგზავნილია.
      </p>`;
    }

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>ვაკანსიები</title>
        </head>
        <body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <!-- Header -->
            <div style="background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); border-radius: 8px 8px 0 0; padding: 30px; text-align: center; color: #ffffff;">
              <h1 style="margin: 0; font-size: 24px; font-weight: bold; letter-spacing: 0.5px;">🔔 Job Scout</h1>
              <p style="margin: 5px 0 0 0; font-size: 16px; opacity: 0.9;">ყოველდღიური ვაკანსიების დაიჯესტი</p>
            </div>
            
            <!-- Content -->
            <div style="background-color: #ffffff; border-radius: 0 0 8px 8px; padding: 25px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
              <p style="margin-top: 0; font-size: 16px; color: #1f2937; line-height: 1.5;">
                გამარჯობა <strong>${firstName}</strong>,
              </p>
              <p style="font-size: 15px; color: #4b5563; line-height: 1.5; margin-bottom: 25px;">
                ჩვენი სისტემის მიერ გაანალიზებული მონაცემების საფუძველზე, თქვენთვის მოიძებნა ახალი შესაფერისი ვაკანსიები:
              </p>
              
              ${jobsHtml}
              
              ${footerMessage}
            </div>
            
            <!-- Footer Info -->
            <div style="text-align: center; margin-top: 25px; color: #9ca3af; font-size: 12px; line-height: 1.5;">
              <p style="margin: 0 0 5px 0;">თვენ მიიღეთ ეს მეილი, რადგან დარეგისტრირებული ხართ Job Scout პლატფორმაზე.</p>
              <p style="margin: 0;">&copy; 2026 Job Scout. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  async sendVerificationEmail(to: string, firstName: string, code: string) {
    const subject = '🔑 [Job Scout] გთხოვთ დაადასტუროთ თქვენი ელ-ფოსტა';
    const html = `
      <div style="max-width: 600px; margin: 0 auto; font-family: sans-serif; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
        <h2 style="color: #1e3a8a; text-align: center;">კეთილი იყოს თქვენი მობრძანება Job Scout-ზე!</h2>
        <p>გამარჯობა ${firstName},</p>
        <p>რეგისტრაციის დასასრულებლად და ყოველდღიური ვაკანსიების მეილით მისაღებად, გთხოვთ დაადასტუროთ თქვენი ელ-ფოსტა.</p>
        <div style="background-color: #f3f4f6; padding: 15px; text-align: center; border-radius: 6px; margin: 20px 0;">
          <span style="font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #1f2937;">${code}</span>
        </div>
        <p style="font-size: 13px; color: #6b7280; text-align: center;">ეს კოდი აქტიურია ელ-ფოსტის დადასტურებამდე.</p>
      </div>
    `;
    await this.sendEmail(to, subject, html);
  }

  async sendContactEmail(email: string, comment: string) {
    const adminEmail = this.configService.get<string>('BREVO_SENDER_EMAIL') || 'oto.aldagi10@gmail.com';
    const subject = `📬 New Contact Form Submission from ${email}`;
    const html = `
      <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1e3a8a; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px; margin-top: 0;">New Contact Form Submission</h2>
        <p style="font-size: 15px; line-height: 1.5; margin: 15px 0;"><strong>User Email:</strong> <a href="mailto:${email}" style="color: #3b82f6; text-decoration: none;">${email}</a></p>
        <p style="font-size: 15px; line-height: 1.5; margin-bottom: 5px;"><strong>Comment/Message:</strong></p>
        <div style="background-color: #f9fafb; padding: 15px; border-radius: 6px; border: 1px solid #f3f4f6; white-space: pre-wrap; font-size: 14px; color: #374151; line-height: 1.6;">${comment}</div>
      </div>
    `;
    return await this.sendEmail(adminEmail, subject, html);
  }
}

