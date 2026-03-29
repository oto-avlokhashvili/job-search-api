import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { AiService } from './ai.service';
import { ApiBody } from '@nestjs/swagger';


@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('generate')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: true,
      example: {
        prompt:"string"
      }
    }
  })
  generate(@Body() body: any) {
    return this.aiService.analyze(body);
  }

}
