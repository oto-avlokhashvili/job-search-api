import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';

@Injectable()
export class CvFileValidationPipe implements PipeTransform {
  private readonly allowedMimeTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];
  private readonly maxSizeBytes = 5 * 1024 * 1024; // 5MB

  transform(file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided');

    if (!this.allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException('Only PDF and Word documents are allowed');
    }

    if (file.size > this.maxSizeBytes) {
      throw new BadRequestException('File size must not exceed 5MB');
    }

    return file;
  }
}