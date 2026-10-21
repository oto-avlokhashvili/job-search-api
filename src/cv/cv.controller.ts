// src/cv/cv.controller.ts
import {
  Controller, Post, Get, Delete, Patch,
  UseGuards, UseInterceptors, UploadedFile,
  Req, Res, HttpCode, HttpStatus, Body, Headers,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ApiTags, ApiConsumes, ApiBody, ApiOperation,
  ApiOkResponse, ApiNoContentResponse, ApiBearerAuth, ApiHeader,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';
import { Throttle } from '@nestjs/throttler';
import { ClientIpThrottlerGuard, resolveClientIp } from 'src/auth/guards/client-ip-throttler.guard';
import { CvService } from './cv.service';
import { CvFileValidationPipe } from './cv-file-validation.pipe';
import { UpdateCvSummaryDto } from './dto/update-cv.dto';
import { CreateCvDto } from './dto/create-cv.dto';
import { PublicCvUploadDto } from './dto/public-cv-upload.dto';
import { PublicCvReconnectDto } from './dto/public-cv-reconnect.dto';
import { CvParserService } from './cv-parser.service';
import { PublicCvSearchService } from './public-cv-search.service';
import { TurnstileService } from './turnstile.service';

@ApiTags('CV')
@ApiBearerAuth('bearerAuth')
@Controller('cv')
@UseGuards(JwtAuthGuard)
export class CvController {
  constructor(
    private readonly cvService: CvService,
    private readonly cvParserService: CvParserService,
    private readonly publicCvSearchService: PublicCvSearchService,
    private readonly turnstileService: TurnstileService,
  ) {}

  @Public()
  @Post('public-submit')
  @UseGuards(ClientIpThrottlerGuard)
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
    @Req() req,
  ) {
    const clientIp = resolveClientIp(req);
    await this.turnstileService.verify(dto.turnstileToken, clientIp);
    return this.cvService.submitPublicCv(dto, file, clientIp);
  }

  @Public()
  @Post('public-reconnect')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ClientIpThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 3600000 } })
  @ApiOperation({ summary: 'New search token for a public CV, matched by the email + file name the browser saved at upload' })
  @ApiBody({ type: PublicCvReconnectDto })
  async publicReconnect(@Body() dto: PublicCvReconnectDto, @Req() req) {
    return this.cvService.reconnectPublicCv(dto, resolveClientIp(req));
  }

  @Public()
  @Get('public-search')
  @UseGuards(ClientIpThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 3600000 } }) // 60 searches per hour per IP (plus 30/hour per CV token)
  @ApiOperation({ summary: 'Anonymous CV search: vacancies matching the CV behind the X-CV-Token header' })
  @ApiHeader({ name: 'X-CV-Token', required: true, description: 'searchToken returned by POST /cv/public-submit' })
  async publicSearch(@Headers('x-cv-token') token: string | undefined) {
    return this.publicCvSearchService.search(token);
  }

  @Post('claim-public')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Attach a CV uploaded before signing in (proven by X-CV-Token or the verified account email) to this account' })
  @ApiHeader({ name: 'X-CV-Token', required: false, description: 'searchToken the browser saved at public upload' })
  async claimPublicCv(@Req() req, @Headers('x-cv-token') token: string | undefined) {
    return this.cvService.claimPublicCv(req.user, token || undefined);
  }

  @Get('search')
  @ApiOperation({ summary: 'CV search for the signed-in user: vacancies matching their own CV' })
  async searchMyCv(@Req() req) {
    return this.publicCvSearchService.searchForUser(req.user.id);
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