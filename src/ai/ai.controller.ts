import { Controller, Get, Post, Body, Patch, Param, Delete, Req, UseGuards, UploadedFile, UseInterceptors, UploadedFiles } from '@nestjs/common';
import { AiService } from './ai.service';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation } from '@nestjs/swagger';
import { AiChatDto, ChatDto } from './dto/analyze-job.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';


@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) { }

  @Post('search-job')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearerAuth')
  async searchJob(@Req() req) {
    return this.aiService.jobsearchWithCv(req.user.id);
  }
  @Post('chat')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearerAuth')
  @ApiOperation({ summary: 'Send a prompt to the career assistant' })
  @ApiConsumes('application/json')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string' },
      },
    },
  })
  async chat(
    @Body() body: { prompt: string },
    @Req() req,
  ) {
    return this.aiService.chat(req.user.id, body.prompt);
  }
}
