// cv-parser.service.ts
import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import * as mammoth from 'mammoth';

@Injectable()
export class CvParserService {

  async parseCV(file: Express.Multer.File): Promise<string> {
    const fileExtension = file.originalname.split('.').pop()?.toLowerCase();

    try {
      switch (fileExtension) {
        case 'pdf':
          return await this.parsePDF(file.buffer);
        case 'docx':
        case 'doc':
          return await this.parseDOCX(file.buffer);
        default:
          throw new Error('Unsupported file format. Please upload PDF or DOCX');
      }
    } catch (error) {
      throw new Error(`Failed to parse CV: ${error.message}`);
    }
  }

  private async parsePDF(buffer: Buffer): Promise<string> {

    const { PDFParse } = require('pdf-parse');

    const parser = new PDFParse({
      data: buffer,
    });

    const result = await parser.parse();

    return result.text;
  }
  private async parseDOCX(buffer: Buffer): Promise<string> {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
}