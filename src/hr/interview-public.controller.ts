import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ClientIpThrottlerGuard } from 'src/auth/guards/client-ip-throttler.guard';
import { CvFileValidationPipe } from 'src/cv/cv-file-validation.pipe';
import { HrInterviewService } from './hr-interview.service';
import { InterviewAnswerDto, InterviewJoinDto } from './dto/hr-interview.dto';

// The candidate's side of an interview invitation: no account, the signed link is the key.
@ApiTags('Interview (candidate)')
@Controller('interview')
@UseGuards(ClientIpThrottlerGuard)
@Throttle({ default: { limit: 30, ttl: 60000 } })
export class InterviewPublicController {
  constructor(private readonly interviewService: HrInterviewService) {}

  @Get(':token')
  @ApiOperation({ summary: 'Interview details for the candidate' })
  view(@Param('token') token: string) {
    return this.interviewService.publicView(token);
  }

  @Post(':token/answer')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Confirm one of the offered times, or decline (optionally: none of the times suits)' })
  answer(@Param('token') token: string, @Body() dto: InterviewAnswerDto) {
    return this.interviewService.answer(token, dto);
  }

  @Post(':token/join')
  @HttpCode(HttpStatus.OK)
  // Each call stores a file and runs an AI summary
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Invited candidate: accept one of the offered times with their details and CV' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['confirm'] },
        slot: { type: 'integer' },
        fullName: { type: 'string' },
        email: { type: 'string' },
        phoneNumber: { type: 'string' },
        consent: { type: 'boolean' },
        file: { type: 'string', format: 'binary', description: 'PDF or Word, max 5MB' },
      },
      required: ['action', 'fullName', 'email', 'phoneNumber', 'consent', 'file'],
    },
  })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
  join(
    @Param('token') token: string,
    @UploadedFile(CvFileValidationPipe) file: Express.Multer.File,
    @Body() dto: InterviewJoinDto,
  ) {
    return this.interviewService.join(token, dto, file);
  }
}
