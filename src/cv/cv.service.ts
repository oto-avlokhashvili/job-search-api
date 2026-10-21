// src/cv/cv.service.ts
import { Injectable, NotFoundException, BadRequestException, GoneException, Inject, forwardRef, Logger } from '@nestjs/common';
import { UpdateCvSummaryDto } from './dto/update-cv.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Cv } from 'src/Entities/cv.entity';
import { User } from 'src/Entities/user.entity';
import { IsNull, Not, Repository } from 'typeorm';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { CvParserService } from './cv-parser.service';
import { R2StorageService } from './r2-storage.service';
import { AiService } from 'src/ai/ai.service';
import { CV_SUMMARY_PROMPT_VERSION, CvSummaryDetails } from './dto/cv-summary.dto';
import { PublicCvUploadDto } from './dto/public-cv-upload.dto';
import { PublicCvReconnectDto } from './dto/public-cv-reconnect.dto';
import { PublicCvLimitsService } from './public-cv-limits.service';
import { hashSearchToken } from './public-cv-search.service';

const DAY_SEC = 24 * 60 * 60;
const envInt = (name: string, fallback: number) => Number(process.env[name]) || fallback;
const PUBLIC_CV_UPLOADS_PER_IP_PER_DAY = envInt('PUBLIC_CV_UPLOADS_PER_IP_PER_DAY', 10);
const PUBLIC_CV_UPLOADS_PER_EMAIL_PER_DAY = envInt('PUBLIC_CV_UPLOADS_PER_EMAIL_PER_DAY', 7);
// Hard ceiling on AI summaries for anonymous uploads across the whole site, per UTC day.
const PUBLIC_CV_AI_DAILY_BUDGET = envInt('PUBLIC_CV_AI_DAILY_BUDGET', 300);
const PUBLIC_CV_RECONNECTS_PER_IP_PER_HOUR = envInt('PUBLIC_CV_RECONNECTS_PER_IP_PER_HOUR', 20);

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class CvService {
  private readonly logger = new Logger(CvService.name);

  constructor(
    @InjectRepository(Cv)
    private readonly cvRepository: Repository<Cv>,
    private readonly cvParserService: CvParserService,
    private readonly r2StorageService: R2StorageService,
    @Inject(forwardRef(() => AiService))
    private readonly aiService: AiService,
    private readonly limits: PublicCvLimitsService,
  ) {}

  /**
   * Upload CV for registered user
   */
  async uploadCv(userId: number, file: Express.Multer.File, consent: boolean): Promise<Cv> {
    if (!consent) {
      throw new BadRequestException('Consent is required to upload your CV');
    }

    const ext = file.originalname.split('.').pop();
    const fileName = `${randomUUID()}.${ext}`;
    const storagePath = `cvs/${userId}/${fileName}`;

    // 1. Delete existing CV from R2 and database for this user
    const existing = await this.cvRepository.findOne({ where: { userId } });
    if (existing) {
      if (existing.storagePath) {
        await this.r2StorageService.deleteFile(existing.storagePath).catch(() => null);
      }
      await this.cvRepository.remove(existing);
    }

    // 2. Upload file buffer to Cloudflare R2
    await this.r2StorageService.uploadFile(file.buffer, storagePath, file.mimetype);

    // 3. Immediately summarize the CV during upload so AI search runs instantly
    let summary: CvSummaryDetails | null = null;
    try {
      summary = await this.aiService.summarizeCv(file);
    } catch (e: any) {
      this.logger.warn(`Could not pre-summarize CV for user ${userId}: ${e.message}`);
    }

    // 4. Save metadata, summary & storage path to PostgreSQL
    const cv = this.cvRepository.create({
      userId,
      fileName,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      storagePath,
      summary,
      consentGiven: true,
      consentGivenAt: new Date(),
    });

    return this.cvRepository.save(cv);
  }

  /**
   * Submit CV from landing page for public candidates (without login / registration).
   * The CV is summarized by AI during submission, same as registered uploads, and the
   * response carries a fresh search token for anonymous CV search (see PublicCvSearchService).
   */
  async submitPublicCv(
    dto: PublicCvUploadDto,
    file: Express.Multer.File,
    clientIp: string,
  ): Promise<{
    success: boolean;
    message: string;
    summary: CvSummaryDetails | null;
    searchToken: string;
    searchAvailable: boolean;
  }> {
    if (!dto.consent) {
      throw new BadRequestException('Consent is required to submit your CV');
    }

    const email = dto.email.trim().toLowerCase();

    // 1. Daily limits, checked before any storage or AI work. Keys hold hashes, not raw PII.
    //    Distinct messages, so a user (and support) can tell which limit was hit.
    await this.limits.consume(
      `upload:ip:${sha256(clientIp)}`,
      PUBLIC_CV_UPLOADS_PER_IP_PER_DAY,
      DAY_SEC,
      'ამ ქსელიდან დღევანდელი ატვირთვების ლიმიტი ამოიწურა, სცადეთ ხვალ',
    );
    await this.limits.consume(
      `upload:email:${sha256(email)}`,
      PUBLIC_CV_UPLOADS_PER_EMAIL_PER_DAY,
      DAY_SEC,
      `ამ ელ-ფოსტით დღეს მაქსიმუმ ${PUBLIC_CV_UPLOADS_PER_EMAIL_PER_DAY}-ჯერ შეიძლება CV-ის ატვირთვა, სცადეთ ხვალ`,
    );

    const ext = file.originalname.split('.').pop();
    const fileName = `${randomUUID()}.${ext}`;
    const storagePath = `cvs/public/${fileName}`;
    const fileHash = sha256(file.buffer);

    // 2. Upload file to Cloudflare R2
    await this.r2StorageService.uploadFile(file.buffer, storagePath, file.mimetype);

    // 3. Summarize the CV: reuse the summary of an identical file, otherwise call the AI
    //    while the site-wide daily budget lasts. Without a summary the CV is still saved
    //    for HRs, only CV search is unavailable.
    let summary: CvSummaryDetails | null = null;
    const sameFile = await this.cvRepository.findOne({ where: { fileHash, summary: Not(IsNull()) } });
    if (sameFile?.summary) {
      summary = sameFile.summary;
    } else if (await this.tryConsumeAiBudget()) {
      try {
        summary = await this.aiService.summarizeCv(file);
      } catch (e: any) {
        this.logger.warn(`Could not summarize public CV for ${email}: ${e.message}`);
      }
    } else {
      this.logger.warn('Public CV AI budget exhausted for today; saving CV without a summary');
    }

    // 4. New token on every upload; only its hash is stored.
    const searchToken = randomBytes(32).toString('base64url');
    const searchTokenHash = hashSearchToken(searchToken);
    const searchAvailable = !!summary?.searchQueries?.length;

    // 5. Check if a public CV for this email already exists
    const existing = await this.cvRepository.findOne({
      where: { email, userId: IsNull() },
    });

    if (existing) {
      if (existing.storagePath) {
        await this.r2StorageService.deleteFile(existing.storagePath).catch(() => null);
      }
      existing.fileName = fileName;
      existing.originalName = file.originalname;
      existing.mimeType = file.mimetype;
      existing.size = file.size;
      existing.storagePath = storagePath;
      existing.fullName = dto.fullName || existing.fullName || null;
      existing.phoneNumber = dto.phoneNumber || existing.phoneNumber || null;
      existing.consentGiven = true;
      existing.consentGivenAt = new Date();
      existing.summary = summary;
      existing.fileHash = fileHash;
      existing.searchTokenHash = searchTokenHash;
      await this.cvRepository.save(existing);

      return { success: true, message: 'თქვენი CV წარმატებით განახლდა', summary, searchToken, searchAvailable };
    }

    // 6. Create new candidate record
    const cv = this.cvRepository.create({
      userId: null,
      email,
      fullName: dto.fullName || null,
      phoneNumber: dto.phoneNumber || null,
      fileName,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      storagePath,
      summary,
      fileHash,
      searchTokenHash,
      consentGiven: true,
      consentGivenAt: new Date(),
    });

    await this.cvRepository.save(cv);

    return { success: true, message: 'თქვენი CV წარმატებით აიტვირთა', summary, searchToken, searchAvailable };
  }

  /**
   * Re-issues a search token for a public CV, so a browser that uploaded before CV search
   * existed (or whose token was replaced from another device) can search without uploading
   * again. The browser proves itself with the email + original file name it saved at upload.
   * A CV saved without a summary is summarized once from storage, within the AI budget.
   */
  async reconnectPublicCv(
    dto: PublicCvReconnectDto,
    clientIp: string,
  ): Promise<{ searchToken: string; searchAvailable: boolean }> {
    await this.limits.consume(
      `reconnect:ip:${sha256(clientIp)}`,
      PUBLIC_CV_RECONNECTS_PER_IP_PER_HOUR,
      3600,
      'ძალიან ბევრი მცდელობა, სცადეთ მოგვიანებით',
    );

    const email = dto.email.trim().toLowerCase();
    const cv = await this.cvRepository.findOne({ where: { email, userId: IsNull() } });
    if (!cv || cv.originalName !== dto.fileName) {
      throw new GoneException('CV ვერ მოიძებნა, ატვირთეთ თავიდან');
    }

    if (!cv.summary?.searchQueries?.length && cv.storagePath && (await this.tryConsumeAiBudget())) {
      try {
        const buffer = await this.r2StorageService.downloadFile(cv.storagePath);
        cv.summary = await this.aiService.summarizeCv({
          buffer,
          mimetype: cv.mimeType,
          originalname: cv.originalName,
          size: buffer.length,
        } as Express.Multer.File);
      } catch (e: any) {
        this.logger.warn(`Could not summarize public CV ${cv.id} on reconnect: ${e.message}`);
      }
    }

    const searchToken = randomBytes(32).toString('base64url');
    cv.searchTokenHash = hashSearchToken(searchToken);
    await this.cvRepository.save(cv);

    return { searchToken, searchAvailable: !!cv.summary?.searchQueries?.length };
  }

  /**
   * Moves a public CV onto a signed-in account that has none, so a CV uploaded before signing in
   * isn't lost. Ownership is proven by the browser's search token or, failing that, by a verified
   * account email equal to the one given at upload. An existing account CV is never replaced.
   */
  async claimPublicCv(user: User, token?: string): Promise<{ claimed: boolean }> {
    if (await this.cvRepository.exists({ where: { userId: user.id } })) return { claimed: false };

    let cv: Cv | null = null;
    if (token) {
      cv = await this.cvRepository.findOne({ where: { searchTokenHash: hashSearchToken(token), userId: IsNull() } });
    }
    if (!cv && user.isEmailVerified && user.email) {
      cv = await this.cvRepository.findOne({ where: { email: user.email.trim().toLowerCase(), userId: IsNull() } });
    }
    if (!cv) return { claimed: false };

    cv.userId = user.id;
    // The anonymous token stops working: the account's own CV search takes over.
    cv.searchTokenHash = null;
    await this.cvRepository.save(cv);
    return { claimed: true };
  }

  private tryConsumeAiBudget(): Promise<boolean> {
    return this.limits.tryConsume(`ai-budget:${new Date().toISOString().slice(0, 10)}`, PUBLIC_CV_AI_DAILY_BUDGET, DAY_SEC);
  }

  async getCvByUser(userId: number): Promise<Cv> {
    const cv = await this.cvRepository.findOne({ where: { userId } });
    if (!cv) throw new NotFoundException('No CV found for this user');
    return cv;
  }

  async downloadCv(userId: number): Promise<{ buffer: Buffer; mimeType: string; originalName: string }> {
    const cv = await this.cvRepository.findOne({ where: { userId } });
    if (!cv) throw new NotFoundException('No CV found for this user');

    if (!cv.storagePath) {
      throw new BadRequestException('CV file is missing in cloud storage. Please re-upload your CV.');
    }

    const buffer = await this.r2StorageService.downloadFile(cv.storagePath);
    return { buffer, mimeType: cv.mimeType, originalName: cv.originalName };
  }

  async deleteCv(userId: number): Promise<void> {
    const cv = await this.cvRepository.findOne({ where: { userId } });
    if (!cv) throw new NotFoundException('No CV found for this user');

    if (cv.storagePath) {
      await this.r2StorageService.deleteFile(cv.storagePath).catch(() => null);
    }
    await this.cvRepository.remove(cv);
  }

  async updateSummary(userId: number, dto: UpdateCvSummaryDto | null): Promise<Cv> {
    const cv = await this.cvRepository.findOne({ where: { userId } });
    if (!cv) throw new NotFoundException('No CV found for this user');
    // Stamped as current so a manually edited summary isn't regenerated over the user's edits
    cv.summary = dto ? { ...(cv.summary || {}), ...dto, promptVersion: CV_SUMMARY_PROMPT_VERSION } : null;
    return this.cvRepository.save(cv);
  }
}