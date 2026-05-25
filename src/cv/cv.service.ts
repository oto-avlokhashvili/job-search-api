// src/cv/cv.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { UpdateCvSummaryDto } from './dto/update-cv.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Cv } from 'src/Entities/cv.entity';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { CvParserService } from './cv-parser.service';

@Injectable()
export class CvService {
  constructor(
    @InjectRepository(Cv)
    private readonly cvRepository: Repository<Cv>,
    private readonly cvParserService: CvParserService,
  ) {}

  async uploadCv(userId: number, file: Express.Multer.File): Promise<Omit<Cv, 'fileData'>> {
    // Delete existing CV for this user
    const existing = await this.cvRepository.findOne({ where: { userId } });
    if (existing) {
      await this.cvRepository.remove(existing);
    }

    const ext = file.originalname.split('.').pop();

    const cv = this.cvRepository.create({
      userId,
      fileName: `${uuidv4()}.${ext}`,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      fileData: file.buffer,
      summary: null,
    });

    const saved = await this.cvRepository.save(cv);
    return this.stripFileData(saved);
  }

  async getCvByUser(userId: number): Promise<Omit<Cv, 'fileData'>> {
    const cv = await this.cvRepository.findOne({ where: { userId } });
    if (!cv) throw new NotFoundException('No CV found for this user');
    return this.stripFileData(cv);
  }

  async downloadCv(userId: number): Promise<{ buffer: Buffer; mimeType: string; originalName: string }> {
    const cv = await this.cvRepository.findOne({ where: { userId } });
    if (!cv) throw new NotFoundException('No CV found for this user');
    return { buffer: cv.fileData, mimeType: cv.mimeType, originalName: cv.originalName };
  }

  async deleteCv(userId: number): Promise<void> {
    const cv = await this.cvRepository.findOne({ where: { userId } });
    if (!cv) throw new NotFoundException('No CV found for this user');
    await this.cvRepository.remove(cv);
  }

  async updateSummary(userId: number, dto: UpdateCvSummaryDto | null): Promise<Omit<Cv, 'fileData'>> {
    const cv = await this.cvRepository.findOne({ where: { userId } });
    if (!cv) throw new NotFoundException('No CV found for this user');
    cv.summary = dto ? { ...dto } : null;
    const saved = await this.cvRepository.save(cv);
    return this.stripFileData(saved);
  }

  // Never expose raw binary data in API responses
  private stripFileData(cv: Cv): Omit<Cv, 'fileData'> {
    const { fileData, ...rest } = cv;
    return rest;
  }
}