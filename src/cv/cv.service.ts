// src/cv/cv.service.ts
import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef, Logger } from '@nestjs/common';
import { UpdateCvSummaryDto } from './dto/update-cv.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Cv } from 'src/Entities/cv.entity';
import { IsNull, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { CvParserService } from './cv-parser.service';
import { R2StorageService } from './r2-storage.service';
import { AiService } from 'src/ai/ai.service';
import { CvSummaryDetails } from './dto/cv-summary.dto';
import { PublicCvUploadDto } from './dto/public-cv-upload.dto';

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
   * Submit CV from landing page for public candidates (without login / registration / AI evaluation)
   */
  async submitPublicCv(dto: PublicCvUploadDto, file: Express.Multer.File): Promise<{ success: boolean; message: string }> {
    if (!dto.consent) {
      throw new BadRequestException('Consent is required to submit your CV');
    }

    const ext = file.originalname.split('.').pop();
    const fileName = `${randomUUID()}.${ext}`;
    const storagePath = `cvs/public/${fileName}`;

    // 1. Upload file to Cloudflare R2
    await this.r2StorageService.uploadFile(file.buffer, storagePath, file.mimetype);

    const email = dto.email.trim().toLowerCase();

    // 2. Check if a public CV for this email already exists
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
      await this.cvRepository.save(existing);

      return { success: true, message: 'თქვენი CV წარმატებით განახლდა' };
    }

    // 3. Create new candidate record
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
      summary: null,
      consentGiven: true,
      consentGivenAt: new Date(),
    });

    await this.cvRepository.save(cv);

    return { success: true, message: 'თქვენი CV წარმატებით აიტვირთა' };
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
    cv.summary = dto ? { ...dto } : null;
    return this.cvRepository.save(cv);
  }
}