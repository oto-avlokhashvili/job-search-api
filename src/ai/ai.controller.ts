import { Controller, Get, Post, Body, Patch, Param, Delete, Req, UseGuards, UploadedFile, UseInterceptors, UploadedFiles } from '@nestjs/common';
import { AiService } from './ai.service';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation } from '@nestjs/swagger';
import { AiChatDto, ChatDto } from './dto/analyze-job.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';


@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) { }

/*   @Post('search-job')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearerAuth')
  @UseInterceptors(FilesInterceptor('files', 10))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['prompt'],  // ← only prompt is required
      properties: {
        prompt: { type: 'string' },
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          nullable: true,  // ← optional in Swagger UI
        },
      },
    },
  })
  async chat(
    @UploadedFiles() files: Express.Multer.File[],  // will be [] if not sent
    @Body() body: ChatDto,
    @Req() req,
  ) {
    return this.aiService.aiChat(req.user.id, body, files ?? []);
  } */
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
async simpleChat(
  @Body() body: { prompt: string },
  @Req() req,
) {
  console.log('body:', body); // check what's actually coming in
  return this.aiService.chat(req.user.id, body.prompt);
}
}
