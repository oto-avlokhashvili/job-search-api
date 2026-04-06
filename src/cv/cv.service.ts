import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateCvDto } from './dto/create-cv.dto';
import { UpdateCvDto } from './dto/update-cv.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Cv } from 'src/Entities/cv.entity';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { SupabaseStorageService } from './supabase-storage.service';
import { CvParserService } from './cv-parser.service';
@Injectable()
export class CvService {
  constructor(
    @InjectRepository(Cv)
    private readonly cvRepository: Repository<Cv>,
    private readonly storageService: SupabaseStorageService,
    private readonly cvParserService: CvParserService 
  ) { }

  async uploadCv(userId: number, file: Express.Multer.File): Promise<Cv> {
    // Delete existing CV for this user (file + DB row)
    const existing = await this.cvRepository.findOne({ where: { userId } });
    if (existing) {
      await this.storageService.deleteFile(existing.storagePath);
      await this.cvRepository.remove(existing);
    }

    // Build a unique storage path: cvs/<userId>/<uuid>.<ext>
    const ext = file.originalname.split('.').pop();
    const storagePath = `cvs/${userId}/${uuidv4()}.${ext}`;

    const publicUrl = await this.storageService.uploadFile(
      file.buffer,
      storagePath,
      file.mimetype,
    );

    const cv = this.cvRepository.create({
      userId,
      fileName: storagePath.split('/').pop(),
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      storagePath,
      publicUrl,
    });

    return this.cvRepository.save(cv);
  }

async getCvByUser(userId: number): Promise<Cv> {
  const cv = await this.cvRepository.findOne({ where: { userId } });
  if (!cv) throw new NotFoundException('No CV found for this user');

  return cv;
}

  async deleteCv(userId: number): Promise<void> {
    const cv = await this.cvRepository.findOne({ where: { userId } });
    if (!cv) throw new NotFoundException('No CV found for this user');
    await this.storageService.deleteFile(cv.storagePath);
    await this.cvRepository.remove(cv);
  }
}
