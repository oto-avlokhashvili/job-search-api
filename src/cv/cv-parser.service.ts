import { Injectable } from '@nestjs/common';
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
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const PDFParser = require('pdf2json');

  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser(null, 1); // second arg = raw text mode

    pdfParser.on('pdfParser_dataError', (err: any) => {
      reject(new Error(err.parserError));
    });

    pdfParser.on('pdfParser_dataReady', () => {
      resolve(pdfParser.getRawTextContent());
    });
    pdfParser.parseBuffer(buffer);
  });
}

  private async parseDOCX(buffer: Buffer): Promise<string> {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
}