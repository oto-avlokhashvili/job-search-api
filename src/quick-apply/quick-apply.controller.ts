import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from 'src/auth/guards/optional-jwt-auth.guard';
import { ClientIpThrottlerGuard, resolveClientIp } from 'src/auth/guards/client-ip-throttler.guard';
import { QuickApplyDto } from './dto/quick-apply.dto';
import { QuickApplyService } from './quick-apply.service';

@ApiTags('Quick apply')
@ApiBearerAuth('bearerAuth')
@Controller('quick-apply')
export class QuickApplyController {
  constructor(private readonly quickApplyService: QuickApplyService) {}

  // Declared before ':jobId' so "preview" isn't taken for a job id
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ClientIpThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: "The name, email and phone a CV shows, read from its text (no AI, nothing stored); null when not found" })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary', description: 'PDF or Word, max 5MB' } },
      required: ['file'],
    },
  })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
  preview(@UploadedFile() file: Express.Multer.File | undefined) {
    return this.quickApplyService.preview(file);
  }

  @Post(':jobId')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(OptionalJwtAuthGuard, ClientIpThrottlerGuard)
  // Each call can store a file, run an AI summary and send an email
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: "Email a CV to the address the vacancy names (only when the job's applyEmail is set; otherwise apply on job.link)",
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        consent: { type: 'boolean', description: 'Store the CV, send it to this employer and show it to HRs. Required.' },
        fullName: { type: 'string', description: 'Without an account; read from the CV when left out' },
        email: { type: 'string', format: 'email', description: 'Required without an account' },
        phoneNumber: { type: 'string', description: 'Read from the CV when left out' },
        turnstileToken: { type: 'string', description: 'Without an account' },
        file: {
          type: 'string',
          format: 'binary',
          description: 'PDF or Word, max 5MB. Required without an account; signed in, it replaces the stored CV.',
        },
      },
      required: ['consent'],
    },
  })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
  apply(
    @Param('jobId', ParseIntPipe) jobId: number,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: QuickApplyDto,
    @Req() req,
  ) {
    return this.quickApplyService.apply(jobId, dto, file, req.user ?? null, resolveClientIp(req));
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "The signed-in user's quick applications, newest first" })
  mine(@Req() req) {
    return this.quickApplyService.mine(req.user);
  }

  @Get('applied')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Which of these jobs the signed-in user already quick-applied to' })
  @ApiQuery({ name: 'jobIds', required: true, type: String, example: '12,34,56' })
  async applied(@Req() req, @Query('jobIds') jobIds = '') {
    const ids = [...new Set(String(jobIds).split(',').map((id) => Number(id.trim())).filter((id) => Number.isInteger(id) && id > 0))];
    if (ids.length > 100) throw new BadRequestException('Too many ids (max 100)');
    return { jobIds: await this.quickApplyService.appliedJobIds(req.user, ids) };
  }
}
