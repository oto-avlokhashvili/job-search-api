import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ClientIpThrottlerGuard } from 'src/auth/guards/client-ip-throttler.guard';
import { HrInterviewService } from './hr-interview.service';
import { InterviewAnswerDto } from './dto/hr-interview.dto';

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
  @ApiOperation({ summary: 'Confirm, decline or ask for another time' })
  answer(@Param('token') token: string, @Body() dto: InterviewAnswerDto) {
    return this.interviewService.answer(token, dto);
  }
}
