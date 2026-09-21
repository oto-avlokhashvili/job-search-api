// src/cv/cv.controller.ts
import {
  Controller, Post, Get, Delete, Patch,
  UseGuards, UseInterceptors, UploadedFile,
  Req, Res, HttpCode, HttpStatus, Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ApiTags, ApiConsumes, ApiBody, ApiOperation,
  ApiOkResponse, ApiNoContentResponse, ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { CvService } from './cv.service';
import { CvFileValidationPipe } from './cv-file-validation.pipe';
import { UpdateCvSummaryDto } from './dto/update-cv.dto';
import { CreateCvDto } from './dto/create-cv.dto';
import { PublicCvUploadDto } from './dto/public-cv-upload.dto';
import { CvParserService } from './cv-parser.service';

@ApiTags('CV')
@ApiBearerAuth('bearerAuth')
@Controller('cv')
@UseGuards(JwtAuthGuard)
export class CvController {
  constructor(
    private readonly cvService: CvService,
    private readonly cvParserService: CvParserService,
  ) {}

  @Public()
  @Post('public-submit')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 600000 } }) // Limit to max 5 submissions per 10 minutes per IP
  @ApiOperation({ summary: 'Landing page public CV upload (Leave CV for HRs to contact you)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email', description: 'Contact email address' },
        fullName: { type: 'string', description: 'Full name (optional)' },
        phoneNumber: { type: 'string', description: 'Phone number (optional)' },
        file: { type: 'string', format: 'binary', description: 'PDF or Word document, max 5MB' },
        consent: { type: 'boolean', description: 'Consent to store and share CV with HRs. Required.' },
      },
      required: ['email', 'file', 'consent'],
    },
  })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async publicSubmit(
    @UploadedFile(CvFileValidationPipe) file: Express.Multer.File,
    @Body() dto: PublicCvUploadDto,
  ) {
    return this.cvService.submitPublicCv(dto, file);
  }

  @Post('upload')
  @ApiOperation({ summary: 'Upload or replace your CV (Registered user)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary', description: 'PDF or Word document, max 5MB' },
        consent: { type: 'boolean', description: 'Consent to store and process this CV. Required.' },
      },
      required: ['file', 'consent'],
    },
  })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async upload(
    @UploadedFile(CvFileValidationPipe) file: Express.Multer.File,
    @Body() dto: CreateCvDto,
    @Req() req,
  ) {
    return this.cvService.uploadCv(req.user.id, file, dto.consent);
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