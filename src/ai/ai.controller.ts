import { Controller, Get, Post, Body, Patch, Param, Delete, Req, UseGuards } from '@nestjs/common';
import { AiService } from './ai.service';
import { ApiBearerAuth, ApiBody, ApiOperation } from '@nestjs/swagger';
import { ChatDto } from './dto/analyze-job.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';


@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) { }

  @Post('generate')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: true,
      example: {
        prompt: "string"
      }
    }
  })
  generate(@Body() body: any) {
    return this.aiService.analyze(body);
  }

  // ai.controller.ts
  @Post('ai-cv-analyzer')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearerAuth')
  @ApiOperation({ summary: 'Analyze uploaded CV and suggest top jobs' })
  async analyzeCv(@Req() req) {
    return this.aiService.analyzeCvAndTopJobs(req.user.id, req.user.searchQuery);
  }

}
