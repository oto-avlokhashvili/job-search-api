import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { In, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { Cv } from 'src/Entities/cv.entity';
import { JobEntity } from 'src/Entities/job.entity';
import { JobApplication, JobApplicationStatus } from 'src/Entities/job-application.entity';
import { User } from 'src/Entities/user.entity';
import { CvService } from 'src/cv/cv.service';
import { CvParserService } from 'src/cv/cv-parser.service';
import { CvContacts, extractCvContacts } from 'src/cv/cv-contacts';
import { CvFileValidationPipe } from 'src/cv/cv-file-validation.pipe';
import { PublicCvLimitsService } from 'src/cv/public-cv-limits.service';
import { TurnstileService } from 'src/cv/turnstile.service';
import { extractApplyEmail } from 'src/job/apply-email';
import { QuickApplyDto } from './dto/quick-apply.dto';

export const QUICK_APPLY_QUEUE = 'quick-apply';

export interface QuickApplyJobData {
  applicationId: number;
}

const DAY_SEC = 24 * 60 * 60;
const envInt = (name: string, fallback: number) => Number(process.env[name]) || fallback;
// Per candidate (account or email), per employer address, and for the whole site (the Brevo plan's
// daily sending limit is shared with the alert emails)
const PER_CANDIDATE_PER_DAY = envInt('QUICK_APPLY_PER_CANDIDATE_PER_DAY', 20);
const PER_EMPLOYER_PER_DAY = envInt('QUICK_APPLY_PER_EMPLOYER_PER_DAY', 100);
const SITE_PER_DAY = envInt('QUICK_APPLY_SITE_PER_DAY', 250);

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export interface ApplicationView {
  id: number;
  jobId: number;
  jobTitle: string;
  company: string;
  jobLink: string;
  toEmail: string;
  status: JobApplicationStatus;
  createdAt: Date;
  sentAt: Date | null;
}

const toView = (a: JobApplication): ApplicationView => ({
  id: a.id,
  jobId: a.jobId,
  jobTitle: a.jobTitle,
  company: a.company,
  jobLink: a.jobLink,
  toEmail: a.toEmail,
  status: a.status,
  createdAt: a.createdAt,
  sentAt: a.sentAt,
});

/**
 * Quick apply to scraped vacancies that name an email address: the CV is saved like any other
 * (searchable by HRs, under the candidate's consent) and emailed to the employer from our mailbox,
 * with the candidate as reply-to. Vacancies without an address are applied to on the source site.
 */
@Injectable()
export class QuickApplyService {
  private readonly logger = new Logger(QuickApplyService.name);
  private readonly fileValidation = new CvFileValidationPipe();

  constructor(
    @InjectRepository(JobApplication) private readonly applicationRepository: Repository<JobApplication>,
    @InjectRepository(JobEntity) private readonly jobRepository: Repository<JobEntity>,
    @InjectRepository(Cv) private readonly cvRepository: Repository<Cv>,
    @InjectQueue(QUICK_APPLY_QUEUE) private readonly queue: Queue<QuickApplyJobData>,
    private readonly cvService: CvService,
    private readonly cvParser: CvParserService,
    private readonly limits: PublicCvLimitsService,
    private readonly turnstile: TurnstileService,
  ) {}

  /** The name, email and phone the CV shows, for the form to display before sending. Nothing is stored. */
  async preview(file: Express.Multer.File | undefined): Promise<CvContacts> {
    if (!file) throw new BadRequestException('ატვირთეთ CV');
    this.fileValidation.transform(file);
    return this.readContacts(file);
  }

  /** Unreadable files (scans, broken PDFs) just give nothing to fill in. */
  private async readContacts(file: Express.Multer.File): Promise<CvContacts> {
    try {
      return extractCvContacts(await this.cvParser.parseCV(file));
    } catch (error: any) {
      this.logger.warn(`Could not read contacts from a CV: ${error?.message}`);
      return { fullName: null, email: null, phoneNumber: null };
    }
  }

  async apply(
    jobId: number,
    dto: QuickApplyDto,
    file: Express.Multer.File | undefined,
    user: User | null,
    clientIp: string,
  ): Promise<{ application: ApplicationView; searchToken?: string }> {
    if (!dto.consent) throw new BadRequestException('CV-ის გასაგზავნად საჭიროა თანხმობა');
    if (file) this.fileValidation.transform(file);

    const job = await this.jobRepository.findOne({ where: { id: jobId } });
    if (!job) throw new NotFoundException('ვაკანსია ვერ მოიძებნა');
    // null: saved before the column existed and not filled in yet
    const toEmail = job.applyEmail ?? extractApplyEmail(job.description);
    if (!toEmail) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'NO_APPLY_EMAIL',
        message: 'ამ ვაკანსიაზე განაცხადი წყარო საიტზე იგზავნება',
        link: job.link,
      });
    }

    const candidateEmail = (user ? user.email : dto.email ?? '').trim().toLowerCase();
    if (!user) {
      if (!candidateEmail) throw new BadRequestException('მიუთითეთ ელ-ფოსტა');
      if (!file) throw new BadRequestException('ატვირთეთ CV');
      await this.turnstile.verify(dto.turnstileToken, clientIp);
    }

    // Before storing anything: already sent, then the daily limits
    if (await this.applicationRepository.exists({ where: { jobId, candidateEmail } })) {
      throw new ConflictException({ statusCode: 409, code: 'ALREADY_APPLIED', message: 'ამ ვაკანსიაზე CV უკვე გაგზავნილი გაქვთ' });
    }
    await this.limits.consume(
      `quick-apply:candidate:${sha256(candidateEmail)}`,
      PER_CANDIDATE_PER_DAY,
      DAY_SEC,
      `დღეში მაქსიმუმ ${PER_CANDIDATE_PER_DAY} სწრაფი განაცხადის გაგზავნა შეიძლება, სცადეთ ხვალ`,
    );
    await this.limits.consume(
      `quick-apply:employer:${sha256(toEmail)}`,
      PER_EMPLOYER_PER_DAY,
      DAY_SEC,
      'ამ დამსაქმებელთან დღევანდელი ლიმიტი ამოიწურა, სცადეთ ხვალ ან გაგზავნეთ ხელით',
    );
    await this.limits.consume(
      'quick-apply:site',
      SITE_PER_DAY,
      DAY_SEC,
      'სწრაფი განაცხადის დღევანდელი ლიმიტი ამოიწურა, სცადეთ ხვალ ან გაგზავნეთ ხელით',
    );

    // Name and phone come from the CV unless the candidate typed (or corrected) them
    const fromCv = file && (!dto.phoneNumber || (!user && !dto.fullName)) ? await this.readContacts(file) : null;
    const phoneNumber = dto.phoneNumber || fromCv?.phoneNumber || undefined;

    let cv: Cv;
    let searchToken: string | undefined;
    if (user) {
      cv = await this.userCv(user, file, phoneNumber);
    } else {
      const stored = await this.cvService.storePublicCv(
        { email: candidateEmail, fullName: dto.fullName || fromCv?.fullName || undefined, phoneNumber, consent: true },
        file!,
        clientIp,
      );
      cv = stored.cv;
      searchToken = stored.searchToken;
    }

    // Without a name anywhere, the employer sees the email's mailbox name
    const candidateName = (user ? `${user.firstName} ${user.lastName}` : cv.fullName || candidateEmail.split('@')[0])
      .replace(/\s+/g, ' ')
      .trim();
    let application: JobApplication;
    try {
      application = await this.applicationRepository.save(
        this.applicationRepository.create({
          jobId,
          jobTitle: job.vacancy.slice(0, 500),
          company: (job.company || '').slice(0, 255),
          jobLink: (job.link || '').slice(0, 1000),
          cvId: cv.id,
          userId: user?.id ?? null,
          toEmail,
          candidateEmail,
          candidateName: candidateName.slice(0, 150),
          candidatePhone: (phoneNumber || cv.phoneNumber || '').slice(0, 50) || null,
        }),
      );
    } catch (error: any) {
      // Two requests at once: the unique index lets only one through
      if (error?.code === '23505') {
        throw new ConflictException({ statusCode: 409, code: 'ALREADY_APPLIED', message: 'ამ ვაკანსიაზე CV უკვე გაგზავნილი გაქვთ' });
      }
      throw error;
    }

    await this.queue.add(
      'send',
      { applicationId: application.id },
      {
        jobId: `quick-apply-${application.id}`,
        attempts: 4,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: { age: 7 * DAY_SEC },
      },
    );

    return { application: toView(application), ...(searchToken && { searchToken }) };
  }

  /** The signed-in user's applications, newest first. */
  async mine(user: User): Promise<ApplicationView[]> {
    const applications = await this.applicationRepository.find({
      where: { userId: user.id },
      order: { createdAt: 'DESC' },
      take: 500,
    });
    return applications.map(toView);
  }

  /** Which of these vacancies the signed-in user already applied to, for the "sent" mark on job cards. */
  async appliedJobIds(user: User, jobIds: number[]): Promise<number[]> {
    if (!jobIds.length) return [];
    const rows = await this.applicationRepository.find({
      select: ['jobId'],
      where: { candidateEmail: user.email.trim().toLowerCase(), jobId: In(jobIds) },
    });
    return rows.map((r) => r.jobId);
  }

  /**
   * The stored CV, or the uploaded file as their new one. The consent given now is recorded on it, and a
   * phone number they typed is kept for HRs (name and email come from the account).
   */
  private async userCv(user: User, file: Express.Multer.File | undefined, phoneNumber?: string): Promise<Cv> {
    let cv = file ? await this.cvService.uploadCv(user.id, file, true) : await this.cvRepository.findOne({ where: { userId: user.id } });
    if (!cv) throw new BadRequestException({ statusCode: 400, code: 'NO_CV', message: 'ჯერ ატვირთეთ CV' });

    const changes: Partial<Cv> = {};
    if (!cv.consentGiven) Object.assign(changes, { consentGiven: true, consentGivenAt: new Date() });
    if (phoneNumber && !cv.phoneNumber) changes.phoneNumber = phoneNumber;
    if (Object.keys(changes).length) {
      await this.cvRepository.update(cv.id, changes);
      cv = { ...cv, ...changes } as Cv;
    }
    return cv;
  }
}
