// src/cv/cv.controller.ts
import {
  Controller, Post, Get, Delete, Patch,
  UseGuards, UseInterceptors, UploadedFile,
  Req, Res, HttpCode, HttpStatus, Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import {
  ApiTags, ApiConsumes, ApiBody, ApiOperation,
  ApiOkResponse, ApiNoContentResponse, ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CvService } from './cv.service';
import { CvFileValidationPipe } from './cv-file-validation.pipe';
import { UpdateCvSummaryDto } from './dto/update-cv.dto';
import { CvParserService } from './cv-parser.service';

@ApiTags('CV')
@ApiBearerAuth()
@Controller('cv')
@UseGuards(JwtAuthGuard)
export class CvController {
  constructor(
    private readonly cvService: CvService,
    private readonly cvParserService: CvParserService,
  ) {}

  @Post('upload')
  @ApiOperation({ summary: 'Upload or replace your CV' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary', description: 'PDF or Word document, max 5MB' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async upload(@UploadedFile(CvFileValidationPipe) file: Express.Multer.File, @Req() req) {
    return this.cvService.uploadCv(req.user.id, file);
  }

  @Get()
  @ApiOperation({ summary: 'Get your current CV metadata' })
  async getMyCv(@Req() req) {
    return this.cvService.getCvByUser(req.user.id);
  }

  @Get('download')
  @ApiOperation({ summary: 'Download your CV file' })
  async downloadMyCv(@Req() req, @Res() res: any) {
    const { buffer, mimeType, originalName } = await this.cvService.downloadCv(req.user.id);
    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${originalName}"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @Delete()
  @ApiOperation({ summary: 'Delete your current CV' })
  @ApiNoContentResponse({ description: 'CV deleted successfully' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMyCv(@Req() req) {
    return this.cvService.deleteCv(req.user.id);
  }

  @Patch('cv-summary')
  @ApiBody({ type: UpdateCvSummaryDto, required: false })
  updateSummary(@Req() req, @Body() dto: UpdateCvSummaryDto) {
    return this.cvService.updateSummary(req.user.id, dto);
  }

  @Post('parse-test')
  @ApiOperation({ summary: 'Test CV parsing — returns extracted text' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async parseTest(@UploadedFile(CvFileValidationPipe) file: Express.Multer.File) {
    const text = await this.cvParserService.parseCV(file);
    return {
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      characterCount: text.length,
      text,
    };
  }
}