import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { Cv } from 'src/Entities/cv.entity';
import { JobApplication, JobApplicationStatus } from 'src/Entities/job-application.entity';
import { EmailService } from 'src/email/email.service';
import { R2StorageService } from 'src/cv/r2-storage.service';
import { frontendUrl } from 'src/hr/interview';
import { attachmentName, buildQuickApplyEmail } from './quick-apply-email';
import { QUICK_APPLY_QUEUE, QuickApplyJobData } from './quick-apply.service';

/**
 * Emails a quick-apply CV to the employer: from our sender (the candidate's name shown), reply-to the
 * candidate, the CV attached. The queue job holds only the application id; the file comes from storage.
 */
@Processor(QUICK_APPLY_QUEUE, { concurrency: 2 })
export class QuickApplyProcessor extends WorkerHost {
  private readonly logger = new Logger(QuickApplyProcessor.name);

  constructor(
    @InjectRepository(JobApplication) private readonly applicationRepository: Repository<JobApplication>,
    @InjectRepository(Cv) private readonly cvRepository: Repository<Cv>,
    private readonly emailService: EmailService,
    private readonly r2StorageService: R2StorageService,
  ) {
    super();
  }

  async process(job: Job<QuickApplyJobData>): Promise<void> {
    const application = await this.applicationRepository.findOne({ where: { id: job.data.applicationId } });
    if (!application || application.status === JobApplicationStatus.SENT) return;

    // A user who uploaded a new CV meanwhile has a new CV row: send that one
    const cv =
      (await this.cvRepository.findOne({ where: { id: application.cvId } })) ??
      (application.userId ? await this.cvRepository.findOne({ where: { userId: application.userId } }) : null);
    if (!cv?.storagePath) {
      // Deleted by the candidate: nothing to send, and no point retrying
      await this.markFailed(application.id, 'The CV was deleted before it could be sent');
      return;
    }

    try {
      const file = await this.r2StorageService.downloadFile(cv.storagePath);
      const { subject, html } = buildQuickApplyEmail({
        jobTitle: application.jobTitle,
        company: application.company,
        candidateName: application.candidateName,
        candidateEmail: application.candidateEmail,
        candidatePhone: application.candidatePhone,
        siteUrl: frontendUrl(),
      });
      await this.emailService.sendDirectEmail(
        application.toEmail,
        subject,
        html,
        undefined, // our own sender address
        `${application.candidateName} via Job Up`,
        {
          replyTo: { email: application.candidateEmail, name: application.candidateName },
          attachments: [{ name: attachmentName(application.candidateName, cv.originalName), content: file.toString('base64') }],
        },
      );
      await this.applicationRepository.update(application.id, {
        status: JobApplicationStatus.SENT,
        sentAt: new Date(),
        error: null,
      });
      this.logger.log(`Quick apply ${application.id} sent to job ${application.jobId}`);
    } catch (error: any) {
      const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      this.logger.warn(`Quick apply ${application.id} failed (attempt ${job.attemptsMade + 1}): ${error?.message}`);
      if (lastAttempt) await this.markFailed(application.id, String(error?.message ?? error));
      throw error;
    }
  }

  private markFailed(id: number, error: string) {
    return this.applicationRepository.update(id, { status: JobApplicationStatus.FAILED, error: error.slice(0, 500) });
  }
}
